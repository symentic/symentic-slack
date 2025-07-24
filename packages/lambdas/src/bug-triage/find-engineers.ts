import { Handler } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';

const dynamodb = new DynamoDB.DocumentClient();

interface FindEngineersEvent {
  bugReport: {
    description: string;
    category?: string;
    severity?: string;
  };
  analysis?: {
    Payload?: {
      category?: string;
    };
    // Legacy field for backward compatibility
    category?: string;
  };
}

interface Engineer {
  userId: string;
  name: string;
  expertise: string[];
  relevanceScore: number;
}

export const handler: Handler<FindEngineersEvent, Engineer[]> = async (event) => {
  console.log('Finding relevant engineers:', JSON.stringify(event, null, 2));
  
  try {
    // Determine the bug category
    // Handle Step Functions nested payload structure
    const analysisData = event.analysis?.Payload || event.analysis || {};
    const category = analysisData.category || event.bugReport.category || 'general';
    
    // Query the area expertise table
    const params = {
      TableName: process.env.AREA_EXPERTISE_TABLE!,
      IndexName: 'area-count-index',
      KeyConditionExpression: 'area = :area',
      ExpressionAttributeValues: {
        ':area': category.toLowerCase()
      },
      ScanIndexForward: false, // Sort by count descending
      Limit: 5
    };
    
    const result = await dynamodb.query(params).promise();
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No engineers found for category:', category);
      return [];
    }
    
    // Map to Engineer format and calculate relevance
    const engineers: Engineer[] = result.Items.map(item => ({
      userId: item.userId,
      name: item.displayName || 'Unknown',
      expertise: [item.area],
      relevanceScore: calculateRelevance(item, event.bugReport)
    }));
    
    // Sort by relevance and return top 3
    return engineers
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 3);
      
  } catch (error) {
    console.error('Error finding engineers:', error);
    return [];
  }
};

function calculateRelevance(engineer: { count?: number }, bugReport: { severity?: string }): number {
  let score = engineer.count || 0; // Base score from expertise count
  
  // Boost score for high severity bugs
  if (bugReport.severity === 'high') {
    score *= 1.5;
  }
  
  // Additional logic can be added here
  
  return Math.min(score, 100); // Cap at 100
}