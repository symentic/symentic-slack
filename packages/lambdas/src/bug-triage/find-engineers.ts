import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

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
  
  // Hardcoded founders for demo
  const founders: Engineer[] = [
    {
      userId: 'U096M25U3U5', // Richard Huang
      name: 'Richard Huang',
      expertise: ['frontend', 'backend', 'infrastructure', 'product', 'general'],
      relevanceScore: 95
    },
    {
      userId: 'U097ANWL97A', // Leo Gao
      name: 'Leo Gao',
      expertise: ['ai', 'ml', 'backend', 'infrastructure', 'data', 'general'],
      relevanceScore: 95
    }
  ];
  
  try {
    // Determine the bug category
    // Handle Step Functions nested payload structure
    const analysisData = event.analysis?.Payload || event.analysis || {};
    const category = analysisData.category || event.bugReport.category || 'general';
    const severity = event.bugReport.severity || 'medium';
    
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
    
    const command = new QueryCommand(params);
    const result = await dynamodb.send(command);
    
    if (!result.Items || result.Items.length === 0) {
      console.log('No engineers found for category:', category, '- returning founders as default');
      // For high/critical severity, boost founder scores
      if (severity === 'high' || severity === 'critical') {
        founders[0].relevanceScore = 100;
        founders[1].relevanceScore = 100;
      }
      return founders;
    }
    
    // Map to Engineer format and calculate relevance
    let engineers: Engineer[] = result.Items.map(item => ({
      userId: item.userId,
      name: item.displayName || 'Unknown',
      expertise: [item.area],
      relevanceScore: calculateRelevance(item, event.bugReport)
    }));
    
    // Filter out founders from regular engineers to avoid duplicates
    engineers = engineers.filter(eng => 
      eng.userId !== 'U096M25U3U5' && eng.userId !== 'U097ANWL97A'
    );
    
    // For high/critical bugs, always include founders
    if (severity === 'high' || severity === 'critical') {
      // Boost founder scores for high priority
      founders[0].relevanceScore = 100;
      founders[1].relevanceScore = 100;
      // Combine founders with other engineers
      engineers = [...founders, ...engineers];
    } else if (engineers.length === 0) {
      // If no specific engineers found, return founders as fallback
      return founders;
    }
    
    // Sort by relevance and return top 3
    return engineers
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 3);
      
  } catch (error) {
    console.error('Error finding engineers:', error);
    // Return founders as fallback
    return founders;
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