import { Handler } from 'aws-lambda';
import { openAIService, bugSimilarityService, bugCounterService } from '@symentic/core';
import crypto from 'crypto';

interface BugReportData {
  description: string;
  reportedBy: string;
  channel: string;
  timestamp: string;
  severity?: string;
  reproductionSteps?: string;
  environment?: string;
  impact?: string;
  errorMessages?: string;
  frequency?: string;
  completenessScore?: number;
  bugId?: string;
  category?: string;
}

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

// Rule-based completeness calculation
function calculateRuleBasedCompleteness(bugReport: BugReportData): number {
  let score = 0;
  
  // Base score for having a description
  if (bugReport.description && bugReport.description.length > 10) {
    score += 25;
  }
  
  // Check for quality and completeness of each field
  if (bugReport.reproductionSteps && bugReport.reproductionSteps.length > 10) {
    score += 25;
  }
  
  if (bugReport.environment && bugReport.environment.length > 5) {
    score += 20;
  }
  
  if (bugReport.impact && bugReport.impact.length > 10) {
    score += 15;
  }
  
  if (bugReport.errorMessages && bugReport.errorMessages.length > 5) {
    score += 10;
  }
  
  if (bugReport.frequency && bugReport.frequency.length > 3) {
    score += 5;
  }
  
  // Bonus for specific details
  const allText = `${bugReport.description || ''} ${bugReport.environment || ''} ${bugReport.impact || ''}`.toLowerCase();
  
  // Payment-specific bugs
  if (allText.includes('payment') || allText.includes('checkout') || allText.includes('transaction')) {
    if (allText.includes('credit card') || allText.includes('paypal') || allText.includes('stripe')) {
      score += 5; // Payment method mentioned
    }
    if (allText.includes('error') || allText.includes('failed') || allText.includes('declined')) {
      score += 5; // Error details mentioned
    }
  }
  
  // Technical details bonus
  if (allText.match(/version\s*\d+\.\d+/i) || allText.includes('chrome') || allText.includes('firefox') || allText.includes('safari')) {
    score += 5; // Browser/version info
  }
  
  return Math.min(score, 100);
}

interface AnalyzeBugEvent {
  bugReport: BugReportData | {
    Payload: BugReportData;
  };
  context: {
    userId: string;
    channelId: string;
    teamId: string;
  };
}

interface AnalysisResult {
  completenessScore: number;
  qualityRating: number;
  missingInformation: string[];
  followUpQuestions: string[];
  confidence: number;
  category?: string;
  isEmergency: boolean;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  // Duplicate detection results
  isDuplicate?: boolean;
  duplicateOf?: string;
  duplicateChannelId?: string;
  duplicateChannelName?: string;
  similarBugs?: Array<{
    bugId: string;
    bugNumber: number;
    similarity: number;
    description: string;
  }>;
  bugId?: string;
  bugNumber?: number;
  descriptionHash?: string;
  // Enhanced bug report data
  enhancedBugReport?: BugReportData & { bugId: string; bugNumber?: number };
}

