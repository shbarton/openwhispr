import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Mic, Search, Trash2, X } from "lucide-react";
import TranscriptionItem from "./ui/TranscriptionItem";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { useSettingsStore } from "../stores/settingsStore";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number) => Promise<void>;
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onShowAudioInFolder,
  onRetryTranscription,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const [searchQuery, setSearchQuery] = useState("");
  const trimmedQuery = searchQuery.trim();

  const filteredHistory = useMemo(() => {
    const query = trimmedQuery.toLowerCase();
    if (!query) return history;
    return history.filter((item) => {
      if (item.text?.toLowerCase().includes(query)) return true;
      if (item.raw_text?.toLowerCase().includes(query)) return true;
      return false;
    });
  }, [history, trimmedQuery]);

  const groupedHistory = useMemo(() => {
    if (filteredHistory.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of filteredHistory) {
      const label = formatDateGroup(item.timestamp, t);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [filteredHistory, t]);

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mx-auto max-w-3xl">
        {!dataRetentionEnabled && (
          <div className="mb-4 rounded-lg bg-warning/8 dark:bg-warning/12 px-4 py-3 flex items-center gap-3">
            <span className="text-warning shrink-0 text-sm">⊘</span>
            <p className="text-xs text-foreground-muted leading-relaxed">
              {t("controlPanel.history.dataRetentionDisabled")}
            </p>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-sm text-foreground-muted">{t("controlPanel.loading")}</span>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 px-4">
            <Mic size={48} strokeWidth={1} className="text-foreground-tertiary mb-6 opacity-40" />
            <h3
              className="text-xl text-foreground mb-2"
              style={{ fontFamily: "var(--font-family-display)" }}
            >
              {t("controlPanel.history.empty")}
            </h3>
            <div className="flex items-center gap-2 text-sm text-foreground-tertiary">
              <span>{t("controlPanel.history.press")}</span>
              <kbd className="inline-flex items-center h-6 px-2 rounded bg-surface-hover text-sm font-mono text-foreground-muted">
                {formatHotkeyLabel(hotkey)}
              </kbd>
              <span>{t("controlPanel.history.toStart")}</span>
            </div>
          </div>
        ) : (
          <div className="group">
            <div className="relative mb-3">
              <Search
                size={14}
                strokeWidth={1.5}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-tertiary pointer-events-none"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("controlPanel.history.searchPlaceholder")}
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-surface-hover/50 border border-border-subtle text-sm text-foreground placeholder:text-foreground-tertiary focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={t("controlPanel.history.clearSearch")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-foreground-tertiary hover:text-foreground hover:bg-surface-hover transition"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>
            {groupedHistory.length === 0 ? (
              <div className="py-12 text-center text-sm text-foreground-tertiary">
                {t("controlPanel.history.noMatches", { query: trimmedQuery })}
              </div>
            ) : (
              groupedHistory.map((group, index) => (
              <div key={group.label} className={index > 0 ? "mt-8" : ""}>
                <div className="sticky -top-1 z-10 -mx-4 px-5 pt-3 pb-3 bg-background flex items-center justify-between">
                  <span
                    className="text-base text-foreground-tertiary"
                    style={{ fontFamily: "var(--font-family-display)" }}
                  >
                    {group.label}
                  </span>
                  {index === 0 && (
                    <button
                      onClick={clearAllTranscriptions}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-foreground-tertiary opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/8 dark:hover:bg-destructive/10 active:scale-[0.98] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-all duration-150"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                      <span>{t("controlPanel.history.clearAll")}</span>
                    </button>
                  )}
                </div>
                <div className="divide-y divide-border-subtle">
                  {group.items.map((item) => (
                    <TranscriptionItem
                      key={item.id}
                      item={item}
                      onCopy={copyToClipboard}
                      onDelete={deleteTranscription}
                      onShowAudioInFolder={onShowAudioInFolder}
                      onRetryTranscription={onRetryTranscription}
                      onOpenSettings={() => onOpenSettings("transcription")}
                    />
                  ))}
                </div>
              </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
