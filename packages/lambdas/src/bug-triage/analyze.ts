import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

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
    
    // Calculate rule-based completeness score (more reliable)
    const ruleBasedScore = calculateRuleBasedCompleteness(bugReportData);
    console.log('Rule-based completeness score:', ruleBasedScore);
    
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
      // Fallback AI analysis
      aiAnalysis = {
        completenessScore: ruleBasedScore, // Use rule-based score
        qualityRating: ruleBasedScore >= 80 ? 8 : ruleBasedScore >= 60 ? 6 : 4,
        missingInformation: [],
        followUpQuestions: [],
        confidence: 0.5,
        category: 'general'
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
    
    // Check if this is an emergency
    const isEmergency = await checkIfEmergency(bugReportData);
    
    // Hybrid approach: Use rule-based score for completeness, AI for quality insights
    const result: AnalysisResult = {
      completenessScore: ruleBasedScore, // Always use rule-based score
      qualityRating: aiAnalysis.qualityRating || Math.ceil(ruleBasedScore / 10),
      missingInformation: missingInfo.length > 0 ? missingInfo : aiAnalysis.missingInformation,
      followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : aiAnalysis.followUpQuestions,
      confidence: aiAnalysis.confidence || (ruleBasedScore / 100),
      category: aiAnalysis.category,
      isEmergency
    };
    
    console.log('Final analysis result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error analyzing bug report:', error);
    throw error;
  }
};

async function checkIfEmergency(bugReport: { description?: string; impact?: string }): Promise<boolean> {
  const emergencyKeywords = [
    'production down',
    'all users affected',
    'critical',
    'emergency',
    'urgent',
    'data loss',
    'security breach',
    'complete outage'
  ];
  
  const description = (bugReport.description || '').toLowerCase();
  const impact = (bugReport.impact || '').toLowerCase();
  const fullText = `${description} ${impact}`;
  
  return emergencyKeywords.some(keyword => fullText.includes(keyword));
}