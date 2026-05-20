import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Cloud, Sparkles, X, Mic, Copy, ChevronRight, Calendar } from "lucide-react";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import type { ControlPanelView } from "./ControlPanelSidebar";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { formatDateGroup, normalizeDbDate } from "../utils/dateFormatting";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";

interface DashboardViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  userName?: string | null;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: (section?: string) => void;
}

const RECENT_COUNT = 5;

export default function DashboardView({
  history,
  isLoading,
  hotkey,
  userName,
  showCloudMigrationBanner,
  setShowCloudMigrationBanner,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  onViewChange,
  onOpenSettings,
}: DashboardViewProps) {
  const { t, i18n } = useTranslation();
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();

  const hour = new Date().getHours();
  const period = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const greeting = userName
    ? t(`dashboard.greeting.${period}WithName`, { name: userName })
    : t(`dashboard.greeting.${period}`);

  const recent = history.slice(0, RECENT_COUNT);

  const rowLabel = (item: TranscriptionItemType): string => {
    const date = normalizeDbDate(item.timestamp);
    const group = formatDateGroup(date, t);
    if (group === t("controlPanel.history.dateGroups.today")) {
      return date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    }
    return group;
  };

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mx-auto max-w-3xl">
        {/* Hero greeting */}
        <header className="mb-8">
          <h1
            className="text-2xl text-foreground"
            style={{ fontFamily: "var(--font-family-display)" }}
          >
            {greeting}
          </h1>
        </header>

        {/* Cloud migration banner */}
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

        {/* AI cleanup CTA banner */}
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

        {/* Upcoming meetings card — always shown; renders a null state when there's nothing */}
        <section className="mb-8">
          <SectionHeader
            title={t("dashboard.upcomingMeetings")}
            onViewAll={() => onViewChange("personal-notes")}
            viewAllLabel={t("dashboard.viewAll")}
          />
          {isConnected ? (
            <UpcomingMeetings
              events={events}
              isLoading={eventsLoading}
              className="w-full"
              showHeader={false}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-10 px-4 rounded-lg border border-dashed border-border-subtle">
              <Calendar
                size={28}
                strokeWidth={1.25}
                className="text-foreground-tertiary mb-3 opacity-50"
              />
              <p className="text-sm text-foreground-muted mb-1">
                {t("dashboard.noUpcomingMeetings")}
              </p>
              <button
                onClick={() => onViewChange("integrations")}
                className="text-xs text-primary hover:underline"
              >
                {t("dashboard.connectCalendar")}
              </button>
            </div>
          )}
        </section>

        {/* Recent transcriptions card */}
        <section>
          <SectionHeader
            title={t("dashboard.recentTranscripts")}
            onViewAll={recent.length > 0 ? () => onViewChange("dictation") : undefined}
            viewAllLabel={t("dashboard.viewAll")}
          />
          {isLoading ? (
            <div className="py-8 flex justify-center">
              <span className="text-sm text-foreground-muted">{t("controlPanel.loading")}</span>
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <Mic size={32} strokeWidth={1} className="text-foreground-tertiary mb-4 opacity-40" />
              <p className="text-sm text-foreground-muted mb-2">{t("dashboard.noTranscripts")}</p>
              <div className="flex items-center gap-2 text-xs text-foreground-tertiary">
                <span>{t("controlPanel.history.press")}</span>
                <kbd className="inline-flex items-center h-6 px-2 rounded bg-surface-hover text-xs font-mono text-foreground-muted">
                  {formatHotkeyLabel(hotkey)}
                </kbd>
                <span>{t("controlPanel.history.toStart")}</span>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {recent.map((item) => (
                <div
                  key={item.id}
                  className="group/row flex items-start gap-3 py-3 px-2 -mx-2 rounded-md hover:bg-surface-hover transition-colors duration-150"
                >
                  <button
                    onClick={() => onViewChange("dictation")}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                      {item.text}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    <button
                      onClick={() => copyToClipboard(item.text)}
                      aria-label={t("controlPanel.history.copyText")}
                      className="opacity-0 group-hover/row:opacity-100 p-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-foreground/10 transition-all duration-150"
                    >
                      <Copy size={13} strokeWidth={1.5} />
                    </button>
                    <span className="text-xs text-foreground-tertiary tabular-nums">
                      {rowLabel(item)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  onViewAll,
  viewAllLabel,
}: {
  title: string;
  onViewAll?: () => void;
  viewAllLabel: string;
}) {
  return (
    <div className="flex items-center justify-between pb-3">
      <span
        className="text-base text-foreground-tertiary"
        style={{ fontFamily: "var(--font-family-display)" }}
      >
        {title}
      </span>
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="flex items-center gap-0.5 text-xs text-foreground-muted hover:text-foreground transition-colors duration-150"
        >
          <span>{viewAllLabel}</span>
          <ChevronRight size={13} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
