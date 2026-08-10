import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  Cloud,
  Sparkles,
  X,
  Mic,
  Copy,
  ChevronRight,
  Calendar,
  Folder,
  AudioLines,
} from "lucide-react";
import type {
  RecentMeetingItem,
  TranscriptionItem as TranscriptionItemType,
} from "../types/electron";
import type { CalendarAttendee } from "../types/calendar";
import type { ControlPanelView } from "./ControlPanelSidebar";
import { formatHotkeyLabel } from "../utils/hotkeys";
import { formatDateGroup, normalizeDbDate } from "../utils/dateFormatting";
import { formatNotePreview } from "../utils/notePreview";
import { getInitialColor, getInitials } from "../utils/avatarUtils";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import { useRecentMeetings } from "../hooks/useRecentMeetings";
import { useMeetingRecordingStore } from "../stores/meetingRecordingStore";
import { Tooltip } from "./ui/tooltip";
import { Skeleton } from "./ui/skeleton";
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
  onOpenNote: (note: { id: number; folder_id: number | null }) => void;
}

const RECENT_COUNT = 5;
/** A project filter turns the section into a browse list, so it shows more. */
const PROJECT_COUNT = 20;
const MAX_AVATARS = 3;

const parseParticipants = (participants: string | null): CalendarAttendee[] => {
  if (!participants) return [];
  try {
    const parsed = JSON.parse(participants);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const participantLabel = (participant: CalendarAttendee): string =>
  participant.displayName ? `${participant.displayName} · ${participant.email}` : participant.email;

const formatDuration = (seconds: number | null): string | null => {
  if (!seconds || seconds < 1) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
};

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
  onOpenNote,
}: DashboardViewProps) {
  const { t, i18n } = useTranslation();
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { meetings, isLoading: meetingsLoading } = useRecentMeetings(
    projectFilter ? PROJECT_COUNT : RECENT_COUNT,
    projectFilter
  );
  // A meeting already running would otherwise get a second note started under it.
  const isMeetingRecording = useMeetingRecordingStore((s) => s.isRecording);

  const hour = new Date().getHours();
  const period = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const greeting = userName
    ? t(`dashboard.greeting.${period}WithName`, { name: userName })
    : t(`dashboard.greeting.${period}`);

  const recent = history.slice(0, RECENT_COUNT);

  const rowLabel = (timestamp: string): string => {
    const date = normalizeDbDate(timestamp);
    const group = formatDateGroup(date, t);
    if (group === t("controlPanel.history.dateGroups.today")) {
      return date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    }
    return group;
  };

  const startMeeting = () => {
    window.electronAPI?.startManualMeeting?.();
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

        {/* Upcoming meetings. With no calendar connected this section can never
            fill, so it collapses to one line instead of a large empty card. */}
        {isConnected ? (
          <section className="mb-8">
            <SectionHeader
              title={t("dashboard.upcomingMeetings")}
              onViewAll={() => onViewChange("personal-notes")}
              viewAllLabel={t("dashboard.viewAll")}
            />
            <UpcomingMeetings
              events={events}
              isLoading={eventsLoading}
              className="w-full"
              showHeader={false}
            />
          </section>
        ) : (
          <button
            onClick={() => onViewChange("integrations")}
            className="group/cal mb-8 w-full flex items-center gap-2.5 py-2.5 px-3 rounded-lg text-left bg-surface-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_-1px_rgba(0,0,0,0.05)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)] hover:shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_4px_0_rgba(0,0,0,0.05)] dark:hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] transition-[box-shadow,background-color] duration-150"
          >
            <Calendar size={14} strokeWidth={1.5} className="shrink-0 text-foreground-tertiary" />
            <span className="flex-1 min-w-0 text-sm text-foreground-muted group-hover/cal:text-foreground transition-colors duration-150">
              {t("dashboard.connectCalendarPrompt")}
            </span>
            <ChevronRight
              size={14}
              strokeWidth={1.5}
              className="shrink-0 text-foreground-tertiary -translate-x-0.5 group-hover/cal:translate-x-0 transition-transform duration-150"
            />
          </button>
        )}

        {/* Recent meetings — meetings actually recorded, calendar or not */}
        <section className="mb-8">
          <SectionHeader
            title={projectFilter ?? t("dashboard.recentMeetings")}
            onClear={projectFilter ? () => setProjectFilter(null) : undefined}
            clearLabel={t("dashboard.clearProjectFilter")}
            action={
              !isMeetingRecording && (
                <button
                  onClick={startMeeting}
                  // pl < pr: optical balance for the leading icon
                  className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-md bg-foreground/[0.04] dark:bg-white/[0.06] text-xs text-foreground-muted hover:bg-foreground/[0.08] dark:hover:bg-white/[0.11] hover:text-foreground transition-colors duration-150"
                >
                  <Mic size={12} strokeWidth={1.5} className="shrink-0" />
                  <span>{t("dashboard.startMeeting")}</span>
                </button>
              )
            }
            onViewAll={
              meetings.length > 0 && !projectFilter
                ? () => onViewChange("personal-notes")
                : undefined
            }
            viewAllLabel={t("dashboard.viewAll")}
          />
          {meetingsLoading ? (
            <div className="divide-y divide-border-subtle">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="py-3 px-2 -mx-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="mt-2 h-3 w-4/5" />
                </div>
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <AudioLines
                size={32}
                strokeWidth={1}
                className="text-foreground-tertiary mb-4 opacity-40"
              />
              <p className="text-sm text-foreground-muted mb-2 text-balance text-center">
                {projectFilter
                  ? t("dashboard.noMeetingsInProject", { project: projectFilter })
                  : t("dashboard.noRecentMeetings")}
              </p>
              {!isMeetingRecording && !projectFilter && (
                <button onClick={startMeeting} className="text-xs text-primary hover:underline">
                  {t("dashboard.startMeeting")}
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {meetings.map((meeting) => (
                <MeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  timeLabel={rowLabel(meeting.created_at)}
                  showProject={!projectFilter}
                  onOpen={() => onOpenNote(meeting)}
                  onSelectProject={setProjectFilter}
                  untitledLabel={t("dashboard.untitledMeeting")}
                  projectFilterLabel={t("dashboard.filterByProject")}
                />
              ))}
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
                      {rowLabel(item.timestamp)}
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
  onClear,
  clearLabel,
  action,
}: {
  title: string;
  onViewAll?: () => void;
  viewAllLabel: string;
  /** Renders an ✕ beside the title — used to drop the project filter. */
  onClear?: () => void;
  clearLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pb-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="text-base text-foreground-tertiary truncate"
          style={{ fontFamily: "var(--font-family-display)" }}
        >
          {title}
        </span>
        {onClear && (
          <button
            onClick={onClear}
            aria-label={clearLabel}
            title={clearLabel}
            className="shrink-0 p-0.5 rounded text-foreground-tertiary hover:text-foreground hover:bg-surface-hover transition-colors duration-150"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {action}
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
    </div>
  );
}

function MeetingRow({
  meeting,
  timeLabel,
  showProject,
  onOpen,
  onSelectProject,
  untitledLabel,
  projectFilterLabel,
}: {
  meeting: RecentMeetingItem;
  timeLabel: string;
  showProject: boolean;
  onOpen: () => void;
  onSelectProject: (project: string) => void;
  untitledLabel: string;
  projectFilterLabel: string;
}) {
  const participants = parseParticipants(meeting.participants);
  const preview = formatNotePreview(meeting.preview);
  const duration = formatDuration(meeting.audio_duration_seconds);
  const project = showProject ? meeting.project : null;
  const hasMeta = Boolean(project) || participants.length > 0 || Boolean(duration);
  const overflow = participants.slice(MAX_AVATARS);

  // A div, not a button: the project chip nested inside is itself a button.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group/row flex items-start gap-3 py-3 px-2 -mx-2 rounded-md cursor-pointer hover:bg-surface-hover transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground line-clamp-1 leading-relaxed">
          {meeting.title.trim() || untitledLabel}
        </p>
        {preview && <p className="mt-0.5 text-xs text-foreground-muted line-clamp-1">{preview}</p>}
        {hasMeta && (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-foreground-tertiary">
            {project && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectProject(project);
                }}
                title={projectFilterLabel}
                className="inline-flex items-center gap-1 min-w-0 max-w-48 px-1.5 py-0.5 rounded bg-foreground/[0.04] dark:bg-white/[0.06] text-[11px] text-foreground-muted hover:bg-foreground/[0.09] dark:hover:bg-white/[0.11] transition-colors duration-150"
              >
                <Folder size={10} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{project}</span>
              </button>
            )}
            {participants.length > 0 && (
              <div className="flex items-center -space-x-1.5">
                {participants.slice(0, MAX_AVATARS).map((participant) => (
                  <Tooltip key={participant.email} content={participantLabel(participant)}>
                    <span
                      className="w-5 h-5 rounded-full ring-2 ring-background flex items-center justify-center text-[9px] font-medium text-white"
                      style={{ backgroundColor: getInitialColor(participant.email) }}
                    >
                      {getInitials(participant.displayName, participant.email)}
                    </span>
                  </Tooltip>
                ))}
                {overflow.length > 0 && (
                  <Tooltip content={overflow.map(participantLabel).join(", ")}>
                    <span className="w-5 h-5 rounded-full ring-2 ring-background bg-surface-hover flex items-center justify-center text-[9px] font-medium text-foreground-muted tabular-nums">
                      +{overflow.length}
                    </span>
                  </Tooltip>
                )}
              </div>
            )}
            {duration && <span className="tabular-nums">{duration}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 pt-0.5">
        <span className="text-xs text-foreground-tertiary tabular-nums">{timeLabel}</span>
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          className="text-foreground-tertiary opacity-0 -translate-x-1 group-hover/row:opacity-100 group-hover/row:translate-x-0 transition-all duration-150"
        />
      </div>
    </div>
  );
}
