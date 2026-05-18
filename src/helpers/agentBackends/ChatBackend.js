/**
 * ChatBackend - Type definitions for AI chat backends (JSDoc).
 *
 * Ported from Calyx's src/chat/ChatBackend.ts. Since this is JavaScript, the
 * TypeScript interfaces are documented here as JSDoc typedefs so other modules
 * can `@type` annotate their parameters and IDEs can offer completion.
 *
 * The runtime exports below are only the small set of string constants
 * (permission modes, attachment types) that downstream code may want to
 * import without redefining.
 */

// ============================================
// Permission modes
// ============================================

/**
 * @typedef {"plan" | "default" | "acceptEdits" | "bypassPermissions"} PermissionMode
 *
 * - "plan"             — read-only planning mode
 * - "default"          — review edits (in non-interactive CLI runs this is
 *                        treated the same as acceptEdits since there is no
 *                        way to interactively approve)
 * - "acceptEdits"      — auto-approve edits, still block bash for safety
 * - "bypassPermissions" — auto-approve everything (`--dangerously-skip-permissions`)
 */
const PERMISSION_MODES = Object.freeze([
  "plan",
  "default",
  "acceptEdits",
  "bypassPermissions",
]);

// ============================================
// Attachment types
// ============================================

/**
 * @typedef {"file" | "folder" | "image"} AttachmentType
 */

/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {AttachmentType} type
 * @property {string} name
 * @property {string} path
 * @property {string} [relativePath]
 * @property {string} [data]        Base64 data for images
 * @property {string} [mimeType]    MIME type for images
 * @property {number} [size]        File size in bytes
 * @property {boolean} [truncated]  Whether the file was truncated due to size limits
 */

const ATTACHMENT_TYPES = Object.freeze(["file", "folder", "image"]);

/** Built-in CLI tool names the agent may request. */
const AGENT_TOOLS = Object.freeze({
  Read: "Read",
  Glob: "Glob",
  Grep: "Grep",
  Write: "Write",
  Edit: "Edit",
  Bash: "Bash",
});

/** Tools whose output is large and not useful to display in the chat. */
const BULK_READ_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);

// ============================================
// Backend events (emitted during streaming)
// ============================================

/**
 * Events emitted by the backend while streaming. Discriminated union on `type`.
 *
 * @typedef {(
 *   | { type: "text", chunk: string }
 *   | { type: "text_end", content: string }
 *   | { type: "thinking_start" }
 *   | { type: "thinking", chunk: string }
 *   | { type: "thinking_end", content: string, durationMs: number }
 *   | { type: "tool_start", id: string, name: string, input: Object<string, any> }
 *   | { type: "tool_input", id: string, input: Object<string, any> }
 *   | { type: "tool_end", id: string, output?: string, error?: string, durationMs: number }
 *   | { type: "sdk_session", sessionId: string }
 *   | { type: "artifact_delta", toolId: string, content: string }
 *   | { type: "permission_request", requestId: string, toolName: string, toolInput: Object<string, any>, title: string, displayName: string, toolUseId: string }
 *   | { type: "error", error: string, errorDetails?: string }
 *   | { type: "done" }
 * )} BackendEvent
 */

// ============================================
// MCP server configuration
// ============================================

/**
 * @typedef {Object} McpServerConfig
 * @property {"stdio" | "http" | "sse"} type
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {string} [url]
 * @property {Object<string, string>} [env]
 * @property {Object<string, string>} [headers]
 * @property {string} [cwd]
 */

// ============================================
// Backend configuration
// ============================================

/**
 * Configuration for initializing a backend session.
 *
 * @typedef {Object} BackendConfig
 * @property {string} [model]               Model identifier (e.g. "claude-sonnet-4-20250514").
 *                                          Optional — Claude backend leaves this undefined so the CLI picks its own model.
 * @property {string} [provider]            Provider identifier (e.g. "anthropic", "google", "openai").
 * @property {string} systemPrompt          System prompt for the assistant.
 * @property {PermissionMode} permissionMode Permission mode controlling what the agent can do.
 * @property {Object<string, McpServerConfig>} [mcpServers] MCP server configurations.
 * @property {string} [apiKey]              API key (if not using environment variable).
 * @property {string} [workspaceRoot]       Working directory for the agent (defaults to workspace root).
 * @property {(toolName: string, input: Object<string, any>) => Promise<{behavior: "allow" | "deny", updatedInput?: Object<string, any>}>} [canUseTool]
 *           Permission callback for 'default' mode; called before tool execution to get user approval.
 */

// ============================================
// Backend input (message to send)
// ============================================

/**
 * Input for sending a message to the backend.
 *
 * @typedef {Object} BackendInput
 * @property {string} content              User message content.
 * @property {Attachment[]} [attachments]  Attached files, folders, or images.
 * @property {string} [context]            Pre-resolved context (file contents, etc.) as a string.
 */

// ============================================
// Agent types
// ============================================

/**
 * @typedef {string} AgentId
 * Branded type alias for agent identifiers.
 */

/**
 * @typedef {"builtin" | "filesystem" | "vault"} AgentSource
 * Where an agent definition comes from.
 */

/**
 * Agent descriptor returned by capability queries.
 *
 * @typedef {Object} AgentInfo
 * @property {AgentId} id
 * @property {string} label
 * @property {string} [description]
 * @property {AgentSource} source
 * @property {string} [mode]
 * @property {string} [color]
 */

/**
 * Per-turn execution config (not session-level, not user payload).
 *
 * @typedef {Object} BackendTurnConfig
 * @property {AgentId} [agent]
 * @property {Object<string, boolean>} [tools]
 */

/**
 * Backend capabilities — replaces scattered supportsX booleans.
 *
 * @typedef {Object} BackendCapabilities
 * @property {boolean} agents
 */

// ============================================
// ChatBackend interface (documented for reference)
// ============================================

/**
 * Abstract interface for AI chat backends. Implementations must provide:
 *   - Session lifecycle management (start, close)
 *   - Message sending with streaming
 *   - Cancellation support
 *
 * The interface uses async iterators for streaming, allowing the service layer
 * to process events as they arrive.
 *
 * Methods (see ClaudeAgentBackend for a concrete implementation):
 *
 *   start(config: BackendConfig): Promise<void>
 *   resume(sessionId: string, config: BackendConfig): Promise<void>
 *   updateConfig(config: BackendConfig): void
 *   send(input: BackendInput, turn?: BackendTurnConfig): Promise<void>
 *   stream(): AsyncIterable<BackendEvent>
 *   cancel(): void
 *   close(): Promise<void>
 *   isStreaming(): boolean
 *   getSessionId(): string | null
 *   getCapabilities(): BackendCapabilities
 *   respondToPermission?(requestId, decision, message?): void
 *   listAgents?(): Promise<AgentInfo[]>
 *
 * @typedef {Object} ChatBackend
 */

module.exports = {
  PERMISSION_MODES,
  ATTACHMENT_TYPES,
  AGENT_TOOLS,
  BULK_READ_TOOLS,
};
