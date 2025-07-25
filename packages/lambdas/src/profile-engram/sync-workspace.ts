import { Handler } from 'aws-lambda';
import { WebClient } from '@slack/web-api';
import { profileEngramService, CreateProfileRequest, SlackUserData } from '@symentic/core';

interface SyncWorkspaceEvent {
  businessId: string;  // Slack workspace ID
  triggerType: 'app_installed' | 'manual_sync' | 'scheduled';
  lastSyncTime?: string;
}

interface SyncResult {
  businessId: string;
  totalUsers: number;
  profilesCreated: number;
  profilesUpdated: number;
  errors: string[];
  syncedAt: string;
}

export const handler: Handler<SyncWorkspaceEvent, SyncResult> = async (event) => {
  console.log('Starting workspace sync:', JSON.stringify(event, null, 2));
  
  const { businessId, triggerType, lastSyncTime } = event;
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  const result: SyncResult = {
    businessId,
    totalUsers: 0,
    profilesCreated: 0,
    profilesUpdated: 0,
    errors: [],
    syncedAt: new Date().toISOString()
  };
  
  try {
    // Fetch all users from Slack workspace
    console.log('Fetching users from Slack workspace:', businessId);
    let cursor: string | undefined;
    const allUsers: SlackUserData[] = [];
    
    // Paginate through all users
    do {
      const response = await slack.users.list({
        team_id: businessId,
        cursor,
        limit: 200 // Max allowed by Slack
      });
      
      if (response.members) {
        allUsers.push(...(response.members as SlackUserData[]));
      }
      
      cursor = response.response_metadata?.next_cursor;
    } while (cursor);
    
    console.log(`Found ${allUsers.length} total users in workspace`);
    result.totalUsers = allUsers.length;
    
    // Filter out bots and deleted users
    const activeUsers = allUsers.filter(user => 
      !user.is_bot && 
      !user.deleted && 
      user.id !== 'USLACKBOT' // Exclude Slackbot
    );
    
    console.log(`Processing ${activeUsers.length} active users`);
    
    // Process users in batches to avoid overwhelming the system
    const batchSize = 25;
    for (let i = 0; i < activeUsers.length; i += batchSize) {
      const batch = activeUsers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (slackUser) => {
        try {
          // Check if profile already exists
          const existingProfile = await profileEngramService.getProfile(businessId, slackUser.id);
          
          if (existingProfile) {
            // Update existing profile if Slack data has changed
            if (shouldUpdateProfile(existingProfile, slackUser, lastSyncTime)) {
              await updateExistingProfile(businessId, slackUser, existingProfile);
              result.profilesUpdated++;
            }
          } else {
            // Create new profile
            const email = slackUser.profile?.email?.toLowerCase();
            const isFounder = email === 'richxhuang@gmail.com' || email === 'leogao@umich.edu';
            
            const profileRequest: CreateProfileRequest = {
              businessId,
              userId: slackUser.id,
              userType: 'internal',
              name: slackUser.real_name || slackUser.name || 'Unknown User',
              email: slackUser.profile?.email,
              source: 'slack',
              role: isFounder ? 'Co-Founder' : (slackUser.profile?.title || 'Team Member'),
              tags: generateUserTags(slackUser),
              slackData: slackUser,
              consent: {
                given: true, // Internal users implicitly consent
                method: 'terms_acceptance',
                timestamp: new Date().toISOString()
              }
            };
            
            await profileEngramService.createProfile(profileRequest);
            result.profilesCreated++;
          }
        } catch (error) {
          console.error(`Error processing user ${slackUser.id}:`, error);
          result.errors.push(`User ${slackUser.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }));
      
      // Add a small delay between batches to avoid rate limits
      if (i + batchSize < activeUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Store sync metadata
    await storeSyncMetadata(businessId, result);
    
    console.log('Workspace sync completed:', result);
    return result;
    
  } catch (error) {
    console.error('Workspace sync failed:', error);
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
};

function shouldUpdateProfile(
  existingProfile: any,
  slackUser: SlackUserData,
  lastSyncTime?: string
): boolean {
  // Always update if no lastSyncTime (first sync)
  if (!lastSyncTime) return true;
  
  // Check if key fields have changed
  const currentSlackData = existingProfile.slackProfile;
  if (!currentSlackData) return true;
  
  return (
    currentSlackData.realName !== slackUser.real_name ||
    currentSlackData.title !== slackUser.profile?.title ||
    currentSlackData.statusText !== slackUser.profile?.status_text ||
    currentSlackData.isAdmin !== slackUser.is_admin ||
    currentSlackData.isOwner !== slackUser.is_owner
  );
}

async function updateExistingProfile(
  businessId: string,
  slackUser: SlackUserData,
  existingProfile: any
): Promise<void> {
  const email = slackUser.profile?.email?.toLowerCase();
  const isFounder = email === 'richxhuang@gmail.com' || email === 'leogao@umich.edu';
  
  const updates: any = {
    name: slackUser.real_name || slackUser.name || existingProfile.name,
    email: slackUser.profile?.email || existingProfile.email,
    role: isFounder ? 'Co-Founder' : (slackUser.profile?.title || existingProfile.role),
    slackProfile: {
      slackUserId: slackUser.id,
      realName: slackUser.real_name || slackUser.name,
      displayName: slackUser.profile?.display_name || slackUser.name,
      title: slackUser.profile?.title,
      profilePictureUrl: slackUser.profile?.image_512 || slackUser.profile?.image_192,
      timezone: slackUser.tz,
      statusText: slackUser.profile?.status_text,
      isOwner: slackUser.is_owner || false,
      isAdmin: slackUser.is_admin || false
    },
    lastUpdated: new Date().toISOString()
  };
  
  // Always regenerate tags to ensure founders are properly tagged
  updates.tags = generateUserTags(slackUser);
  
  await profileEngramService.updateProfile({
    businessId,
    userId: slackUser.id,
    updates
  });
}

function generateUserTags(slackUser: SlackUserData): string[] {
  const tags: string[] = [];
  
  // Check if user is a founder by email
  const email = slackUser.profile?.email?.toLowerCase();
  if (email === 'richxhuang@gmail.com' || email === 'leogao@umich.edu') {
    tags.push('founder');
    tags.push('leadership');
  }
  
  // Role-based tags
  if (slackUser.is_owner) tags.push('owner');
  if (slackUser.is_admin) tags.push('admin');
  
  // Title-based tags
  const title = slackUser.profile?.title?.toLowerCase() || '';
  if (title.includes('engineer') || title.includes('developer')) tags.push('engineering');
  if (title.includes('manager')) tags.push('management');
  if (title.includes('designer')) tags.push('design');
  if (title.includes('product')) tags.push('product');
  if (title.includes('sales')) tags.push('sales');
  if (title.includes('marketing')) tags.push('marketing');
  if (title.includes('support')) tags.push('support');
  if (title.includes('data') || title.includes('analyst')) tags.push('analytics');
  
  // Always add 'team' tag for internal users
  tags.push('team');
  
  return [...new Set(tags)]; // Remove duplicates
}

async function storeSyncMetadata(businessId: string, result: SyncResult): Promise<void> {
  // Store in DynamoDB for tracking sync history
  // This could be extended to track sync history, errors, etc.
  console.log('Sync metadata stored for business:', businessId, result);
  // Implementation would go here if we had a sync metadata table
}