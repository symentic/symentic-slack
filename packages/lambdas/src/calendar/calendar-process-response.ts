import { Handler } from 'aws-lambda';

interface ProcessResponseEvent {
  response: string;
  confirmationId: string;
  selectedSlot?: {
    index: number;
    start: string;
    end: string;
  };
  confirmed: boolean;
  data?: Record<string, any>;
}

interface ProcessResponseResult {
  confirmed: boolean;
  selectedSlot?: {
    start: string;
    end: string;
  };
  reason?: string;
  data?: Record<string, any>;
}

export const handler: Handler<ProcessResponseEvent, ProcessResponseResult> = async (event) => {
  console.log('Process calendar response event:', JSON.stringify(event, null, 2));
  
  const { response, confirmed, selectedSlot, data } = event;
  
  try {
    // If user cancelled
    if (!confirmed) {
      return {
        confirmed: false,
        reason: 'User cancelled the request'
      };
    }
    
    // Process based on the type of confirmation
    if (selectedSlot) {
      // Meeting scheduling - user selected a time slot
      return {
        confirmed: true,
        selectedSlot: {
          start: selectedSlot.start,
          end: selectedSlot.end
        },
        data
      };
    } else {
      // OOO or other confirmations
      return {
        confirmed: true,
        data
      };
    }
  } catch (error) {
    console.error('Failed to process response:', error);
    
    return {
      confirmed: false,
      reason: 'Failed to process response'
    };
  }
};