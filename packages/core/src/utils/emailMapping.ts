// Temporary hardcoded email mappings
export function getUserEmail(userId: string): string {
  const emailMappings: Record<string, string> = {
    'U096M25U3U5': 'leogao@symentic.dev',
    'u096m25u3u5': 'leogao@symentic.dev',
    'U097ANWL97A': 'richhuang@symentic.dev',
    'u097anwl97a': 'richhuang@symentic.dev',
  };
  
  // Return mapped email or fall back to userId@company.com
  return emailMappings[userId] || emailMappings[userId.toUpperCase()] || `${userId}@company.com`;
}