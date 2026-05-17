/**
 * ClaudeAgentBackend - Claude Code CLI wrapper.
 *
 * Wraps the `claude` CLI tool directly, spawning it as a child process with
 * `--output-format stream-json --include-partial-messages` for smooth
 * token-by-token streaming.
 *
 * Ported from Calyx's src/chat/backends/ClaudeAgentBackend.ts. The port is
 * mechanical: type annotations stripped, ES imports converted to CommonJS,
 * `getClaudePath` extracted to ./binaryResolver. Runtime behavior is
 * identical — same arg construction, same NDJSON parsing, same event types,
 * same permission mode mapping, same session capture.
 */

const { spawn } = require("child_process");
const { getClaudePath } = require("./binaryResolver");

/**
 * ClaudeAgentBackend implements ChatBackend by spawning the Claude Code CLI.
 *
 * Uses `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages`
 * which emits newline-delimited JSON with the same stream_event format as the
 * Anthropic streaming API (content_block_start, content_block_delta,
 * content_block_stop). See `stream()` below for the translation.
 */
class ClaudeAgentBackend {
  constructor() {
    /** @type {import('child_process').ChildProcess | null} */
    this.process = null;
    /** @type {string | null} */
    this.sessionId = null;
    this.streaming = false;
    this.cancelled = false;
    /** @type {import('./ChatBackend').BackendConfig | null} */
    this.config = null;
    this.stderrBuffer = "";

    // Async iterator plumbing: events are pushed by stdout handler, consumed by stream()
    // Holds both BackendEvents and internal raw wrappers (_raw_stream_event, etc.).
    /** @type {any[]} */
    this.eventQueue = [];
    /** @type {(() => void) | null} */
    this.eventResolve = null;
    this.streamDone = false;
  }

  /**
   * Initialize the backend with configuration.
   * @param {import('./ChatBackend').BackendConfig} config
   * @returns {Promise<void>}
   */
  async start(config) {
    if (this.process) {
      await this.close();
    }
    this.config = config;
    this.cancelled = false;
    this.sessionId = null;
  }

  /**
   * Update config without resetting the session.
   * Called before each send() to pick up permission mode changes, model switches, etc.
   * @param {import('./ChatBackend').BackendConfig} config
   */
  updateConfig(config) {
    this.config = config;
  }

  /**
   * Resume an existing session by ID.
   * @param {string} sessionIdToResume
   * @param {import('./ChatBackend').BackendConfig} config
   * @returns {Promise<void>}
   */
  async resume(sessionIdToResume, config) {
    if (this.process) {
      await this.close();
    }
    this.config = config;
    this.cancelled = false;
    this.sessionId = sessionIdToResume;
  }