export const handler: Handler<AnalyzeBugEvent, AnalysisResult> = async (event) => {
  console.log('Analyzing bug report:', JSON.stringify(event, null, 2));
  
  try {
    // Handle nested payload structure from Step Functions
    const bugReportData: BugReportData = 'Payload' in event.bugReport && event.bugReport.Payload ? event.bugReport.Payload : event.bugReport as BugReportData;
    
    if (!bugReportData || !bugReportData.description) {
      console.error('Bug report description is missing');
      return {
        completenessScore: 0,
        qualityRating: 0,
        missingInformation: ['Bug description is missing'],
        followUpQuestions: ['Please describe the bug you encountered'],
        confidence: 0,
        isEmergency: false
      };
    }
    
    // Check for duplicate bugs first
    const workspaceId = event.context.teamId;
    console.log('Checking for similar bugs in workspace:', workspaceId);
    
    const similarBugs = await bugSimilarityService.findSimilarBugs(
      workspaceId,
      bugReportData.description,
      undefined // category will be determined later
    );
    
    // Generate description hash for exact matching
    const descriptionHash = crypto.createHash('md5')
      .update(bugReportData.description.toLowerCase().trim().replace(/\s+/g, ' '))
      .digest('hex');
    
    // Generate bug ID early so it's available throughout the workflow
    const bugId = bugReportData.bugId || `bug-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    
    // Get next bug number (will be used whether duplicate or not)
    const bugNumber = await bugCounterService.getNextBugNumber(workspaceId);
    
    // Check if this is a duplicate (>95% similarity)
    const isDuplicate = similarBugs.length > 0 && similarBugs[0].similarity > 0.95;
    const duplicateInfo = isDuplicate ? {
      isDuplicate: true,
      duplicateOf: similarBugs[0].bugId,
      duplicateChannelId: similarBugs[0].channelId,
      duplicateChannelName: similarBugs[0].channelName,
      similarBugs: similarBugs.map(bug => ({
        bugId: bug.bugId,
        bugNumber: bug.bugNumber,
        similarity: bug.similarity,
        description: bug.description
      }))
    } : {
      isDuplicate: false,
      similarBugs: similarBugs.length > 0 ? similarBugs.slice(0, 3).map(bug => ({
        bugId: bug.bugId,
        bugNumber: bug.bugNumber,
        similarity: bug.similarity,
        description: bug.description
      })) : []
    };
    
    // Calculate rule-based completeness score (more reliable)
    const ruleBasedScore = calculateRuleBasedCompleteness(bugReportData);
    console.log('Rule-based completeness score:', ruleBasedScore);
    
    // Enhance bug descriptions with AI before analysis
    let enhancedData = {};
    try {
      const enhanced = await openAIService.enhanceBugDescription({
        description: bugReportData.description,
        reproductionSteps: bugReportData.reproductionSteps,
        environment: bugReportData.environment,
        impact: bugReportData.impact,
        errorMessages: bugReportData.errorMessages,
        severity: bugReportData.severity,
        category: bugReportData.category
      });
      
      enhancedData = {
        description: enhanced.enhancedDescription || bugReportData.description,
        reproductionSteps: enhanced.enhancedSteps || bugReportData.reproductionSteps,
        environment: enhanced.enhancedEnvironment || bugReportData.environment,
        impact: enhanced.enhancedImpact || bugReportData.impact
      };
      
      // Apply enhanced data to bugReportData
      Object.assign(bugReportData, enhancedData);
      
      console.log('Enhanced bug data:', enhancedData);
    } catch (error) {
      console.error('Failed to enhance bug description:', error);
      // Continue with original data if enhancement fails
    }
    
    // Use OpenAI to analyze the bug report for quality and generate questions
    let aiAnalysis;
    try {
      aiAnalysis = await openAIService.analyzeBugReportQuality({
        description: bugReportData.description,
        reproductionSteps: bugReportData.reproductionSteps,
        environment: bugReportData.environment,
        impact: bugReportData.impact,
        errorMessages: bugReportData.errorMessages,
        frequency: bugReportData.frequency
      });
      console.log('AI analysis result:', JSON.stringify(aiAnalysis, null, 2));
    } catch (aiError) {
      console.error('AI analysis failed, using fallback:', aiError);
      
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
      
      // Fallback AI analysis
      aiAnalysis = {
        completenessScore: ruleBasedScore, // Use rule-based score
        qualityRating: ruleBasedScore >= 80 ? 8 : ruleBasedScore >= 60 ? 6 : 4,
        missingInformation: [],
        followUpQuestions: [],
        confidence: 0.5,
        category: 'general',
        severity: fallbackSeverity,
        isEmergency: fallbackIsEmergency
      };
    }
    
    // Determine missing information based on rule-based analysis
    const missingInfo: string[] = [];
    if (!bugReportData.reproductionSteps || bugReportData.reproductionSteps.length < 10) {
      missingInfo.push('Detailed reproduction steps');
    }
    if (!bugReportData.environment || bugReportData.environment.length < 5) {
      missingInfo.push('Environment details (browser, OS, version)');
    }
    if (!bugReportData.impact || bugReportData.impact.length < 10) {
      missingInfo.push('Impact on users/business');
    }
    if (!bugReportData.errorMessages) {
      missingInfo.push('Error messages or logs');
    }
    if (!bugReportData.frequency) {
      missingInfo.push('Frequency of occurrence');
    }
    
    // Generate contextual follow-up questions if AI didn't provide any
    const aiFollowUpQuestions = aiAnalysis.followUpQuestions || [];
    const followUpQuestions: string[] = [];
    
    if (aiFollowUpQuestions.length > 0) {
      followUpQuestions.push(...aiFollowUpQuestions);
    } else if (missingInfo.length > 0) {
      // Generate questions based on missing info
      if (!bugReportData.reproductionSteps) {
        followUpQuestions.push('Can you provide step-by-step instructions to reproduce this issue?');
      }
      if (!bugReportData.environment) {
        followUpQuestions.push('What browser, operating system, and version are you using?');
      }
      if (!bugReportData.impact) {
        followUpQuestions.push('How many users are affected and what is the business impact?');
      }
    }
    
    // Hybrid approach: Use rule-based score for completeness, AI for quality insights
    const result: AnalysisResult = {
      completenessScore: ruleBasedScore, // Always use rule-based score
      qualityRating: aiAnalysis.qualityRating || Math.ceil(ruleBasedScore / 10),
      missingInformation: missingInfo.length > 0 ? missingInfo : aiAnalysis.missingInformation,
      followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : aiAnalysis.followUpQuestions,
      confidence: aiAnalysis.confidence || (ruleBasedScore / 100),
      category: aiAnalysis.category || inferCategory(bugReportData.description),
      isEmergency: aiAnalysis.isEmergency || false,
      severity: aiAnalysis.severity || 'medium',
      bugId, // Include the bug ID
      bugNumber,
      descriptionHash,
      ...duplicateInfo,
      // Include the enhanced bug report data
      enhancedBugReport: {
        ...bugReportData,
        bugId,
        bugNumber
      }
    };
    
    console.log('Final analysis result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error analyzing bug report:', error);
    throw error;
  }
};

