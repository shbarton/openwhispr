/**
 * useAgentBackendStream - React hook that wraps the CLI agent IPC stream.
 *
 * Talks to the main-process `agentBackendManager` via the IPC channels exposed
 * in preload.js (`cliAgent*`). Translates the CliAgentBackendEvent stream into
 * a Message[] suitable for ChatMessages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CliAgentBackendEvent,
  CliAgentPreflightResult,
} from "../../types/electron";
import type { AgentState, Message, ToolCallInfo } from "../chat/types";

interface UseAgentBackendStreamOptions {
  systemPrompt: string;
  vaultPath: string;
  model?: string;
  cliPath?: string;
  /**
   * If true, restrict the agent to Read/Glob/Grep + plan permission mode.
   * Default is the full toolkit with bypassPermissions.
   */
  readOnly: boolean;
  /** Additional directories the agent is allowed to read (forwarded as --add-dir). */
  addDirs?: string[];
}

interface UseAgentBackendStreamResult {
  /** All conversation messages in order. */
  messages: Message[];
  /** Current backend lifecycle state. */
  agentState: AgentState;
  /** Most recent error, if any. */
  error: { message: string; code?: string } | null;
  /** Whether a session has been started for this hook instance. */
  hasSession: boolean;
  /** The current SDK session id, if captured. */
  sessionId: string | null;

  /** Send a user message (also creates the session if none). */
  send: (userMessage: string) => Promise<void>;
  /** Cancel the in-flight stream. */
  cancel: () => Promise<void>;
  /** Run a preflight check (binary, version, vault path). */
  preflight: () => Promise<CliAgentPreflightResult | null>;
  /** Reset messages and session. */
  reset: () => void;
}

const BULK_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);

/**
 * Translate a raw tool_end payload into a *short* display string. The
 * Read/Glob/Grep tools return potentially huge blobs and the user already
 * has the transcript in the left pane — show only "Read · transcript.txt".
 * Errors keep their full text. Other tools pass through truncated.
 */
function summarizeToolResult(
  tc: ToolCallInfo,
  output: string | undefined,
  error: string | undefined
): string | undefined {
  if (error) return error;
  if (!output) return undefined;

  if (!BULK_READ_TOOLS.has(tc.name)) {
    return output.length > 200 ? output.slice(0, 200) + "…" : output;
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.arguments || "{}");
  } catch {
    /* ignore */
  }
  const filePath =
    typeof args.file_path === "string"
      ? (args.file_path as string)
      : typeof args.path === "string"
        ? (args.path as string)
        : null;
  const pattern =
    typeof args.pattern === "string" ? (args.pattern as string) : null;

  if (filePath) {
    const base = filePath.split("/").pop() || filePath;
    return `${tc.name} · ${base}`;
  }
  if (pattern) {
    return `${tc.name} · "${pattern}"`;
  }
  return tc.name;
}

