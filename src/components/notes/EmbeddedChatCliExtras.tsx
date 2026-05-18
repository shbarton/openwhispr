/**
 * EmbeddedChatCliExtras — the CLI-only bits that plug into EmbeddedChat's
 * slot props (headerExtras / aboveInput / emptyStateOverride) when the
 * chat is backed by the Claude Code CLI. Stays out of the regular API
 * path entirely.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  Eye,
  FileCode,
  FileEdit,
  Wand2,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { useSettingsStore } from "../../stores/settingsStore";

const MODEL_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "sonnet", label: "Sonnet", hint: "Balanced — recommended" },
  { value: "opus", label: "Opus", hint: "Most capable, slower" },
  { value: "haiku", label: "Haiku", hint: "Fastest, lighter" },
];

function modelLabelFor(value: string): string {
  const match = MODEL_OPTIONS.find((m) => m.value === value);
  if (match) return match.label;
  // Custom model string — show the last segment or truncate
  const tail = value.split("-").slice(-2).join("-");
  return tail.length > 14 ? value.slice(0, 12) + "…" : value;
}

interface SlashEntry {
  name: string;
  source: "user" | "project";
  kind: "skill" | "command";
}

// Shape is owned by useEmbeddedChatCli; reuse the exported type so the two
// files can't drift.
import type { CliSideChannel } from "../../hooks/useEmbeddedChatCli";
type CliExtrasState = CliSideChannel;

interface UseCliExtrasArgs {
  vaultPath: string;
  agentState: string;
  cli: CliExtrasState;
  hasMessages: boolean;
  sendMessage: (text: string) => void;
  /** Suggestion-chip prompts shown when the chat is empty. */
  suggestions?: Array<{ label: string; prompt: string }>;
}

const DEFAULT_SUGGESTIONS = [
  { label: "Summarise", prompt: "Give me a concise summary of this meeting." },
  {
    label: "Action items",
    prompt:
      "Extract 3-5 action items as bullets. Include who's responsible if it's clear from the transcript.",
  },
  {
    label: "Follow-ups",
    prompt:
      "What follow-up conversations or questions should I chase up after this meeting?",
  },
];

/**
 * Hook that produces the three slot renderables for EmbeddedChat.
 * Returns null in places where the CLI flow has nothing to add (e.g. no
 * autocomplete dropdown when not slash-typing).
 */
