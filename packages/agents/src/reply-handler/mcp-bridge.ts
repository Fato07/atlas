/**
 * Reply Handler Agent - MCP Bridge
 *
 * Bridges TypeScript agent to Python MCP server via HTTP.
 * Provides the `callMcpTool` function signature required by the agent.
 *
 * @module reply-handler/mcp-bridge
 */

// ===========================================
// Types
// ===========================================

export interface McpToolResponse<T = unknown> {
  /** Tool execution result */
  result?: T;
  /** Error if tool failed */
  error?: string;
  /** Whether the call succeeded */
  success: boolean;
}

export interface McpBridgeConfig {
  /** MCP server base URL */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Optional headers to include in requests */
  headers?: Record<string, string>;
}

// ===========================================
// MCP Bridge Function
// ===========================================

/**
 * Create an MCP bridge function for calling MCP server tools.
 *
 * @param config - Bridge configuration
 * @returns A function that can call MCP tools
 *
 * @example
 * ```typescript
 * const callMcpTool = createMcpBridge({
 *   baseUrl: 'http://localhost:8000',
 *   timeout: 30000,
 * });
 *
 * const result = await callMcpTool<{ id: string }>('create_person', {
 *   email: 'user@example.com',
 *   name: 'John Doe',
 * });
 * ```
 */
export function createMcpBridge(config: McpBridgeConfig | string) {
  const { baseUrl, timeout = 30000, headers = {} } =
    typeof config === 'string' ? { baseUrl: config } : config;

  // Normalize URL (remove trailing slash)
  const normalizedUrl = baseUrl.replace(/\/$/, '');

  /**
   * Call an MCP tool on the server.
   *
   * @param tool - Tool name to invoke
   * @param params - Parameters to pass to the tool
   * @returns Tool execution result
   * @throws Error if the call fails
   */
  return async function callMcpTool<T>(
    tool: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${normalizedUrl}/tools/${tool}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Try to parse JSON body first - REST API returns {success, result/error} format
      let data: McpToolResponse<T>;
      try {
        data = (await response.json()) as McpToolResponse<T>;
      } catch {
        // If JSON parsing fails and response is not OK, throw with status
        if (!response.ok) {
          throw new Error(
            `MCP tool '${tool}' failed with status ${response.status}: Unable to parse response`
          );
        }
        throw new Error(`MCP tool '${tool}' returned invalid JSON`);
      }

      // Check for error in the response body
      if (data.success === false && data.error) {
        throw new Error(`MCP tool '${tool}' error: ${data.error}`);
      }

      // If response status is not OK but no error in body, throw with status
      if (!response.ok) {
        throw new Error(
          `MCP tool '${tool}' failed with status ${response.status}`
        );
      }

      return data.result as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP tool '${tool}' timed out after ${timeout}ms`);
      }

      throw error;
    }
  };
}

// ===========================================
// Mock Bridge for Testing
// ===========================================

/**
 * Create a mock MCP bridge for testing.
 *
 * @param mockResponses - Map of tool names to mock responses
 * @returns A mock callMcpTool function
 */
export function createMockMcpBridge(
  mockResponses: Record<string, unknown> = {}
) {
  return async function mockCallMcpTool<T>(
    tool: string,
    _params: Record<string, unknown>
  ): Promise<T> {
    if (tool in mockResponses) {
      return mockResponses[tool] as T;
    }

    // Default success responses for common tools
    const defaultResponses: Record<string, unknown> = {
      send_reply: { success: true, message_id: 'mock_msg_123' },
      find_person: { id: { record_id: 'mock_person_123' } },
      create_person: { id: { record_id: 'mock_person_456' } },
      update_pipeline_stage: { success: true },
      add_activity: { success: true },
      create_task: { success: true, task_id: 'mock_task_789' },
      add_insight: { status: 'created' },
    };

    if (tool in defaultResponses) {
      return defaultResponses[tool] as T;
    }

    throw new Error(`Mock MCP tool '${tool}' not configured`);
  };
}

// ===========================================
// Type Exports
// ===========================================

export type McpToolFunction = ReturnType<typeof createMcpBridge>;
