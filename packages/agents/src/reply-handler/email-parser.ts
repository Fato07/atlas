/**
 * Reply Handler Agent - Email Parser
 *
 * Parses email replies to extract new content, removing quoted threads
 * and email signatures. Handles various email client formats.
 *
 * Implements FR-001: Parse inbound reply content to extract only new text,
 * removing quoted thread content, signatures, and disclaimers.
 *
 * @module reply-handler/email-parser
 */

// ===========================================
// Quote Detection Patterns
// ===========================================

/**
 * Patterns that indicate the start of quoted content
 */
const QUOTE_PATTERNS: RegExp[] = [
  // Gmail / Google Workspace
  /^On .+ wrote:$/m,
  /^On .+, .+ at .+ wrote:$/m,
  /^On \w+, \w+ \d+, \d+ at \d+:\d+ [AP]M .+ wrote:$/m,

  // Outlook / Microsoft 365
  /^From: .+$/m,
  /^-----Original Message-----$/m,
  /^________________________________$/m,
  /^-{5,}$/m,

  // Apple Mail / iOS
  /^On .+, at .+, .+ wrote:$/m,
  /^Begin forwarded message:$/m,

  // Generic patterns
  /^> /m,
  /^>$/m,
  /^Sent from my /m,
  /^Get Outlook for /m,

  // Reply headers
  /^Replied to:/m,
  /^In reply to:/m,

  // Date-based patterns (various locales)
  /^\d{1,2}\/\d{1,2}\/\d{2,4}.*wrote:$/m,
  /^\d{1,2}\.\d{1,2}\.\d{2,4}.*schrieb:$/m, // German
  /^Le \d{1,2}\/\d{1,2}\/\d{2,4}.*a écrit :$/m, // French
];

/**
 * Patterns that indicate forwarded content
 */
const FORWARD_PATTERNS: RegExp[] = [
  /^---------- Forwarded message ---------$/m,
  /^Begin forwarded message:$/m,
  /^----- Forwarded Message -----$/m,
  /^Forwarded by /m,
];

// ===========================================
// Signature Detection Patterns
// ===========================================

/**
 * Patterns that indicate the start of an email signature
 */
const SIGNATURE_PATTERNS: RegExp[] = [
  // Common signature delimiters
  /^-- $/m,
  /^--$/m,
  /^___+$/m,
  /^-{3,}$/m,

  // Sent from device patterns
  /^Sent from my iPhone$/m,
  /^Sent from my iPad$/m,
  /^Sent from my Android$/m,
  /^Sent from Mail for Windows$/m,
  /^Sent from Outlook$/m,
  /^Get Outlook for /m,

  // Common signature starters
  /^Best regards,?$/mi,
  /^Kind regards,?$/mi,
  /^Thanks,?$/mi,
  /^Thank you,?$/mi,
  /^Cheers,?$/mi,
  /^Regards,?$/mi,
  /^Sincerely,?$/mi,
  /^Warm regards,?$/mi,
  /^Best,?$/mi,
];

/**
 * Content that should be completely removed
 */
const REMOVAL_PATTERNS: RegExp[] = [
  // Legal disclaimers
  /^This email and any attachments .{50,}$/gim,
  /^CONFIDENTIALITY NOTICE:.+$/gim,
  /^This message may contain confidential.+$/gim,
  /^The information contained in this email.+$/gim,

  // Unsubscribe links
  /^To unsubscribe.+$/gim,
  /^Click here to unsubscribe.+$/gim,

  // Marketing footers
  /^\[External\]$/gim,
  /^\[EXTERNAL\]$/gim,
];

// ===========================================
// Email Parser Class
// ===========================================

export interface ParsedEmail {
  /** The new content from the reply (quotes and signatures removed) */
  newContent: string;

  /** Whether quotes were detected and removed */
  hadQuotes: boolean;

  /** Whether a signature was detected and removed */
  hadSignature: boolean;

  /** Original email length */
  originalLength: number;

  /** Parsed content length */
  parsedLength: number;

  /** Compression ratio (parsed / original) */
  compressionRatio: number;
}

export interface EmailParserOptions {
  /** Preserve quotes (for context) */
  preserveQuotes?: boolean;

  /** Preserve signature */
  preserveSignature?: boolean;

