/**
 * SkillPalette — `/`-triggered command palette for the main AI chat.
 *
 * Typing `/` at the start of a word opens a searchable popup of the user's
 * installed Claude Code skills and commands (from ~/.claude and the vault's
 * .claude). Picking one attaches it to the outgoing message as a removable
 * chip. Unlike the meeting chat, this chat has no CLI subprocess that can
 * expand `/skill-name`, so the caller inlines the skill's instructions into
 * the LLM-facing message via buildSkillPrompt() at send time.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileCode, Wand2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

export interface SkillEntry {
  name: string;
  source: "user" | "project";
  kind: "skill" | "command";
  description?: string;
}

// `/` opens the palette when it starts the last word of the input — index 0
// or right after whitespace, with nothing but the query typed after it. This
// leaves "and/or" and URLs alone.
function detectSlashTrigger(
  value: string
): { anchor: number; query: string } | null {
  const anchor = value.lastIndexOf("/");
  if (anchor === -1) return null;
  if (anchor !== 0) {
    const before = value[anchor - 1];
    if (before !== " " && before !== "\n") return null;
  }
  const query = value.slice(anchor + 1);
  if (/\s/.test(query)) return null;
  return { anchor, query };
}

/** Build the LLM-facing message for a picked skill. */
export function buildSkillPrompt(
  name: string,
  content: string,
  userText: string
): string {
  // Claude Code command files reference their arguments as $ARGUMENTS; when
  // the template does, substituting is all the framing it needs.
  if (content.includes("$ARGUMENTS")) {
    return content.split("$ARGUMENTS").join(userText);
  }
  const request = userText
    ? `User request: ${userText}`
    : "The user provided no additional input — carry out the skill instructions directly.";
  return [
    `The user invoked your "/${name}" skill. Follow these skill instructions for this request:`,
    `<skill name="${name}">\n${content}\n</skill>`,
    request,
  ].join("\n\n");
}

interface UseSkillPaletteArgs {
  inputValue: string;
  setInputValue: (next: string) => void;
  /** Vault root; project-local .claude skills are scanned from here. */
  vaultPath?: string;
}

export interface SkillPaletteApi {
  /** Popup node — render inside a `relative` wrapper around the input. */
  palette: ReactNode;
  /** Attached-skill chip strip — render above the input. */
  chip: ReactNode;
  onKeyDownIntercept: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  activeSkill: SkillEntry | null;
  /** Detach the chip and resolve its instructions (content null if unreadable). */
  consumeActiveSkill: () => Promise<{
    skill: SkillEntry;
    content: string | null;
  } | null>;
}

const MAX_VISIBLE_MATCHES = 12;

