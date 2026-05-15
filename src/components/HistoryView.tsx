import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Loader2, Sparkles, Cloud, X, Mic, Trash2 } from "lucide-react";
import TranscriptionItem from "./ui/TranscriptionItem";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { cn } from "./lib/utils";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";
import { useSettingsStore } from "../stores/settingsStore";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
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
  showCloudMigrationBanner,
  setShowCloudMigrationBanner,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onShowAudioInFolder,
  onRetryTranscription,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const dataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t]);

  return (
    <div className="px-4 pt-4 pb-6">
      <div className={cn("mx-auto", isConnected ? "max-w-5xl" : "max-w-3xl")}>
        {showCloudMigrationBanner && (
          <div className="mb-4 relative rounded-lg bg-accent-light p-4">
            <button
              onClick={() => {
                setShowCloudMigrationBanner(false);
                localStorage.setItem("cloudMigrationShown", "true");
              }}
              aria-label={t("common.close")}
              className="absolute top-3 right-3 p-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors duration-150"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <Cloud size={18} strokeWidth={1.5} className="shrink-0 text-accent mt-0.5" />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm text-foreground mb-1"
                  style={{ fontFamily: "var(--font-family-display)" }}
                >
                  {t("controlPanel.cloudMigration.title")}
                </p>
                <p className="text-xs text-foreground-muted mb-3">
                  {t("controlPanel.cloudMigration.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    setShowCloudMigrationBanner(false);
                    localStorage.setItem("cloudMigrationShown", "true");
                    onOpenSettings("transcription");
                  }}
                >
                  {t("controlPanel.cloudMigration.viewSettings")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!useCleanupModel && !aiCTADismissed && (
          <div className="mb-4 relative rounded-lg bg-accent-light p-4">
            <button
              onClick={() => {
                localStorage.setItem("aiCTADismissed", "true");
                setAiCTADismissed(true);
              }}
              aria-label={t("common.close")}
              className="absolute top-3 right-3 p-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors duration-150"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <Sparkles size={18} strokeWidth={1.5} className="shrink-0 text-accent mt-0.5" />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm text-foreground mb-1"
                  style={{ fontFamily: "var(--font-family-display)" }}
                >
                  {t("controlPanel.aiCta.title")}
                </p>
                <p className="text-xs text-foreground-muted mb-3">
                  {t("controlPanel.aiCta.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => onOpenSettings("intelligence")}
                >
                  {t("controlPanel.aiCta.enable")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className={cn(isConnected ? "flex gap-6" : "")}>
          <div className={cn("min-w-0", isConnected ? "flex-1" : "w-full")}>
            {isConnected && (
              <div className="flex items-center gap-2 pb-3 mb-2">
                <Mic size={14} strokeWidth={1.5} className="text-foreground-tertiary" />
                <span
                  className="text-base text-foreground-tertiary"
                  style={{ fontFamily: "var(--font-family-display)" }}
                >
                  {t("upcoming.transcriptions")}
                </span>
              </div>
            )}
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
                {groupedHistory.map((group, index) => (
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
                ))}
              </div>
            )}
          </div>

          {isConnected && (
            <div className="w-64 shrink-0 hidden sm:block">
              <div className="sticky top-4">
                <UpcomingMeetings events={events} isLoading={eventsLoading} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
