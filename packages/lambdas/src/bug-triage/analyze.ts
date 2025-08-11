import { Handler } from 'aws-lambda';
import { openAIService, bugCounterService } from '@symentic/core';
import { BugReportData, SlackContext, ConversationPair } from './types';

// Infer category from bug description
function inferCategory(description: string): string {
  const lowerDesc = description.toLowerCase();
  
  // Category patterns
  const categoryPatterns = [
    { pattern: /payment|checkout|transaction|billing|stripe|paypal|credit card/, category: 'Payment' },
    { pattern: /login|auth|signin|signup|password|oauth|sso/, category: 'Authentication' },
    { pattern: /api|endpoint|webhook|integration|rest|graphql/, category: 'API' },
    { pattern: /ui|interface|button|display|screen|layout|css|style/, category: 'UI/UX' },
    { pattern: /performance|slow|loading|timeout|lag|freeze/, category: 'Performance' },
    { pattern: /database|sql|query|data|postgres|mongodb|redis/, category: 'Database' },
    { pattern: /security|vulnerability|exploit|breach|permission/, category: 'Security' },
    { pattern: /mobile|ios|android|app/, category: 'Mobile' },
    { pattern: /email|notification|alert|messaging/, category: 'Communication' },
    { pattern: /file|upload|download|storage|s3/, category: 'File Management' },
    { pattern: /network|connection|timeout|dns|ssl/, category: 'Network' },
    { pattern: /deploy|deployment|ci\/cd|build|pipeline/, category: 'DevOps' }
  ];
  
  for (const { pattern, category } of categoryPatterns) {
    if (pattern.test(lowerDesc)) {
      return category;
    }
  }
  
  return 'General';
}

interface AnalyzeBugEvent {
  bugReport: BugReportData | {
    Payload: BugReportData;
  };
  context: SlackContext;
  attemptCount: number;
  threadTs: string;
  bugId: string;
  conversationHistory: ConversationPair[];
}

interface AnalysisResult {
  category?: string;
  isEmergency: boolean;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  bugId?: string;
  bugNumber?: number;
  // Return the complete state for next steps
  bugReport: BugReportData & { bugId: string; bugNumber?: number };
  context: SlackContext;
  threadTs: string;
  attemptCount: number;
  conversationHistory: ConversationPair[];
  analysis: {
    category: string;
    severity: string;
    isEmergency: boolean;
  };
}

export const handler: Handler<AnalyzeBugEvent, AnalysisResult> = async (event) => {
  // Handle nested payload structure from Step Functions
  const bugReportData: BugReportData = 'Payload' in event.bugReport && event.bugReport.Payload ? event.bugReport.Payload : event.bugReport as BugReportData;
  
  if (!bugReportData || !bugReportData.description) {
    throw new Error('Bug report description is missing');
  }
  
  // Generate bug ID early so it's available throughout the workflow
  const bugId = event.bugId || bugReportData.bugId || `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  
  // Extract workspace ID from the channel ID pattern
  const workspaceId = event.context?.teamId || bugReportData.channel?.substring(0, 11).match(/^[A-Z][0-9A-Z]+/)?.[0] || 'unknown';
  
  // Assign bug number early so it's consistent throughout the workflow
  const bugNumber = await bugCounterService.getNextBugNumber(workspaceId);
  
  // Quick analysis just for severity and emergency detection
  let aiAnalysis;
  try {
    // Fast severity detection without full quality analysis
    aiAnalysis = await openAIService.detectBugSeverity({
      description: bugReportData.description,
      impact: bugReportData.impact,
      errorMessages: bugReportData.errorMessages
    });
  } catch (aiError) {
    // Determine severity based on keywords in description
    const description = (bugReportData.description || '').toLowerCase();
    let fallbackSeverity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    let fallbackIsEmergency = false;
    
    // Check for critical keywords
    const criticalPatterns = [
      /\b(platform|system|site|everything|whole\s+platform)\s+(breaking|broken|down|not\s+loading)/i,
      /\b(not\s+loading|all\s+blank|nothing\s+works|completely\s+down)/i,
      /\b(huge\s+error|major\s+outage|emergency|critical)/i,
      /\b(all\s+users?\s+affected|production\s+down)/i
    ];
    
    if (criticalPatterns.some(pattern => pattern.test(description))) {
      fallbackSeverity = 'critical';
      fallbackIsEmergency = true;
    }
    
    // Fallback severity detection
    aiAnalysis = {
      category: 'general',
      severity: fallbackSeverity,
      isEmergency: fallbackIsEmergency
    };
  }
  
  const category = aiAnalysis.category || inferCategory(bugReportData.description);
  const severity = aiAnalysis.severity || 'medium';
  
  // Update severity if emergency detected
  const finalSeverity = aiAnalysis.isEmergency ? 'critical' : severity;
  
  // Prepare the bug report with analysis results
  const analyzedBugReport = {
    ...bugReportData,
    bugId,
    bugNumber, // Include bug number in the report
    severity: finalSeverity,
    category
  };
  
  // Return the complete state for the next step (combining 3 operations into 1)
  const result: AnalysisResult = {
    category,
    isEmergency: aiAnalysis.isEmergency || false,
    severity: finalSeverity,
    bugId,
    bugNumber, // Bug number assigned here
    // Return everything needed for the next state
    bugReport: analyzedBugReport,
    context: event.context,
    threadTs: event.threadTs,
    attemptCount: event.attemptCount,
    conversationHistory: event.conversationHistory,
    analysis: {
      category,
      severity: finalSeverity,
      isEmergency: aiAnalysis.isEmergency || false
    }
  };
  
  return result;
};