import { Handler } from 'aws-lambda';
import { dynamoDBService } from '@symentic/core';
import { WebClient } from '@slack/web-api';

interface ExtractParticipantsEvent {
  intentType: string;
  participants?: string[];
  dateTime?: string;
  duration?: number;
  meetingType?: string;
  rawData: {
    originalMessage: string;
  };
  workspaceId: string;
  userId: string;
  channelId: string;
}

interface ExtractParticipantsResult {
  participants: Array<{
    userId: string;
    name: string;
    email?: string;
  }>;
  dateTime?: string;
  duration: number;
  meetingType: string;
}

export const handler: Handler<ExtractParticipantsEvent, ExtractParticipantsResult> = async (event) => {
  console.log('Extract participants event:', JSON.stringify(event, null, 2));
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const { participants = [], workspaceId, userId } = event;
  
  try {
    const extractedParticipants: Array<{
      userId: string;
      name: string;
      email?: string;
    }> = [];
    
    // Always include the requesting user
    try {
      const requesterInfo = await slack.users.info({ user: userId });
      const requesterName = requesterInfo.user?.real_name || requesterInfo.user?.name || 'Unknown';
      const requesterEmail = requesterInfo.user?.profile?.email;
      
      extractedParticipants.push({
        userId,
        name: requesterName,
        email: requesterEmail
      });
    } catch (error) {
      console.error('Failed to get requester info:', error);
    }
    
    // Process mentioned participants
    for (const participant of participants) {
      // Skip if already added (the requester)
      if (participant === userId) continue;
      
      // Handle Slack user mentions (e.g., <@U123456>)
      const userIdMatch = participant.match(/<@(U[A-Z0-9]+)>/);
      if (userIdMatch) {
        const mentionedUserId = userIdMatch[1];
        try {
          const userInfo = await slack.users.info({ user: mentionedUserId });
          const userName = userInfo.user?.real_name || userInfo.user?.name || 'Unknown';
          const userEmail = userInfo.user?.profile?.email;
          
          extractedParticipants.push({
            userId: mentionedUserId,
            name: userName,
            email: userEmail
          });
        } catch (error) {
          console.error(`Failed to get user info for ${mentionedUserId}:`, error);
        }
      } else {
        // Handle names - try to find user by name
        try {
          // Get all users in workspace
          const users = await slack.users.list();
          const matchedUser = users.members?.find(member => {
            const realName = member.real_name?.toLowerCase();
            const displayName = member.name?.toLowerCase();
            const searchName = participant.toLowerCase();
            
            return realName?.includes(searchName) || displayName?.includes(searchName);
          });
          
          if (matchedUser && matchedUser.id) {
            extractedParticipants.push({
              userId: matchedUser.id,
              name: matchedUser.real_name || matchedUser.name || participant,
              email: matchedUser.profile?.email
            });
          } else {
            // If we can't find the user, still add them by name
            console.log(`Could not find Slack user for name: ${participant}`);
            extractedParticipants.push({
              userId: participant,
              name: participant,
              email: undefined
            });
          }
        } catch (error) {
          console.error(`Failed to search for user ${participant}:`, error);
          // Add as name only
          extractedParticipants.push({
            userId: participant,
            name: participant,
            email: undefined
          });
        }
      }
    }
    
    // If no participants were found, just include the requester
    if (extractedParticipants.length === 0) {
      console.log('No participants found, defaulting to requester only');
      extractedParticipants.push({
        userId,
        name: 'You',
        email: undefined
      });
    }
    
    console.log('Extracted participants:', extractedParticipants);
    
    return {
      participants: extractedParticipants,
      dateTime: event.dateTime,
      duration: event.duration || 30, // Default to 30 minutes
      meetingType: event.meetingType || 'Meeting'
    };
  } catch (error) {
    console.error('Failed to extract participants:', error);
    
    // Return minimal participant list on error
    return {
      participants: [{
        userId,
        name: 'You',
        email: undefined
      }],
      dateTime: event.dateTime,
      duration: 30,
      meetingType: 'Meeting'
    };
  }
};