/**
 * Langfuse Client Singleton
 *
 * Provides a singleton Langfuse client instance for observability.
 * Handles initialization, configuration, and graceful shutdown.
 */

import { Langfuse } from 'langfuse';
import type { LangfuseConfig } from './types';
import { LANGFUSE_ENV_VARS } from './types';

// ===========================================
// Singleton Instance
// ===========================================

let langfuseInstance: Langfuse | null = null;
let isEnabled = true;

/**
 * Get Langfuse configuration from environment variables
 */
function getConfigFromEnv(): LangfuseConfig | null {
  const publicKey = process.env[LANGFUSE_ENV_VARS.publicKey];
  const secretKey = process.env[LANGFUSE_ENV_VARS.secretKey];

  if (!publicKey || !secretKey) {
    return null;
  }

  return {
    publicKey,
    secretKey,
    baseUrl: process.env[LANGFUSE_ENV_VARS.baseUrl] || 'https://cloud.langfuse.com',
    enabled: process.env.LANGFUSE_ENABLED !== 'false',
  };
}

/**
 * Initialize the Langfuse client singleton
 *
 * @param config - Optional configuration override
 * @returns The Langfuse client instance or null if disabled/misconfigured
 */
export function initLangfuse(config?: Partial<LangfuseConfig>): Langfuse | null {
  // Return existing instance if already initialized
  if (langfuseInstance) {
    return langfuseInstance;
  }

  // Get config from env or use provided config
  const envConfig = getConfigFromEnv();
  const finalConfig = { ...envConfig, ...config };

  // Check if we have required credentials
  if (!finalConfig.publicKey || !finalConfig.secretKey) {
    console.warn(
      '[Langfuse] Missing credentials. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY environment variables.'
    );
    isEnabled = false;
    return null;
  }

  // Check if explicitly disabled
  if (finalConfig.enabled === false) {
    console.info('[Langfuse] Observability disabled via configuration.');
    isEnabled = false;
    return null;
  }

  try {
    langfuseInstance = new Langfuse({
      publicKey: finalConfig.publicKey,
      secretKey: finalConfig.secretKey,
      baseUrl: finalConfig.baseUrl,
      flushAt: finalConfig.flushAt ?? 15,
      flushInterval: finalConfig.flushInterval ?? 10000,
      requestTimeout: finalConfig.requestTimeout ?? 10000,
    });

    isEnabled = true;
    console.info('[Langfuse] Client initialized successfully.');

    return langfuseInstance;
  } catch (error) {
    console.error('[Langfuse] Failed to initialize client:', error);
    isEnabled = false;
    return null;
  }
}

/**
 * Get the Langfuse client instance
 *
 * @returns The Langfuse client or null if not initialized/disabled
 */
export function getLangfuse(): Langfuse | null {
  if (!isEnabled) {
    return null;
  }

  if (!langfuseInstance) {
    // Try to auto-initialize from environment
    return initLangfuse();
  }

  return langfuseInstance;
}

/**
 * Check if Langfuse observability is enabled
 */
export function isLangfuseEnabled(): boolean {
  return isEnabled && langfuseInstance !== null;
}

/**
 * Flush all pending events to Langfuse
 *
 * Call this before process exit to ensure all traces are sent.
 */
export async function flushLangfuse(): Promise<void> {
  if (langfuseInstance) {
    try {
      await langfuseInstance.flushAsync();
      console.info('[Langfuse] Flushed all pending events.');
    } catch (error) {
      console.error('[Langfuse] Failed to flush events:', error);
    }
  }
}

/**
 * Shutdown the Langfuse client
 *
 * Flushes pending events and cleans up resources.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (langfuseInstance) {
    try {
      await langfuseInstance.shutdownAsync();
      langfuseInstance = null;
      console.info('[Langfuse] Client shutdown complete.');
    } catch (error) {
      console.error('[Langfuse] Failed to shutdown client:', error);
    }
  }
}

/**
 * Reset the Langfuse client (for testing purposes)
 */
export function resetLangfuse(): void {
  langfuseInstance = null;
  isEnabled = true;
}