  /**
   * Send a message and start streaming the response.
   * Spawns `claude` CLI as a child process.
   * @param {import('./ChatBackend').BackendInput} input
   * @param {import('./ChatBackend').BackendTurnConfig} [_turn]
   * @returns {Promise<void>}
   */
  async send(input, _turn) {
    if (!this.config) {
      throw new Error("Backend not started - call start() first");
    }
    if (this.streaming) {
      throw new Error(
        "Already streaming - call cancel() first or wait for completion"
      );
    }

    this.streaming = true;
    this.cancelled = false;
    this.stderrBuffer = "";
    this.eventQueue = [];
    this.eventResolve = null;
    this.streamDone = false;

    // Build the text content
    let textContent = "";
    if (input.context) {
      textContent += input.context + "\n\n";
    }
    textContent += input.content;

    // Build CLI args — prompt is piped via stdin to avoid argument length limits
    const args = [
      "-p", // Print mode (non-interactive)
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];

    // Pass the user's chosen model to the CLI. `this.config.model` comes from
    // the caller (Claude-only key in Calyx; same idea here) so it can never
    // bleed in from a different provider/model. If the user's subscription
    // doesn't include the chosen tier the CLI will report it — we pass
    // through transparently.
    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    // Session resume
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    // System prompt — also piped to avoid arg length limits for long system prompts
    if (this.config.systemPrompt) {
      args.push("--append-system-prompt", this.config.systemPrompt);
    }

    // Permission mode — CLI runs in non-interactive `-p` mode, so there's no
    // way to interactively approve tool calls. Map UI modes to CLI equivalents:
    //   plan           → --permission-mode plan (read-only, works fine)
    //   default        → --permission-mode acceptEdits (can't prompt in -p mode,
    //                    so auto-approve edits but block bash for safety)
    //   acceptEdits    → --permission-mode acceptEdits
    //   bypassPerms    → --dangerously-skip-permissions (everything auto-approved)
    if (this.config.permissionMode) {
      switch (this.config.permissionMode) {
        case "bypassPermissions":
          args.push("--dangerously-skip-permissions");
          break;
        case "plan":
          args.push("--permission-mode", "plan");
          break;
        case "default":
        case "acceptEdits":
          // In non-interactive mode, "default" (review edits) can't prompt for
          // approval, so we treat it the same as acceptEdits
          args.push("--permission-mode", "acceptEdits");
          break;
      }
    }

    // Tool allowlist. The caller may supply an explicit list (V1 hardening from
    // Codex/Gemini review point #1 — without this, "Edit mode" would have
    // effectively unrestricted tool access including Bash). MCP server tools
    // are still merged in.
    const allowedTools = [];
    if (Array.isArray(this.config.allowedTools)) {
      allowedTools.push(...this.config.allowedTools);
    }
    if (
      this.config.mcpServers &&
      Object.keys(this.config.mcpServers).length > 0
    ) {
      for (const serverName of Object.keys(this.config.mcpServers)) {
        allowedTools.push(`mcp__${serverName}__*`);
      }
    }
    if (allowedTools.length > 0) {
      args.push("--allowedTools", ...allowedTools);
    }

    // Disallow list — belt and suspenders for Bash and other dangerous tools
    // we never want the post-meeting agent to touch. If the caller passes
    // disallowedTools, prefer that; otherwise default to blocking Bash unless
    // it was explicitly allowed above.
    const disallowedTools = Array.isArray(this.config.disallowedTools)
      ? [...this.config.disallowedTools]
      : [];
    if (
      !disallowedTools.includes("Bash") &&
      !allowedTools.includes("Bash")
    ) {
      disallowedTools.push("Bash");
    }
    if (disallowedTools.length > 0) {
      args.push("--disallowedTools", ...disallowedTools);
    }

    // Extra directories the agent may read/operate in. Used by the
    // post-meeting flow to expose the transcript file (which lives under
    // app userData, outside the vault cwd) without widening cwd itself.
    if (Array.isArray(this.config.addDirs) && this.config.addDirs.length > 0) {
      args.push("--add-dir", ...this.config.addDirs);
    }

    // Build environment — extend PATH to ensure claude is findable
    // Build environment via allowlist (Codex review point #5).
    // We do NOT inherit the full process.env — that would leak unrelated
    // secrets, app internals, and inherited tokens into a tool-running agent.
    const env = {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      SHELL: process.env.SHELL || "/bin/zsh",
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "",
      USER: process.env.USER || "",
      TERM: process.env.TERM || "xterm-256color",
      // Pass keychain SSH agent + Homebrew prefix so Claude auth can find things,
      // but nothing else.
      ...(process.env.SSH_AUTH_SOCK
        ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }
        : {}),
      ...(process.env.HOMEBREW_PREFIX
        ? { HOMEBREW_PREFIX: process.env.HOMEBREW_PREFIX }
        : {}),
    };
    if (this.config.apiKey) {
      env.ANTHROPIC_API_KEY = this.config.apiKey;
    }

    // Resolve the claude binary path. Caller may pass a configured override.
    const claudePath = getClaudePath({ configuredPath: this.config.cliPath });
    if (!claudePath) {
      this.pushBackendEvent({
        type: "error",
        error:
          "Claude Code CLI not found. Install with `npm i -g @anthropic-ai/claude-code` or set agentCliPath in settings.",
      });
      this.finishStream();
      return;
    }
    console.log(
      `[ClaudeCLI] Spawning: ${claudePath} with ${args.length} args, cwd: ${this.config.workspaceRoot}`
    );