export function useSkillPalette({
  inputValue,
  setInputValue,
  vaultPath,
}: UseSkillPaletteArgs): SkillPaletteApi {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<SkillEntry[]>([]);
  const [cursorRaw, setCursorRaw] = useState(0);
  const [dismissedAnchor, setDismissedAnchor] = useState<number | null>(null);
  const [activeSkill, setActiveSkill] = useState<SkillEntry | null>(null);
  const contentPromiseRef = useRef<Promise<string | null> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const trigger = useMemo(() => detectSlashTrigger(inputValue), [inputValue]);

  // An Esc-dismissal holds until that trigger is deleted or retyped.
  useEffect(() => {
    if (!trigger) setDismissedAnchor(null);
  }, [trigger]);

  useEffect(() => {
    setCursorRaw(0);
  }, [trigger?.query]);

  const refreshCatalog = useCallback(() => {
    if (!window.electronAPI?.cliAgentListSkills) return;
    window.electronAPI
      .cliAgentListSkills({ cwd: vaultPath || undefined })
      .then((entries) => {
        if (mountedRef.current) setCatalog(entries || []);
      })
      .catch(() => {
        // keep whatever catalog we had
      });
  }, [vaultPath]);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const matches = useMemo<SkillEntry[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const filtered = q
      ? catalog.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            (e.description ?? "").toLowerCase().includes(q)
        )
      : catalog;
    // Skills before commands, matching the sectioned rendering below.
    return [
      ...filtered.filter((e) => e.kind === "skill"),
      ...filtered.filter((e) => e.kind === "command"),
    ].slice(0, MAX_VISIBLE_MATCHES);
  }, [catalog, trigger]);

  const open =
    trigger !== null &&
    catalog.length > 0 &&
    trigger.anchor !== dismissedAnchor;
  const cursor = matches.length === 0 ? 0 : cursorRaw % matches.length;

  // Re-scan when the palette opens so freshly installed skills show up.
  useEffect(() => {
    if (open) refreshCatalog();
  }, [open, refreshCatalog]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const pick = useCallback(
    (entry: SkillEntry) => {
      if (trigger) setInputValue(inputValue.slice(0, trigger.anchor));
      setActiveSkill(entry);
      contentPromiseRef.current = window.electronAPI?.cliAgentReadSkill
        ? window.electronAPI
            .cliAgentReadSkill({
              name: entry.name,
              kind: entry.kind,
              source: entry.source,
              cwd: vaultPath || undefined,
            })
            .then((res) => res?.content ?? null)
            .catch(() => null)
        : Promise.resolve(null);
    },
    [trigger, inputValue, setInputValue, vaultPath]
  );

  const clearActiveSkill = useCallback(() => {
    setActiveSkill(null);
    contentPromiseRef.current = null;
  }, []);

  const consumeActiveSkill = useCallback(async () => {
    if (!activeSkill) return null;
    const skill = activeSkill;
    const promise = contentPromiseRef.current;
    clearActiveSkill();
    const content = promise ? await promise : null;
    return { skill, content };
  }, [activeSkill, clearActiveSkill]);

  const onKeyDownIntercept = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        if (trigger) setDismissedAnchor(trigger.anchor);
        return true;
      }
      if (matches.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursorRaw((c) => (c + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursorRaw((c) => (c - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pick(matches[cursor]);
        return true;
      }
      return false;
    },
    [open, matches, cursor, pick, trigger]
  );

  const palette: ReactNode = open ? (
    <div
      className={cn(
        "absolute left-3 right-3 bottom-full mb-1 z-20 overflow-hidden",
        "rounded-lg border border-border bg-surface-1 dark:bg-surface-2 shadow-lg"
      )}
    >
      <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
        {matches.length === 0 ? (
          <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
            {t("chat.skills.noMatches")}
          </div>
        ) : (
          matches.map((entry, idx) => {
            const prev = matches[idx - 1];
            const showHeader = !prev || prev.kind !== entry.kind;
            const Icon = entry.kind === "skill" ? Wand2 : FileCode;
            const isActive = idx === cursor;
            return (
              <div key={`${entry.source}-${entry.kind}-${entry.name}`}>
                {showHeader && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50 select-none">
                    {entry.kind === "skill"
                      ? t("chat.skills.sectionSkills")
                      : t("chat.skills.sectionCommands")}
                  </div>
                )}
                <button
                  type="button"
                  data-idx={idx}
                  // onMouseDown + preventDefault keeps focus in the textarea.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(entry);
                  }}
                  onMouseEnter={() => setCursorRaw(idx)}
                  className={cn(
                    "w-full flex items-start gap-2 px-3 py-1.5 text-left transition-colors",
                    isActive
                      ? "bg-primary/8 dark:bg-primary/10"
                      : "hover:bg-foreground/4 dark:hover:bg-white/4"
                  )}
                >
                  <Icon
                    size={12}
                    className={cn(
                      "mt-0.5 shrink-0",
                      entry.kind === "skill" ? "text-accent" : "text-primary"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[12px] font-mono text-foreground truncate">
                        /{entry.name}
                      </span>
                      {entry.source === "project" && (
                        <span className="text-[9px] px-1 py-px rounded bg-foreground/5 text-muted-foreground shrink-0">
                          {t("chat.skills.sourceProject")}
                        </span>
                      )}
                    </span>
                    {entry.description && (
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {entry.description}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border/30 bg-surface-2/40 text-[10px] text-muted-foreground/70 select-none">
        <span>{t("chat.skills.hintNavigate")}</span>
        <span>{t("chat.skills.hintSelect")}</span>
        <span className="ml-auto">{t("chat.skills.hintDismiss")}</span>
      </div>
    </div>
  ) : null;

  const chip: ReactNode = activeSkill ? (
    <div className="px-3 pt-1 flex">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 max-w-full pl-2 pr-1 py-0.5 rounded-md",
          "bg-accent/10 border border-accent/20 text-accent text-[11px] font-mono"
        )}
      >
        <Wand2 size={10} className="shrink-0" />
        <span className="truncate">/{activeSkill.name}</span>
        <button
          type="button"
          onClick={clearActiveSkill}
          aria-label={t("chat.skills.removeSkill")}
          className="p-0.5 rounded hover:bg-accent/15 transition-colors"
        >
          <X size={10} />
        </button>
      </span>
    </div>
  ) : null;

  return {
    palette,
    chip,
    onKeyDownIntercept,
    activeSkill,
    consumeActiveSkill,
  };
}
