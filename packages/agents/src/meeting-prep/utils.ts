/**
 * Meeting Prep Agent - Utility Functions
 *
 * Shared utilities for the meeting prep agent including timeout handling,
 * error typing, and common helper functions.
 *
 * @module meeting-prep/utils
 */

// ===========================================
// Timeout Utilities
// ===========================================

/**
 * Error thrown when an operation times out.
 * Allows distinguishing timeout failures from other errors.
 */
export class TimeoutError extends Error {
  /** The operation that timed out */
  readonly operation: string;

  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

/**
 * Check if an error is a TimeoutError.
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Default timeout in milliseconds (30 seconds per SC-007).
 */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Options for the withTimeout wrapper.
 */
export interface WithTimeoutOptions {
  /** Timeout duration in milliseconds (default: 30000) */
  timeoutMs?: number;

  /** Operation name for error messages (default: 'operation') */
  operation?: string;
}

/**
 * Wrap a promise with a timeout.
 *
 * If the promise doesn't resolve within the specified timeout,
 * a TimeoutError is thrown.
 *
 * @param promise - The promise to wrap
 * @param options - Timeout options
 * @returns The result of the promise if it resolves in time
 * @throws TimeoutError if the promise doesn't resolve in time
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withTimeout(
 *   fetchData(),
 *   { operation: 'fetchData', timeoutMs: 5000 }
 * );
 *
 * // With default timeout
 * const result = await withTimeout(fetchData());
 *
 * // Catching timeout errors
 * try {
 *   const result = await withTimeout(slowOperation(), { operation: 'slowOp' });
 * } catch (error) {
 *   if (isTimeoutError(error)) {
 *     console.log(`${error.operation} timed out after ${error.timeoutMs}ms`);
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: WithTimeoutOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, operation = 'operation' } = options;

  // Use definite assignment assertion since we know setTimeout runs synchronously
  let timeoutId!: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Wrap a promise with a timeout, returning a result object instead of throwing.
 *
 * Useful when you want to handle timeouts without try/catch.
 *
 * @param promise - The promise to wrap
 * @param options - Timeout options
 * @returns Object with either success result or error
 *
 * @example
 * ```typescript
 * const result = await withTimeoutResult(fetchData(), { operation: 'fetch' });
 * if (result.success) {
 *   console.log(result.value);
 * } else if (result.timedOut) {
 *   console.log('Fetch timed out');
 * } else {
 *   console.log('Other error:', result.error);
 * }
 * ```
 */
export async function withTimeoutResult<T>(
  promise: Promise<T>,
  options: WithTimeoutOptions = {}
): Promise<
  | { success: true; value: T; timedOut: false }
  | { success: false; error: TimeoutError; timedOut: true }
  | { success: false; error: Error; timedOut: false }
> {
  try {
    const value = await withTimeout(promise, options);
    return { success: true, value, timedOut: false };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { success: false, error, timedOut: true };
    }
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: false,
    };
  }
}

// ===========================================
// Parallel Execution Utilities
// ===========================================

/**
 * Result of executing a named promise with timeout.
 */
export interface NamedPromiseResult<T> {
  name: string;
  success: boolean;
  value?: T;
  error?: Error;
  timedOut: boolean;
  durationMs: number;
}

/**
 * Execute multiple named promises in parallel with individual timeouts.
 *
 * Unlike Promise.allSettled, this:
 * - Applies individual timeouts to each promise
 * - Tracks timing for each operation
 * - Distinguishes timeout errors from other errors
 *
 * @param namedPromises - Map of operation name to promise factory
 * @param options - Timeout options (applied to each promise)
 * @returns Results for each operation
 *
 * @example
 * ```typescript
 * const results = await executeParallel({
 *   fetchUser: () => fetchUser(userId),
 *   fetchPosts: () => fetchPosts(userId),
 *   fetchComments: () => fetchComments(userId),
 * }, { timeoutMs: 5000 });
 *
 * for (const [name, result] of Object.entries(results)) {
 *   if (result.success) {
 *     console.log(`${name}: ${result.value}`);
 *   } else if (result.timedOut) {
 *     console.log(`${name} timed out`);
 *   } else {
 *     console.log(`${name} failed: ${result.error?.message}`);
 *   }
 * }
 * ```
 */
export async function executeParallel<T>(
  namedPromises: Record<string, () => Promise<T>>,
  options: WithTimeoutOptions = {}
): Promise<Record<string, NamedPromiseResult<T>>> {
  const entries = Object.entries(namedPromises);
  const startTimes = new Map<string, number>();

  // Create wrapped promises with timing
  const wrappedPromises = entries.map(async ([name, promiseFactory]) => {
    startTimes.set(name, performance.now());
    try {
      const value = await withTimeout(promiseFactory(), {
        ...options,
        operation: name,
      });
      return {
        name,
        success: true as const,
        value,
        timedOut: false as const,
        durationMs: Math.round(performance.now() - startTimes.get(name)!),
      };
    } catch (error) {
      const timedOut = isTimeoutError(error);
      return {
        name,
        success: false as const,
        error: error instanceof Error ? error : new Error(String(error)),
        timedOut,
        durationMs: Math.round(performance.now() - startTimes.get(name)!),
      };
    }
  });

  // Execute all in parallel
  const results = await Promise.all(wrappedPromises);

  // Convert to named object
  return Object.fromEntries(results.map((r) => [r.name, r]));
}

// ===========================================
// String Utilities
// ===========================================

/**
 * Truncate a string to a maximum length with ellipsis.
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length including ellipsis
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated string
 */
export function truncate(
  str: string,
  maxLength: number,
  ellipsis: string = '...'
): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Extract domain from email address.
 *
 * @param email - Email address
 * @returns Domain part of the email
 */
export function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf('@');
  return atIndex >= 0 ? email.slice(atIndex + 1) : email;
}

/**
 * Normalize company name for cache keys.
 *
 * @param name - Company name
 * @returns Normalized name (lowercase, alphanumeric with hyphens)
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ===========================================
// Date/Time Utilities
// ===========================================

/**
 * Calculate hours until a given date.
 *
 * @param date - Target date
 * @returns Hours until the date (negative if in the past)
 */
export function hoursUntil(date: Date | string): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

/**
 * Calculate minutes until a given date.
 *
 * @param date - Target date
 * @returns Minutes until the date (negative if in the past)
 */
export function minutesUntil(date: Date | string): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  return (target.getTime() - now.getTime()) / (1000 * 60);
}

/**
 * Check if a date is within N minutes from now.
 *
 * @param date - Target date
 * @param minutes - Number of minutes
 * @returns True if the date is within the specified minutes
 */
export function isWithinMinutes(date: Date | string, minutes: number): boolean {
  const mins = minutesUntil(date);
  return mins >= 0 && mins <= minutes;
}
