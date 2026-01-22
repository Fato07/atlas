/**
 * Slack Utility Functions
 *
 * Shared utilities for working with Slack APIs.
 *
 * @module lib/slack-utils
 */

/**
 * Parse a Slack channel ID from either a raw ID or a full Slack URL.
 * Supports URLs like:
 *   - https://workspace.slack.com/archives/C0AA4U7DYLW
 *   - https://app.slack.com/client/T12345/C0AA4U7DYLW
 *
 * @param value - Channel ID (C0XXXXXXX) or full Slack URL
 * @returns Extracted channel ID
 */
export function parseSlackChannelId(value: string): string {
  // Already a channel ID (starts with C, G for private, D for DM, U for user)
  if (/^[CGDU][A-Z0-9]+$/.test(value)) {
    return value;
  }

  // Extract from /archives/CXXXXXXX URL format
  const archivesMatch = value.match(/\/archives\/([CGDU][A-Z0-9]+)/);
  if (archivesMatch) {
    return archivesMatch[1];
  }

  // Extract from /client/TXXXXX/CXXXXXXX URL format
  const clientMatch = value.match(/\/client\/[A-Z0-9]+\/([CGDU][A-Z0-9]+)/);
  if (clientMatch) {
    return clientMatch[1];
  }

  // Fallback: return as-is and let Slack API handle validation
  console.warn(`Could not parse Slack channel ID from: ${value}`);
  return value;
}
