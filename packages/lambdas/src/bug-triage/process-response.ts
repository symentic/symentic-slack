import { Handler } from 'aws-lambda';
import { openAIService } from '@symentic/core';

interface ProcessResponseEvent {
  response?: {
    text: string;
    userId: string;
    timestamp: string;
  };
  userResponse?: {
    userResponse: {
      text: string;
      userId: string;
      timestamp: string;
    };
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
  
  // Handle Step Functions nested payload structure
  // The response might be in event.userResponse.userResponse due to SQS message structure
  const responseData = event.userResponse?.userResponse || event.response?.Payload || event.response;
  
  if (!responseData || !responseData.text) {
    console.error('No valid response text found in event:', event);
    throw new Error('Response text is required');
  }
  
  const responseText = responseData.text.toLowerCase().trim();
  
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
    // Handle Step Functions nested payload structure
    const analysisData = event.analysis?.Payload || event.analysis;
    const systemPrompt = `Extract structured bug report information from the user's response.
Current bug context: ${JSON.stringify(event.bugReport)}
Missing information: ${analysisData.missingInformation.join(', ')}

Extract information and map it to these fields:
- reproductionSteps: What steps the user took (e.g., "went to page, pressed pay button")
- environment: Browser, OS, device, or context (e.g., "checkout page", "payment form")
- impact: What happened or didn't happen (e.g., "payment not processed", "transaction failed")
- errorMessages: Any error messages shown (e.g., "unexpected error", "undefined")
- frequency: How often it happens

Also extract payment-specific details if mentioned:
- Payment method (credit card, PayPal, etc.)
- Transaction stage (checkout, processing, confirmation)
- Payment status (failed, pending, not processed)

Map the information to the most appropriate field above. For example:
- "pressed pay button" → reproductionSteps
- "unexpected error" → errorMessages
- "payment was not processed" → impact
- "credit card" → environment (include with other context)

Return JSON with extractedInfo object containing the mapped fields and confidence score (0-1).`;

    const userPrompt = `User response: ${responseData.text}`;
    
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
      extractedInfo: extractBasicInfo(responseData.text),
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
  } else if (text.includes('not processed') || text.includes('failed')) {
    info.impact = 'Transaction/payment not processed';
  }
  
  // Look for error messages
  if (text.includes('error') || text.includes('undefined')) {
    const errorMatch = text.match(/(\w+\s+error|error:\s*[^.]+|undefined|exception)/i);
    if (errorMatch) {
      info.errorMessages = errorMatch[0];
    }
  }
  
  // Look for payment-specific info
  const paymentMethods = ['credit card', 'debit card', 'paypal', 'stripe', 'payment'];
  const foundPayment = paymentMethods.find(p => text.toLowerCase().includes(p));
  if (foundPayment) {
    info.environment = (info.environment || '') + ` Payment: ${foundPayment}`;
  }
  
  return info;
}