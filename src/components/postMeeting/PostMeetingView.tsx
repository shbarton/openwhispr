/**
 * PostMeetingView - Dedicated screen shown after a meeting recording finishes.
 *
 * Layout:
 *   ┌─ header (title, back-to-note) ──────────────────────────────┐
 *   │  Post Meeting · {title} · {date}                  [← back]  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  ┌──────────────────────┐  ┌────────────────────────────┐   │
 *   │  │ Transcript            │  │ AI Assistant (chat panel) │   │
 *   │  │ (scrollable preview)  │  │                            │   │
 *   │  │                       │  │                            │   │
 *   │  └──────────────────────┘  └────────────────────────────┘   │
 *   │  Speaker Selection (placeholder)                              │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Designed for V1: minimal, no auto-spawn, explicit user action to start agent.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Mic2 } from "lucide-react";
import type { NoteItem } from "../../types/electron";
import { useActiveNoteId, useNotes } from "../../stores/noteStore";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";
import AgentChatPanel from "./AgentChatPanel";
import SpeakerSelectionPlaceholder from "./SpeakerSelectionPlaceholder";

interface PostMeetingViewProps {
  /** Called when user clicks "Back to note" (or similar exit affordance). */
  onClose: () => void;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatTimestamp(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function speakerLabel(s: TranscriptSegment): string {
  if (s.speakerName) return s.speakerName;
  if (s.speaker) return s.speaker.replace(/_/g, " ");
  return s.source === "mic" ? "Me" : "Other";
}

function formatSegments(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const ts = formatTimestamp(s.timestamp);
      const who = speakerLabel(s);
      const tsPart = ts ? `[${ts}] ` : "";
      return `${tsPart}${who}: ${(s.text || "").trim()}`;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

interface ParsedTranscript {
  segments: TranscriptSegment[];
  /** Human-readable plain text, one line per segment. */
  text: string;
  /** Whether the source data was structured segments (vs. plain text fallback). */
  isStructured: boolean;
}

const TranscriptSegmentRow = memo(function TranscriptSegmentRow({
  segment,
}: {
  segment: TranscriptSegment;
}) {
  const ts = formatTimestamp(segment.timestamp);
  const who = speakerLabel(segment);
  const isMic = segment.source === "mic";
  return (
    <div className="flex flex-col gap-0.5 break-words">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-foreground-muted">
        <span
          className={
            isMic ? "text-primary font-medium" : "text-accent font-medium"
          }
        >
          {who}
        </span>
        {ts && <span>{ts}</span>}
      </div>
      <div className="text-foreground/90 whitespace-pre-wrap break-words">
        {segment.text}
      </div>
    </div>
  );
});

function transcriptForNote(note: NoteItem | null): ParsedTranscript {
  if (!note) return { segments: [], text: "", isStructured: false };

  // If the transcript field starts with "[", it's JSON segments — parse it.
  const raw = (note.transcript || "").trim();
  if (raw.startsWith("[")) {
    const segments = parseTranscriptSegments(raw);
    if (segments.length > 0) {
      return {
        segments,
        text: formatSegments(segments),
        isStructured: true,
      };
    }
  }

  // Fallback: enhanced_content → content → raw transcript string.
  const fallback =
    (note.enhanced_content || note.content || raw || "").trim();
  return { segments: [], text: fallback, isStructured: false };
}

export default function PostMeetingView({ onClose }: PostMeetingViewProps) {
  const activeNoteId = useActiveNoteId();
  const notes = useNotes();
  const [fallbackNote, setFallbackNote] = useState<NoteItem | null>(null);

  // Try the note store first; fall back to IPC fetch if not loaded
  const storedNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) || null,
    [notes, activeNoteId]
  );
  const note = storedNote || fallbackNote;

  useEffect(() => {
    let cancelled = false;
    if (!storedNote && activeNoteId != null && window.electronAPI?.getNote) {
      window.electronAPI.getNote(activeNoteId).then((n) => {
        if (!cancelled) setFallbackNote(n || null);
      });
    } else if (!activeNoteId) {
      setFallbackNote(null);
    }
    return () => {
      cancelled = true;
    };
  }, [activeNoteId, storedNote]);

  const parsedTranscript = useMemo(() => transcriptForNote(note), [note]);
  const transcript = parsedTranscript.text;

  // Empty state ─ no note selected (e.g. user clicked sidebar tab with nothing recent)
  if (!note) {
    return (
      <div className="flex flex-col h-full p-8 items-center justify-center text-center">
        <Mic2 size={32} className="text-foreground-muted mb-3" />
        <p className="text-sm text-foreground mb-1">No meeting selected</p>
        <p className="text-xs text-foreground-muted max-w-sm">
          Finish a meeting recording, or open a meeting note, to see post-meeting
          tools here.
        </p>
        <button
          onClick={onClose}
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <ArrowLeft size={12} />
          Back to notes
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors"
            title="Back to note"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </button>
          <span className="text-foreground-muted text-xs">·</span>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-foreground-muted">
              Post Meeting
            </span>
            <h2 className="text-sm font-semibold truncate">
              {note.title || "Untitled meeting"}
            </h2>
          </div>
          <span className="text-xs text-foreground-muted ml-2 whitespace-nowrap">
            {formatDate(note.created_at)}
          </span>
        </div>
      </div>

      {/* Body: split layout */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 p-4 overflow-hidden">
        {/* Left: transcript */}
        <div className="flex flex-col h-full min-h-0 border border-border rounded-lg bg-surface-1 dark:bg-surface-2 overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-surface-2/40 dark:bg-surface-3/30 flex items-center justify-between">
            <h3 className="text-sm font-medium">Transcript</h3>
            {parsedTranscript.isStructured && (
              <span className="text-[10px] text-foreground-muted">
                {parsedTranscript.segments.length} segments
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm leading-relaxed">
            {parsedTranscript.isStructured &&
            parsedTranscript.segments.length > 0 ? (
              <div className="flex flex-col gap-2">
                {parsedTranscript.segments.map((s, idx) => (
                  <TranscriptSegmentRow key={s.id || idx} segment={s} />
                ))}
              </div>
            ) : transcript ? (
              <div className="whitespace-pre-wrap break-words text-foreground/90 font-mono text-[13px]">
                {transcript}
              </div>
            ) : (
              <span className="text-foreground-muted italic">
                No transcript captured for this meeting.
              </span>
            )}
          </div>
        </div>

        {/* Right: AI chat */}
        <AgentChatPanel
          meetingTitle={note.title || "Untitled meeting"}
          meetingDate={note.created_at}
          transcript={transcript}
          meetingNoteSlug={note.client_note_id || `note-${note.id}`}
          noteId={note.id}
        />
      </div>

      {/* Footer: placeholder modules */}
      <div className="border-t border-border px-4 py-3">
        <SpeakerSelectionPlaceholder />
      </div>
    </div>
  );
}
