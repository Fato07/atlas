/**
 * Instantly Email Fetcher Sub-Agent
 *
 * Fetches email thread history from Instantly API for the attendee.
 * Returns distilled ConversationEntry[] (max 5 entries) to preserve
 * context budget (25k tokens per sub-agent).
 *
 * @module meeting-prep/sub-agents/instantly-fetcher
 */

// ===========================================
// Types
// ===========================================

export interface ConversationEntry {
  date: string;
  channel: 'email' | 'linkedin' | 'call' | 'meeting' | 'slack';
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
}

export interface InstantlyFetcherConfig {
  /** Maximum number of threads to return */
  maxThreads: number;

  /** Maximum age of threads in days */
  maxAgeDays: number;
}

export const DEFAULT_INSTANTLY_CONFIG: InstantlyFetcherConfig = {
  maxThreads: 5,
  maxAgeDays: 90,
};

export interface InstantlyFetcherResult {
  success: true;
  entries: ConversationEntry[];
  total_threads_found: number;
}

export interface InstantlyFetcherError {
  success: false;
  error: string;
  code: 'API_ERROR' | 'TIMEOUT' | 'NO_THREADS' | 'INVALID_EMAIL';
}

export type InstantlyFetchResult = InstantlyFetcherResult | InstantlyFetcherError;

// ===========================================
// Email Thread Type (from Instantly MCP)
// ===========================================

interface InstantlyEmailThread {
  thread_id: string;
  subject: string;
  last_message_date: string;
  message_count: number;
  lead_email: string;
  campaign_id: string;
  status: 'open' | 'replied' | 'bounced' | 'unsubscribed';
  snippet: string;
}

// ===========================================
// Instantly Fetcher Class
// ===========================================

export class InstantlyFetcher {
  private readonly config: InstantlyFetcherConfig;
  private readonly callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>;

  constructor(
    callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
    config?: Partial<InstantlyFetcherConfig>
  ) {
    this.config = { ...DEFAULT_INSTANTLY_CONFIG, ...config };
    this.callMcpTool = callMcpTool;
  }

  /**
   * Fetch email conversation history for an attendee.
   */
  async fetch(attendeeEmail: string): Promise<InstantlyFetchResult> {
    // Validate email format
    if (!this.isValidEmail(attendeeEmail)) {
      return {
        success: false,
        error: `Invalid email format: ${attendeeEmail}`,
        code: 'INVALID_EMAIL',
      };
    }

    try {
      // Query Instantly for email threads
      const threads = await this.callMcpTool<InstantlyEmailThread[]>(
        'instantly_search_threads',
        {
          email: attendeeEmail,
          limit: this.config.maxThreads * 2, // Fetch more than needed for filtering
        }
      );

      // Handle empty results
      if (!threads || threads.length === 0) {
        return {
          success: true,
          entries: [],
          total_threads_found: 0,
        };
      }

      // Filter by age and limit
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.maxAgeDays);

      const recentThreads = threads
        .filter((t) => new Date(t.last_message_date) >= cutoffDate)
        .slice(0, this.config.maxThreads);

      // Convert to ConversationEntry format
      const entries = recentThreads.map((thread) => this.threadToEntry(thread));

      return {
        success: true,
        entries,
        total_threads_found: threads.length,
      };
    } catch (error) {
      // Handle API errors gracefully
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for timeout
      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: 'Instantly API timeout',
          code: 'TIMEOUT',
        };
      }

      return {
        success: false,
        error: errorMessage,
        code: 'API_ERROR',
      };
    }
  }

  /**
   * Convert an Instantly thread to a ConversationEntry.
   */
  private threadToEntry(thread: InstantlyEmailThread): ConversationEntry {
    // Analyze sentiment from status and snippet
    let sentiment: ConversationEntry['sentiment'] = 'neutral';

    if (thread.status === 'replied') {
      // Positive signals: replied, mentions specific interest
      if (this.hasPositiveSignals(thread.snippet)) {
        sentiment = 'positive';
      }
    } else if (thread.status === 'bounced' || thread.status === 'unsubscribed') {
      sentiment = 'negative';
    }

    // Create a concise summary
    const summary = this.createSummary(thread);

    return {
      date: thread.last_message_date,
      channel: 'email',
      summary,
      sentiment,
    };
  }

  /**
   * Check for positive sentiment signals in text.
   */
  private hasPositiveSignals(text: string): boolean {
    const positivePatterns = [
      /interested/i,
      /sounds good/i,
      /love to/i,
      /let's (talk|chat|connect|schedule)/i,
      /looking forward/i,
      /yes/i,
      /definitely/i,
      /great/i,
      /perfect/i,
    ];

    return positivePatterns.some((pattern) => pattern.test(text));
  }

  /**
   * Create a concise summary from thread data.
   */
  private createSummary(thread: InstantlyEmailThread): string {
    const statusLabel =
      thread.status === 'replied'
        ? 'Replied'
        : thread.status === 'open'
          ? 'Opened'
          : thread.status === 'bounced'
            ? 'Bounced'
            : 'Unsubscribed';

    // Truncate snippet to keep summary concise
    const snippet =
      thread.snippet.length > 100
        ? thread.snippet.substring(0, 100) + '...'
        : thread.snippet;

    return `${statusLabel} - "${thread.subject}" (${thread.message_count} messages). ${snippet}`;
  }

  /**
   * Validate email format.
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

// ===========================================
// Factory Function
// ===========================================

/**
 * Create an Instantly fetcher instance.
 */
export function createInstantlyFetcher(
  callMcpTool: <T>(tool: string, params: Record<string, unknown>) => Promise<T>,
  config?: Partial<InstantlyFetcherConfig>
): InstantlyFetcher {
  return new InstantlyFetcher(callMcpTool, config);
}
