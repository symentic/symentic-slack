import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface ProcessResponseEvent {
  response: {
    text: string;
    userId: string;
    timestamp: string;
  };
  bugReport: {
    description: string;
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
  };
  analysis: {
    missingInformation: string[];
  };
}

interface ProcessedResponse {
  action: 'continue' | 'cancel';
  extractedInfo: {
    reproductionSteps?: string;
    environment?: string;
    impact?: string;
    errorMessages?: string;
    frequency?: string;
  };
  confidence: number;
}

export const handler: Handler<ProcessResponseEvent, ProcessedResponse> = async (event) => {
  console.log('Processing user response:', JSON.stringify(event, null, 2));
  
  const responseText = event.response.text.toLowerCase().trim();
  
  // Check for cancellation
  if (['cancel', 'stop', 'nevermind', 'nvm', 'quit'].includes(responseText)) {
    return {
      action: 'cancel',
      extractedInfo: {},
      confidence: 1.0
    };
  }
  
  try {
    // Use AI to extract structured information from the response
    const systemPrompt = `Extract structured bug report information from the user's response.
Current bug context: ${JSON.stringify(event.bugReport)}
Missing information: ${event.analysis.missingInformation.join(', ')}

Extract any of these if mentioned:
- Reproduction steps
- Environment details (browser, OS, device)
- Impact/severity description
- Error messages
- Frequency of occurrence

Return JSON with extracted fields and confidence score (0-1).`;

    const userPrompt = `User response: ${event.response.text}`;
    
    const result = await openAIService.classifyWithModel(
      systemPrompt,
      userPrompt,
      'gpt-4o-mini'
    );
    
    const parsed = JSON.parse(result);
    
    return {
      action: 'continue',
      extractedInfo: parsed.extractedInfo || {},
      confidence: parsed.confidence || 0.7
    };
  } catch (error) {
    console.error('Error processing response:', error);
    
    // Fallback: Try to extract basic info
    return {
      action: 'continue',
      extractedInfo: extractBasicInfo(event.response.text),
      confidence: 0.5
    };
  }
};

function extractBasicInfo(text: string): ProcessedResponse['extractedInfo'] {
  const info: ProcessedResponse['extractedInfo'] = {};
  
  // Look for browser mentions
  const browsers = ['chrome', 'firefox', 'safari', 'edge'];
  const foundBrowser = browsers.find(b => text.toLowerCase().includes(b));
  if (foundBrowser) {
    info.environment = `Browser: ${foundBrowser}`;
  }
  
  // Look for OS mentions
  const os = ['windows', 'mac', 'macos', 'linux', 'ios', 'android'];
  const foundOS = os.find(o => text.toLowerCase().includes(o));
  if (foundOS) {
    info.environment = (info.environment || '') + ` OS: ${foundOS}`;
  }
  
  // Look for impact keywords
  if (text.includes('all users') || text.includes('everyone')) {
    info.impact = 'All users affected';
  } else if (text.includes('can\'t') || text.includes('cannot') || text.includes('unable')) {
    info.impact = 'Users unable to complete action';
  }
  
  return info;
}