export function useCliExtras(args: UseCliExtrasArgs): {
  headerExtras: ReactNode;
  aboveInput: ReactNode;
  emptyState: ReactNode;
  onInputKeyDownIntercept: (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => boolean;
} {
  const { vaultPath, agentState, cli, hasMessages, sendMessage } = args;
  const suggestions = args.suggestions ?? DEFAULT_SUGGESTIONS;

  // Slash-command catalog
  const [slashCatalog, setSlashCatalog] = useState<SlashEntry[]>([]);
  const [cursorRaw, setSlashCursor] = useState(0);
  const slashListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!window.electronAPI?.cliAgentListSkills) return;
    window.electronAPI
      .cliAgentListSkills({ cwd: vaultPath || undefined })
      .then((entries) => {
        if (!cancelled) setSlashCatalog(entries || []);
      })
      .catch(() => {
        if (!cancelled) setSlashCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  const slashQuery = useMemo<string | null>(() => {
    if (!cli.inputValue.startsWith("/")) return null;
    const firstSpace = cli.inputValue.indexOf(" ");
    return firstSpace === -1 ? cli.inputValue.slice(1) : null;
  }, [cli.inputValue]);

  const slashMatches = useMemo<SlashEntry[]>(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return slashCatalog
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [slashCatalog, slashQuery]);

  const slashOpen = slashQuery !== null && slashMatches.length > 0;
  const activeCursor =
    slashMatches.length === 0 ? 0 : cursorRaw % slashMatches.length;

  const acceptSlash = useCallback(
    (entry: SlashEntry) => {
      const rest = cli.inputValue.includes(" ")
        ? cli.inputValue.slice(cli.inputValue.indexOf(" "))
        : "";
      cli.setInputValue(`/${entry.name}${rest || " "}`);
    },
    [cli]
  );

  const onInputKeyDownIntercept = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!slashOpen) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashCursor((c) => (c + 1) % slashMatches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashCursor(
          (c) => (c - 1 + slashMatches.length) % slashMatches.length
        );
        return true;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const pick = slashMatches[activeCursor];
        if (pick) acceptSlash(pick);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cli.setInputValue("");
        return true;
      }
      return false;
    },
    [slashOpen, slashMatches, activeCursor, acceptSlash, cli]
  );

  // ── Header extras: vault badge only ──────────────────────────────────
  // Access toggle + model picker live in the input controls strip below.
  const headerExtras: ReactNode = vaultPath ? (
    <span
      className="text-[10px] text-foreground-muted truncate max-w-32"
      title={`Working in vault: ${vaultPath}`}
    >
      {vaultPath.split("/").pop() || vaultPath}
    </span>
  ) : null;

  // ── Controls strip: model picker + access toggle (above input row) ───
  const agentModel = useSettingsStore((s) => s.agentModel);
  const setAgentModel = useSettingsStore((s) => s.setAgentModel);
  const controlsStrip: ReactNode = (
    <div className="flex items-center gap-1 px-3 pb-1 pt-1.5 select-none">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1 text-[10px] px-1.5 h-5 rounded-md",
              "text-foreground-muted hover:text-foreground hover:bg-foreground/5",
              "transition-colors outline-none disabled:opacity-50"
            )}
            disabled={agentState !== "idle"}
            title="Pick the Claude model the agent uses"
          >
            <span>{modelLabelFor(agentModel)}</span>
            <ChevronDown size={9} className="text-foreground-muted/60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="min-w-44 p-1">
          {MODEL_OPTIONS.map((m) => (
            <DropdownMenuItem
              key={m.value}
              onClick={() => setAgentModel(m.value)}
              className={cn(
                "flex flex-col items-start gap-0 text-xs rounded-md px-2 py-1.5",
                agentModel === m.value && "bg-foreground/4"
              )}
            >
              <span className="text-foreground font-medium">{m.label}</span>
              <span className="text-[10px] text-foreground-muted">{m.hint}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="px-2 py-1 text-[10px] text-foreground-muted/70">
            Saved to settings; applies to all meetings.
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-foreground-muted/30 text-[9px]">·</span>

      <button
        onClick={() => cli.setReadOnly(!cli.readOnly)}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] px-1.5 h-5 rounded-md transition-colors disabled:opacity-50",
          cli.readOnly
            ? "text-foreground-muted hover:text-foreground hover:bg-foreground/5"
            : "text-accent hover:bg-accent/10"
        )}
        title={
          cli.readOnly
            ? "Read-only: agent can only read vault files. Click to give it write access."
            : "Full access: agent can read, write, and edit. Click to switch to read-only."
        }
        disabled={agentState !== "idle"}
      >
        {cli.readOnly ? <Eye size={10} /> : <FileEdit size={10} />}
        <span>{cli.readOnly ? "Read-only" : "Full access"}</span>
      </button>
    </div>
  );

  // ── Above-input: autocomplete dropdown + controls strip + tip + preflight banner
  const aboveInput: ReactNode = (
    <>
      {controlsStrip}
      {slashOpen && (
        <div
          ref={slashListRef}
          className="absolute left-3 right-3 bottom-full mb-1 z-20 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface-1 dark:bg-surface-2 shadow-lg"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-foreground-muted border-b border-border bg-surface-2/40">
            Slash commands · {slashMatches.length} match
            {slashMatches.length === 1 ? "" : "es"}
          </div>
          {slashMatches.map((entry, idx) => {
            const Icon = entry.kind === "skill" ? Wand2 : FileCode;
            const isActive = idx === activeCursor;
            return (
              <button
                key={entry.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptSlash(entry);
                }}
                onMouseEnter={() => setSlashCursor(idx)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-accent/10 text-foreground"
                    : "text-foreground/80 hover:bg-foreground/5"
                )}
              >
                <Icon
                  size={11}
                  className={cn(
                    "shrink-0",
                    entry.kind === "skill" ? "text-accent" : "text-primary"
                  )}
                />
                <span className="font-mono">/{entry.name}</span>
                <span className="ml-auto text-[10px] text-foreground-muted shrink-0">
                  {entry.kind}
                  {entry.source === "project" ? " · project" : ""}
                </span>
              </button>
            );
          })}
          <div className="px-3 py-1 text-[10px] text-foreground-muted border-t border-border bg-surface-2/30">
            ↑↓ navigate · Tab/Enter to insert · Esc to clear
          </div>
        </div>
      )}
      {cli.preflight.status === "blocked" && cli.preflight.errors.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-amber-50 dark:bg-amber-950/30 text-[11px] flex flex-col gap-1">
          {cli.preflight.errors.map((err) => (
            <div
              key={err.code}
              className="flex items-start gap-1.5 text-amber-900 dark:text-amber-200"
            >
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span>{err.message}</span>
            </div>
          ))}
          <button
            onClick={cli.rerunPreflight}
            className="self-start mt-1 text-[10px] text-accent hover:underline"
          >
            Re-check
          </button>
        </div>
      )}
    </>
  );

  // ── Empty state: suggestion chips ────────────────────────────────────
  const canStart =
    cli.preflight.status === "ok" || cli.preflight.status === "unknown";
  const emptyState: ReactNode = (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <p className="text-xs text-foreground/70 mb-3">
        Ready to dig into this meeting
      </p>
      {canStart ? (
        <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => sendMessage(s.prompt)}
              className={cn(
                "px-3 py-1 rounded-full border text-[11px] transition-colors",
                "border-border text-foreground/80",
                "hover:border-accent/40 hover:text-accent hover:bg-accent/5"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-foreground-muted max-w-xs">
          Resolve the issue above to start the agent, or type your own
          message below.
        </p>
      )}
      <p className="text-[10px] text-foreground-muted/60 mt-4 max-w-xs">
        Or type{" "}
        <code className="px-1 py-0.5 rounded bg-foreground/5">/</code> to run
        any of your installed Claude Code skills.
      </p>
    </div>
  );

  return {
    headerExtras,
    aboveInput,
    emptyState,
    onInputKeyDownIntercept,
  };
}
