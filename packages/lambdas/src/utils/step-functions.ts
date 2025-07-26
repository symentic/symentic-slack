// Utility functions to handle Step Functions nested payload structure

export function extractPayload<T>(data: { Payload?: T } | T): T | undefined {
  if (!data) return undefined;
  if (typeof data === 'object' && data !== null && 'Payload' in data) {
    return data.Payload;
  }
  // If it doesn't have Payload property, assume it's the direct type
  return data as T;
}

export function extractArrayPayload<T>(data: { Payload?: T[] } | T[] | undefined): T[] {
  if (!data) return [];
  if (typeof data === 'object' && data !== null && 'Payload' in data && Array.isArray(data.Payload)) {
    return data.Payload;
  }
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}