  /** Max lines to keep from new content */
  maxLines?: number;

  /** Trim whitespace aggressively */
  trimWhitespace?: boolean;
}

/**
 * Parse an email reply to extract only the new content
 */
export function parseEmailReply(
  emailContent: string,
  options: EmailParserOptions = {}
): ParsedEmail {
  const {
    preserveQuotes = false,
    preserveSignature = false,
    maxLines,
    trimWhitespace = true,
  } = options;

  const originalLength = emailContent.length;
  let content = emailContent;
  let hadQuotes = false;
  let hadSignature = false;

  // Step 1: Remove legal disclaimers and footers
  for (const pattern of REMOVAL_PATTERNS) {
    content = content.replace(pattern, '');
  }

  // Step 2: Handle multipart/MIME boundaries (simple extraction)
  content = handleMultipartMime(content);

  // Step 3: Remove quoted content (unless preserving)
  if (!preserveQuotes) {
    const quotedResult = removeQuotedContent(content);
    content = quotedResult.content;
    hadQuotes = quotedResult.removed;
  }

  // Step 4: Remove forwarded content
  const forwardedResult = removeForwardedContent(content);
  content = forwardedResult.content;
  hadQuotes = hadQuotes || forwardedResult.removed;

  // Step 5: Remove signature (unless preserving)
  if (!preserveSignature) {
    const signatureResult = removeSignature(content);
    content = signatureResult.content;
    hadSignature = signatureResult.removed;
  }

  // Step 6: Clean up whitespace
  if (trimWhitespace) {
    content = cleanWhitespace(content);
  }

  // Step 7: Limit lines if specified
  if (maxLines && maxLines > 0) {
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      content = lines.slice(0, maxLines).join('\n');
    }
  }

  const parsedLength = content.length;
  const compressionRatio = originalLength > 0 ? parsedLength / originalLength : 1;

  return {
    newContent: content,
    hadQuotes,
    hadSignature,
    originalLength,
    parsedLength,
    compressionRatio,
  };
}

// ===========================================
// Content Extraction Functions
// ===========================================

/**
 * Extract new content by removing quoted reply content
 */
function removeQuotedContent(content: string): { content: string; removed: boolean } {
  let result = content;
  let removed = false;

  // Find the earliest quote pattern
  let earliestIndex = result.length;

  for (const pattern of QUOTE_PATTERNS) {
    const match = result.match(pattern);
    if (match && match.index !== undefined && match.index < earliestIndex) {
      earliestIndex = match.index;
      removed = true;
    }
  }

  // Also check for inline quotes (lines starting with >)
  const lines = result.split('\n');
  const newLines: string[] = [];
  let inQuoteBlock = false;

  // Calculate approximate line where quote starts (only if quote was found)
  const quoteLine = removed ? Math.max(1, Math.floor(earliestIndex / 80)) : lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line is a quote marker
    if (line.startsWith('>') || line.startsWith('|')) {
      inQuoteBlock = true;
      removed = true;
      continue;
    }

    // Check if we're past the quote start (only if quote was found)
    if (removed && i >= quoteLine) {
      break;
    }

    // End quote block if we see non-quoted content after quotes
    if (inQuoteBlock && line.trim() !== '' && !line.startsWith('>')) {
      inQuoteBlock = false;
    }

    if (!inQuoteBlock) {
      newLines.push(line);
    }
  }

  // Use line-based or index-based result
  if (earliestIndex < result.length) {
    result = result.substring(0, earliestIndex);
  } else if (newLines.length < lines.length) {
    result = newLines.join('\n');
  }

  return { content: result, removed };
}

/**
 * Remove forwarded message content
 */
function removeForwardedContent(content: string): { content: string; removed: boolean } {
  let result = content;
  let removed = false;

  for (const pattern of FORWARD_PATTERNS) {
    const match = result.match(pattern);
    if (match && match.index !== undefined) {
      result = result.substring(0, match.index);
      removed = true;
      break;
    }
  }

  return { content: result, removed };
}

/**
 * Remove email signature
 */