    // Spawn the CLI
    this.process = spawn(claudePath, args, {
      cwd: this.config.workspaceRoot || undefined,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write prompt to stdin and close it
    if (this.process.stdin) {
      this.process.stdin.write(textContent);
      this.process.stdin.end();
    }

    // Parse NDJSON from stdout
    let buffer = "";
    if (this.process.stdout) {
      this.process.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete last line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this.pushEvent(msg);
          } catch {
            // Skip unparseable lines (CLI may emit non-JSON diagnostic output)
          }
        }
      });
    }

    // Capture stderr
    if (this.process.stderr) {
      this.process.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        console.error("[Claude CLI stderr]:", text);
        this.stderrBuffer += text;
      });
    }

    // Handle process exit
    this.process.on("close", (code) => {
      // Flush any remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          this.pushEvent(msg);
        } catch {
          // ignore
        }
      }

      if (code !== 0 && code !== null && !this.streamDone && !this.cancelled) {
        this.pushBackendEvent({
          type: "error",
          error: `Claude CLI exited with code ${code}`,
          errorDetails: this.stderrBuffer.trim() || undefined,
        });
      }
      this.finishStream();
    });

    this.process.on("error", (err) => {
      const classified = classifyError(err.message, this.stderrBuffer);
      this.pushBackendEvent({
        type: "error",
        error: classified.title + " — " + classified.message,
        errorDetails: this.stderrBuffer.trim() || undefined,
      });
      this.finishStream();
    });
  }

  /**
   * Push a raw CLI JSON message into the event queue after translating it.
   * @param {any} msg
   */
  pushEvent(msg) {
    // Capture session ID from any message
    if (msg.session_id && msg.session_id !== this.sessionId) {
      this.sessionId = msg.session_id;
      this.pushBackendEvent({ type: "sdk_session", sessionId: msg.session_id });
    }

    switch (msg.type) {
      case "stream_event": {
        // Streaming events — identical format to the Anthropic API
        // content_block_start, content_block_delta, content_block_stop, message_stop
        // These are forwarded as-is and translated in stream()
        this.pushBackendEvent({ type: "_raw_stream_event", event: msg.event });
        break;
      }

      case "assistant": {
        // Complete assistant message (emitted alongside stream events when
        // --include-partial-messages is used). We use this as a fallback
        // for tool calls that weren't captured via stream events.
        this.pushBackendEvent({ type: "_raw_assistant", message: msg.message });
        break;
      }

      case "user": {
        // User messages contain tool results
        this.pushBackendEvent({ type: "_raw_user", message: msg.message });
        break;
      }

      case "result": {
        // Final result — close stdin so the process can exit
        if (msg.subtype === "error_during_execution") {
          const errors = (msg.errors && msg.errors.join(", ")) || "Unknown error";
          const classified = classifyError(errors, this.stderrBuffer);
          this.pushBackendEvent({
            type: "error",
            error: classified.title + " — " + classified.message,
            errorDetails: this.stderrBuffer.trim() || undefined,
          });
        }
        this.streamDone = true;
        break;
      }

      case "system": {
        // System messages (init, hooks)
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id;
        }
        // Ignore hook_started, hook_response, etc.
        break;
      }

      // Ignore: rate_limit_event, etc.
    }
  }

  /**
   * Push an event into the queue, waking up the consumer if waiting.
   * @param {any} event
   */
  pushBackendEvent(event) {
    this.eventQueue.push(event);
    if (this.eventResolve) {
      const resolve = this.eventResolve;
      this.eventResolve = null;
      resolve();
    }
  }

  /**
   * Signal that no more events will arrive.
   */
  finishStream() {
    this.streamDone = true;
    this.streaming = false;
    // Wake up consumer
    if (this.eventResolve) {
      const resolve = this.eventResolve;
      this.eventResolve = null;
      resolve();
    }
  }

  /**
   * Wait for at least one event to be available.
   * @returns {Promise<void>}
   */
  waitForEvent() {
    if (this.eventQueue.length > 0 || this.streamDone) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.eventResolve = resolve;
    });
  }

  /**
   * Stream events from the backend.
   *
   * Translates raw CLI events into BackendEvent objects. The stream_event
   * messages from the CLI are identical to the Anthropic streaming API format,
   * so the translation logic is the same as was used with the Agent SDK.
   *
   * @returns {AsyncGenerator<import('./ChatBackend').BackendEvent>}
   */
  async *stream() {
    // Track content blocks by index for proper correlation
    /** @type {Map<number, {type: 'text'|'thinking'|'tool_use', id?: string, name?: string, startTime: number, content: string, inputJson: string, _lastArtifactContent?: string}>} */
    const contentBlocks = new Map();

    // Track tool calls separately for result matching
    /** @type {Map<string, number>} */
    const toolStartTimes = new Map();
    /** @type {Map<string, Object<string, any>>} */
    const toolInputs = new Map();

    let currentTextContent = "";

    try {
      while (true) {
        await this.waitForEvent();

        // Drain all available events
        while (this.eventQueue.length > 0) {
          if (this.cancelled) {
            yield { type: "done" };
            return;
          }

          const raw = this.eventQueue.shift();

          // Handle our internal raw event wrappers
          if (raw.type === "_raw_stream_event") {
            const event = raw.event;
            const blockIndex = event.index != null ? event.index : 0;

            // Content block start
            if (event.type === "content_block_start") {
              const block = event.content_block;

              if (block && block.type === "thinking") {
                contentBlocks.set(blockIndex, {
                  type: "thinking",
                  startTime: Date.now(),
                  content: "",
                  inputJson: "",
                });
                yield { type: "thinking_start" };
              } else if (block && block.type === "tool_use") {
                const toolId = block.id;
                const toolName = block.name;
                contentBlocks.set(blockIndex, {
                  type: "tool_use",
                  id: toolId,
                  name: toolName,
                  startTime: Date.now(),
                  content: "",
                  inputJson: "",
                });
                toolStartTimes.set(toolId, Date.now());
                yield {
                  type: "tool_start",
                  id: toolId,
                  name: toolName,
                  input: {},
                };
              } else if (block && block.type === "text") {
                contentBlocks.set(blockIndex, {
                  type: "text",
                  startTime: Date.now(),
                  content: "",
                  inputJson: "",
                });
              }
            }

            // Content block delta
            if (event.type === "content_block_delta") {
              const delta = event.delta;
              const block = contentBlocks.get(blockIndex);

              if (delta && delta.type === "text_delta") {
                const chunk = delta.text;
                currentTextContent += chunk;
                if (block) block.content += chunk;
                yield { type: "text", chunk };
              } else if (delta && delta.type === "thinking_delta") {
                const chunk = delta.thinking;
                if (block) block.content += chunk;
                yield { type: "thinking", chunk };
              } else if (delta && delta.type === "input_json_delta") {
                const jsonChunk = delta.partial_json;
                if (block && block.type === "tool_use") {
                  block.inputJson += jsonChunk;

                  // Partial content extraction for artifact tools
                  if (
                    block.name === "create_artifact" ||
                    block.name === "update_artifact"
                  ) {
                    const partialContent = extractPartialArtifactContent(
                      block.inputJson
                    );
                    if (
                      partialContent !== null &&
                      partialContent !== block._lastArtifactContent
                    ) {
                      block._lastArtifactContent = partialContent;
                      yield {
                        type: "artifact_delta",
                        toolId: block.id,
                        content: partialContent,
                      };
                    }
                  }
                }
              }
            }

            // Content block stop
            if (event.type === "content_block_stop") {
              const block = contentBlocks.get(blockIndex);

              if (block && block.type === "thinking") {
                yield {
                  type: "thinking_end",
                  content: block.content,
                  durationMs: Date.now() - block.startTime,
                };
              } else if (block && block.type === "tool_use" && block.id) {
                try {
                  const input = block.inputJson
                    ? JSON.parse(block.inputJson)
                    : {};
                  toolInputs.set(block.id, input);
                  yield {
                    type: "tool_input",
                    id: block.id,
                    input,
                  };
                } catch {
                  toolInputs.set(block.id, {});
                }
              }

              contentBlocks.delete(blockIndex);
            }

            // Message stop
            if (event.type === "message_stop") {
              yield { type: "text_end", content: currentTextContent };
            }

            continue;
          }

          if (raw.type === "_raw_assistant") {
            // Complete assistant message — emit tool calls not seen in stream
            const message = raw.message;
            const content = extractTextContent(message);

            if (!currentTextContent || content !== currentTextContent) {
              yield { type: "text_end", content };
            }

            for (const block of (message && message.content) || []) {
              if (block.type === "tool_use") {
                const toolId = block.id;
                const toolName = block.name;
                const input = block.input;

                if (!toolStartTimes.has(toolId)) {
                  toolStartTimes.set(toolId, Date.now());
                  toolInputs.set(toolId, input);
                  yield {
                    type: "tool_start",
                    id: toolId,
                    name: toolName,
                    input,
                  };
                }
              }
            }

            continue;
          }

          if (raw.type === "_raw_user") {
            // User messages contain tool results
            const message = raw.message;

            for (const block of (message && message.content) || []) {
              if (block.type === "tool_result") {
                const toolId = block.tool_use_id;
                if (toolId && toolStartTimes.has(toolId)) {
                  const startTime = toolStartTimes.get(toolId);
                  const isError = block.is_error === true;
                  const content = block.content;

                  yield {
                    type: "tool_end",
                    id: toolId,
                    output: isError ? undefined : formatToolOutput(content),
                    error: isError ? formatToolOutput(content) : undefined,
                    durationMs: Date.now() - startTime,
                  };

                  toolStartTimes.delete(toolId);
                  toolInputs.delete(toolId);
                }
              }
            }

            continue;
          }

          // Pass through standard BackendEvents (error, sdk_session)
          yield raw;
        }

        // If stream is done and queue is empty, we're finished
        if (this.streamDone && this.eventQueue.length === 0) {
          break;
        }
      }

      // Complete any remaining tools that didn't get explicit results
      for (const [toolId, startTime] of toolStartTimes) {
        yield {
          type: "tool_end",
          id: toolId,
          output: "(completed)",
          durationMs: Date.now() - startTime,
        };
      }
      toolStartTimes.clear();
      toolInputs.clear();

      yield { type: "done" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const classified = classifyError(errorMessage, this.stderrBuffer);
      yield {
        type: "error",
        error: classified.title + " — " + classified.message,
        errorDetails: this.stderrBuffer.trim() || undefined,
      };
    } finally {
      this.streaming = false;
      this.process = null;
    }
  }

  /**
   * Cancel the current stream.
   */
  cancel() {
    this.cancelled = true;
    this.streaming = false;
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  /**
   * Close the session and clean up.
   * @returns {Promise<void>}
   */
  async close() {
    this.cancel();
    this.process = null;
    this.sessionId = null;
    this.config = null;
    this.eventQueue = [];
    this.streamDone = false;
  }

  /**
   * Check if currently streaming.
   * @returns {boolean}
   */
  isStreaming() {
    return this.streaming;
  }

  /**
   * Get the current session ID.
   * @returns {string | null}
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * @returns {import('./ChatBackend').BackendCapabilities}
   */
  getCapabilities() {
    return { agents: false };
  }
}

/**
 * Classify a raw error + stderr into a user-friendly title and message.
 * @param {string} error
 * @param {string} stderr
 * @returns {{title: string, message: string}}
 */
function classifyError(error, stderr) {
  const combined = `${error}\n${stderr}`.toLowerCase();

  if (
    combined.includes("not logged in") ||
    combined.includes("claude login")
  ) {
    return {
      title: "Not Authenticated",
      message:
        "Run `claude login` in a terminal to authenticate with your Claude account.",
    };
  }

  if (
    combined.includes("command not found") ||
    combined.includes("enoent") ||
    combined.includes("spawn")
  ) {
    return {
      title: "Claude Code Not Found",
      message: "Install it with `npm i -g @anthropic-ai/claude-code`.",
    };
  }

  if (combined.includes("rate limit") || combined.includes("429")) {
    return {
      title: "Rate Limited",
      message: "Wait a moment and try again.",
    };
  }

  if (
    combined.includes("401") ||
    combined.includes("unauthorized") ||
    /invalid.*key/.test(combined)
  ) {
    return {
      title: "Authentication Error",
      message: "Try running `claude login` in a terminal.",
    };
  }

  if (
    combined.includes("network") ||
    combined.includes("econnrefused") ||
    combined.includes("fetch failed")
  ) {
    return {
      title: "Network Error",
      message: "Check your internet connection.",
    };
  }

  if (combined.includes("exited with code 1")) {
    return {
      title: "Claude Code Failed",
      message:
        "Try running `claude login` in a terminal to check your authentication." +
        (stderr.trim() ? `\n\nDetails:\n${stderr.trim()}` : ""),
    };
  }

  return {
    title: "Claude Code Error",
    message: error + (stderr.trim() ? `\n\nDetails:\n${stderr.trim()}` : ""),
  };
}

/**
 * Extract text content from an assistant message.
 * @param {any} message
 * @returns {string}
 */
function extractTextContent(message) {
  if (!message || !message.content) return "";

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Format tool output for display.
 * @param {any} content
 * @returns {string}
 */
function formatToolOutput(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && item.type === "text") return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

/**
 * Extract the `content` field value from a partial JSON string being streamed.
 *
 * During tool call streaming, the JSON input arrives incrementally. For artifact
 * tools, we want to extract the `content` field as it streams so we can render
 * progressively. The JSON is incomplete (no closing braces/quotes yet).
 *
 * @param {string} partialJson
 * @returns {string | null} The extracted content string, or null if not found yet.
 */
function extractPartialArtifactContent(partialJson) {
  const markers = ['"content":"', '"content": "'];
  let startIdx = -1;

  for (const marker of markers) {
    const idx = partialJson.indexOf(marker);
    if (idx !== -1) {
      startIdx = idx + marker.length;
      break;
    }
  }

  if (startIdx === -1) {
    return null;
  }

  const raw = partialJson.slice(startIdx);
  let result = "";
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '"') {
      break;
    }

    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      switch (next) {
        case '"':
          result += '"';
          i += 2;
          continue;
        case "\\":
          result += "\\";
          i += 2;
          continue;
        case "n":
          result += "\n";
          i += 2;
          continue;
        case "t":
          result += "\t";
          i += 2;
          continue;
        case "r":
          result += "\r";
          i += 2;
          continue;
        case "/":
          result += "/";
          i += 2;
          continue;
        case "b":
          result += "\b";
          i += 2;
          continue;
        case "f":
          result += "\f";
          i += 2;
          continue;
        case "u":
          if (i + 5 < raw.length) {
            const hex = raw.slice(i + 2, i + 6);
            const code = parseInt(hex, 16);
            if (!isNaN(code)) {
              result += String.fromCharCode(code);
              i += 6;
              continue;
            }
          }
          break;
        default:
          if (i + 1 === raw.length) {
            break;
          }
          result += next;
          i += 2;
          continue;
      }
      break;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Create a new ClaudeAgentBackend instance.
 * @returns {ClaudeAgentBackend}
 */
function createClaudeAgentBackend() {
  return new ClaudeAgentBackend();
}

module.exports = {
  ClaudeAgentBackend,
  createClaudeAgentBackend,
  extractPartialArtifactContent,
};