export function useAgentBackendStream(
  opts: UseAgentBackendStreamOptions
): UseAgentBackendStreamResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [error, setError] = useState<{ message: string; code?: string } | null>(
    null
  );
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Refs so the IPC callback closures see the latest state
  const currentStreamIdRef = useRef<string | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const sessionIdRef = useRef<string | null>(null);
  const lastConfigRef = useRef(opts);

  useEffect(() => {
    lastConfigRef.current = opts;
  }, [opts]);

  // Write the session-id ref synchronously alongside the state setter so
  // that send() never reads a stale value between a session update and the
  // next dispatch.
  const updateSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  // ── Wire IPC event listeners once ────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCliAgentStreamEvent) return;

    const unsubEvent = api.onCliAgentStreamEvent(({ streamId, event }) => {
      if (streamId !== currentStreamIdRef.current) return;
      handleEvent(event);
    });
    const unsubEnd = api.onCliAgentStreamEnd?.(({ streamId, sessionId: sid }) => {
      if (streamId !== currentStreamIdRef.current) return;
      if (sid) updateSessionId(sid);
      finalizeAssistant();
      setAgentState("idle");
      currentStreamIdRef.current = null;
    });
    const unsubError = api.onCliAgentStreamError?.(
      ({ streamId, error: errMsg, code }) => {
        if (streamId !== currentStreamIdRef.current) return;
        setError({ message: errMsg, code });
        finalizeAssistant();
        setAgentState("idle");
        currentStreamIdRef.current = null;
      }
    );

    return () => {
      // Cancel any in-flight subprocess so navigating away from the panel
      // doesn't leave `claude` running until the app quits.
      const liveId = currentStreamIdRef.current;
      if (liveId && api.cliAgentStreamCancel) {
        api.cliAgentStreamCancel(liveId).catch(() => {});
      }
      unsubEvent?.();
      unsubEnd?.();
      unsubError?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Event handler ────────────────────────────────────────────────────
  function handleEvent(event: CliAgentBackendEvent) {
    switch (event.type) {
      case "text": {
        accumulatedTextRef.current += event.chunk;
        const id = currentAssistantIdRef.current;
        if (id) {
          const accumulated = accumulatedTextRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: accumulated, isStreaming: true } : m
            )
          );
        }
        setAgentState("streaming");
        break;
      }
      case "text_end": {
        // The backend may emit multiple text_end events (one at
        // message_stop, another from _raw_assistant when the final message
        // shape differs). Replacing content each time causes visible
        // flicker. Trust the accumulator built from `text` chunks; this
        // event just marks streaming as done.
        const id = currentAssistantIdRef.current;
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m))
          );
        }
        break;
      }
      case "thinking_start":
      case "thinking":
      case "thinking_end":
        setAgentState("thinking");
        break;
      case "tool_start": {
        setAgentState("tool-executing");
        const id = currentAssistantIdRef.current;
        if (!id) return;
        const tc: ToolCallInfo = {
          id: event.id,
          name: event.name,
          arguments: JSON.stringify(event.input || {}),
          status: "executing",
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, toolCalls: [...(m.toolCalls || []), tc] }
              : m
          )
        );
        break;
      }
      case "tool_input": {
        // Backend emits tool_start with `input: {}` and the full parsed
        // input later as tool_input. Capture it so we can show "Read ·
        // transcript.txt" instead of "Read ·" with no detail.
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== id || !m.toolCalls) return m;
            return {
              ...m,
              toolCalls: m.toolCalls.map((tc) =>
                tc.id === event.id
                  ? { ...tc, arguments: JSON.stringify(event.input || {}) }
                  : tc
              ),
            };
          })
        );
        break;
      }
      case "tool_end": {
        const id = currentAssistantIdRef.current;
        if (!id) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== id || !m.toolCalls) return m;
            return {
              ...m,
              toolCalls: m.toolCalls.map((tc) => {
                if (tc.id !== event.id) return tc;
                return {
                  ...tc,
                  status: event.error ? "error" : "completed",
                  result: summarizeToolResult(tc, event.output, event.error),
                };
              }),
            };
          })
        );
        setAgentState("streaming");
        break;
      }
      case "sdk_session":
        updateSessionId(event.sessionId);
        break;
      case "error":
        setError({ message: event.error });
        finalizeAssistant();
        setAgentState("idle");
        break;
      case "done":
        finalizeAssistant();
        setAgentState("idle");
        break;
    }
  }

  function finalizeAssistant() {
    const id = currentAssistantIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m))
    );
    currentAssistantIdRef.current = null;
    accumulatedTextRef.current = "";
  }

  // ── Public API ───────────────────────────────────────────────────────
  const preflight = useCallback(async () => {
    if (!window.electronAPI?.cliAgentPreflight) return null;
    return window.electronAPI.cliAgentPreflight({
      vaultPath: lastConfigRef.current.vaultPath,
      agentCliPath: lastConfigRef.current.cliPath,
      model: lastConfigRef.current.model,
    });
  }, []);

  const send = useCallback(async (userMessage: string) => {
    const api = window.electronAPI;
    if (!api?.cliAgentStreamStart) {
      setError({
        message: "CLI agent IPC bridge unavailable",
        code: "IPC_MISSING",
      });
      return;
    }
    if (currentStreamIdRef.current) {
      setError({
        message: "A stream is already in progress",
        code: "STREAM_BUSY",
      });
      return;
    }

    // Push user message
    const userId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: "user",
        content: userMessage,
        isStreaming: false,
      },
    ]);

    // Reserve assistant slot
    const assistantId = crypto.randomUUID();
    currentAssistantIdRef.current = assistantId;
    accumulatedTextRef.current = "";
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      },
    ]);

    const streamId = crypto.randomUUID();
    currentStreamIdRef.current = streamId;
    setError(null);
    setAgentState("thinking");

    const cfg = lastConfigRef.current;
    try {
      const result = await api.cliAgentStreamStart({
        streamId,
        systemPrompt: cfg.systemPrompt,
        firstUserMessage: userMessage,
        config: {
          model: cfg.model,
          workspaceRoot: cfg.vaultPath || undefined,
          cliPath: cfg.cliPath,
          readOnly: cfg.readOnly,
          addDirs: cfg.addDirs,
        },
        sessionId: sessionIdRef.current || undefined,
      });
      if (!result.ok) {
        setError({
          message: result.error || "Failed to start CLI agent",
          code: "START_FAILED",
        });
        finalizeAssistant();
        setAgentState("idle");
        currentStreamIdRef.current = null;
      }
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : String(err),
        code: "START_FAILED",
      });
      finalizeAssistant();
      setAgentState("idle");
      currentStreamIdRef.current = null;
    }
  }, []);

  const cancel = useCallback(async () => {
    const api = window.electronAPI;
    const streamId = currentStreamIdRef.current;
    if (!streamId || !api?.cliAgentStreamCancel) return;
    await api.cliAgentStreamCancel(streamId);
    finalizeAssistant();
    setAgentState("idle");
    currentStreamIdRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    updateSessionId(null);
    currentAssistantIdRef.current = null;
    accumulatedTextRef.current = "";
    setAgentState("idle");
  }, []);

  return {
    messages,
    agentState,
    error,
    hasSession: messages.length > 0,
    sessionId,
    send,
    cancel,
    preflight,
    reset,
  };
}
