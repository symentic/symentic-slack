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
  title?: string;
  bio?: string;
  assignmentReason?: string;
}

export const handler: Handler<FindEngineersEvent, Engineer[]> = async (event) => {
  console.log('Finding relevant engineers:', JSON.stringify(event, null, 2));
  
  // Get assignment reasons based on category
  const getAssignmentReason = (engineerName: string, category: string): string => {
    const reasonsMap: { [key: string]: { [key: string]: string } } = {
      'Richard Huang': {
        'payment': 'payment system architecture expert and has previously resolved critical payment gateway integration issues',
        'frontend': 'UI/UX architecture expert who has built scalable frontend systems and resolved critical rendering issues',
        'backend': 'backend systems architect with extensive experience in API design and microservices optimization',
        'infrastructure': 'infrastructure specialist who has designed and deployed high-availability systems at scale',
        'general': 'full-stack engineering expert with comprehensive system architecture knowledge'
      },
      'Leo Gao': {
        'payment': 'payment validation and fraud detection system expert who has previously optimized transaction processing pipelines',
        'ai': 'AI/ML systems architect who has built and deployed production machine learning models',
        'backend': 'backend optimization expert with deep knowledge of database performance and caching strategies',
        'data': 'data pipeline architect who has designed real-time processing systems handling millions of events',
        'general': 'technical architecture expert with strong problem-solving skills across multiple domains'
      }
    };
    
    return reasonsMap[engineerName]?.[category] || reasonsMap[engineerName]?.['general'] || 'technical expert with relevant experience';
  };
  
  // Hardcoded founders for demo
  const founders: Engineer[] = [
    {
      userId: 'U096M25U3U5', // Richard Huang
      name: 'Richard Huang',
      expertise: ['frontend', 'backend', 'infrastructure', 'product', 'general'],
      relevanceScore: 95,
      title: 'Co-Founder & CPO',
      bio: 'Full-stack engineer with expertise in system architecture, product development, and scaling distributed systems. Previously worked on payment infrastructure and has deep experience with transaction processing systems.',
      assignmentReason: '' // Will be set dynamically
    },
    {
      userId: 'U097ANWL97A', // Leo Gao
      name: 'Leo Gao',
      expertise: ['ai', 'ml', 'backend', 'infrastructure', 'data', 'general'],
      relevanceScore: 95,
      title: 'Co-Founder & CEO',
      bio: 'AI/ML specialist with strong backend engineering skills. Expert in building scalable data pipelines, optimization algorithms, and high-performance systems. Has experience with payment validation algorithms and fraud detection.',
      assignmentReason: '' // Will be set dynamically
    }
  ];
  
  try {
    // Determine the bug category
    // Handle Step Functions nested payload structure
    const analysisData = event.analysis?.Payload || event.analysis || {};
    const category = analysisData.category || event.bugReport.category || 'general';
    const severity = event.bugReport.severity || 'medium';
    
    // Set dynamic assignment reasons for founders based on category
    founders[0].assignmentReason = getAssignmentReason('Richard Huang', category.toLowerCase());
    founders[1].assignmentReason = getAssignmentReason('Leo Gao', category.toLowerCase());
    
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