export function removeSignature(content: string): { content: string; removed: boolean } {
  const lines = content.split('\n');
  let signatureStartIndex = -1;

  // Scan from bottom to find signature start
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();

    // Skip empty lines at the end
    if (line === '' && signatureStartIndex === -1) {
      continue;
    }

    // Check for signature patterns
    for (const pattern of SIGNATURE_PATTERNS) {
      if (pattern.test(line)) {
        signatureStartIndex = i;
        break;
      }
    }

    // If we found a signature marker, stop looking
    if (signatureStartIndex !== -1) {
      break;
    }

    // Heuristic: if we've gone back more than 10 lines without finding
    // a signature marker, the signature probably doesn't exist
    if (lines.length - i > 10) {
      break;
    }
  }

  if (signatureStartIndex === -1) {
    return { content, removed: false };
  }

  const newContent = lines.slice(0, signatureStartIndex).join('\n');
  return { content: newContent, removed: true };
}

/**
 * Handle multipart MIME content
 * Extracts text/plain content from multipart emails
 */
export function handleMultipartMime(content: string): string {
  // Check for MIME boundary
  const boundaryMatch = content.match(/boundary="?([^"\s\r\n]+)"?/i);
  if (!boundaryMatch) {
    return content;
  }

  const boundary = boundaryMatch[1];
  const parts = content.split(`--${boundary}`);

  // Look for text/plain part
  for (const part of parts) {
    if (part.includes('Content-Type: text/plain')) {
      // Extract content after headers (double newline)
      const headerEnd = part.indexOf('\r\n\r\n') || part.indexOf('\n\n');
      if (headerEnd !== -1) {
        let textContent = part.substring(headerEnd + 4);

        // Remove trailing boundary marker
        const endBoundary = textContent.indexOf(`--${boundary}`);
        if (endBoundary !== -1) {
          textContent = textContent.substring(0, endBoundary);
        }

        return textContent.trim();
      }
    }
  }

  // Fallback: return original content (might be simple text)
  return content;
}

/**
 * Clean up excessive whitespace
 */
function cleanWhitespace(content: string): string {
  return content
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove trailing whitespace from lines
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    // Collapse multiple blank lines to single
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading/trailing whitespace
    .trim();
}

// ===========================================
// Utility Functions
// ===========================================

/**
 * Extract the sender's name from a "On ... wrote:" line
 */
export function extractSenderFromQuote(content: string): string | undefined {
  const patterns = [
    /^On .+, (.+) wrote:$/m,
    /^On .+, (.+) at .+ wrote:$/m,
    /^From: (.+)$/m,
    /<(.+@.+)>/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Detect if content is likely an auto-reply (OOO, bounce, etc.)
 */
export function detectAutoReply(content: string): {
  isAutoReply: boolean;
  type?: 'ooo' | 'bounce' | 'auto_response';
} {
  const lowerContent = content.toLowerCase();

  // Out of office patterns
  const oooPatterns = [
    'out of office',
    'out of the office',
    'away from my desk',
    'on vacation',
    'on holiday',
    'automatic reply',
    'auto-reply',
    'autoreply',
    'i am currently out',
    "i'm currently out",
    'will respond when i return',
    'limited access to email',
  ];

  for (const pattern of oooPatterns) {
    if (lowerContent.includes(pattern)) {
      return { isAutoReply: true, type: 'ooo' };
    }
  }

  // Bounce patterns
  const bouncePatterns = [
    'delivery failed',
    'delivery status notification',
    'undeliverable',
    'mail delivery failed',
    'message not delivered',
    'permanent failure',
    'mailbox not found',
    'address rejected',
    'user unknown',
    'no such user',
  ];

  for (const pattern of bouncePatterns) {
    if (lowerContent.includes(pattern)) {
      return { isAutoReply: true, type: 'bounce' };
    }
  }

  // Generic auto-response patterns
  const autoPatterns = [
    'this is an automated',
    'do not reply to this',
    'this mailbox is not monitored',
  ];

  for (const pattern of autoPatterns) {
    if (lowerContent.includes(pattern)) {
      return { isAutoReply: true, type: 'auto_response' };
    }
  }

  return { isAutoReply: false };
}

/**
 * Get word count of content
 */
export function getWordCount(content: string): number {
  return content
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0).length;
}

/**
 * Extract new content from reply (convenience function)
 */
export function extractNewContent(emailContent: string): string {
  const parsed = parseEmailReply(emailContent);
  return parsed.newContent;
}
