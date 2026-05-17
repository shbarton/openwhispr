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

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Mic2 } from "lucide-react";
import type { NoteItem } from "../../types/electron";
import { useActiveNoteId, useNotes } from "../../stores/noteStore";
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

function transcriptPlainText(note: NoteItem | null): string {
  if (!note) return "";
  // Prefer the dedicated transcript field; fall back to content.
  return (note.transcript || note.content || "").trim();
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

  const transcript = useMemo(() => transcriptPlainText(note), [note]);

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
          <div className="px-4 py-2 border-b border-border bg-surface-2/40 dark:bg-surface-3/30">
            <h3 className="text-sm font-medium">Transcript</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
            {transcript || (
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
        />
      </div>

      {/* Footer: placeholder modules */}
      <div className="border-t border-border px-4 py-3">
        <SpeakerSelectionPlaceholder />
      </div>
    </div>
  );
}
