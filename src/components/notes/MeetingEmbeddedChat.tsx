/**
 * MeetingEmbeddedChat — wrapper that drives EmbeddedChat with the
 * Claude Code CLI backend (for meeting notes). Computes the readable
 * transcript text from the note, wires up the CLI hook + extras, and
 * passes EmbeddedChat the same prop shape it gets from the regular flow.
 */

import { useMemo } from "react";
import type { NoteItem } from "../../types/electron";
import { useEmbeddedChatCli } from "../../hooks/useEmbeddedChatCli";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import EmbeddedChat, { type EmbeddedChatMode } from "./EmbeddedChat";
import { useCliExtras } from "./EmbeddedChatCliExtras";

interface MeetingEmbeddedChatProps {
  note: NoteItem;
  mode: EmbeddedChatMode;
  onModeChange: (mode: EmbeddedChatMode) => void;
}

function formatSegmentLine(s: TranscriptSegment): string {
  const who =
    s.speakerName ||
    (s.speaker ? s.speaker.replace(/_/g, " ") : s.source === "mic" ? "Me" : "Other");
  let ts = "";
  if (s.timestamp && Number.isFinite(s.timestamp)) {
    try {
      ts = new Date(s.timestamp).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      // ignore
    }
  }
  return `${ts ? `[${ts}] ` : ""}${who}: ${(s.text || "").trim()}`;
}

function transcriptPlainText(note: NoteItem): string {
  const raw = (note.transcript || "").trim();
  if (raw.startsWith("[")) {
    const segments = parseTranscriptSegments(raw);
    if (segments.length > 0) {
      return segments
        .map(formatSegmentLine)
        .filter((l) => l.trim().length > 0)
        .join("\n");
    }
  }
  return (note.enhanced_content || note.content || raw || "").trim();
}

export default function MeetingEmbeddedChat({
  note,
  mode,
  onModeChange,
}: MeetingEmbeddedChatProps) {
  const vaultPath = useSettingsStore((s) => s.vaultPath);

  // Depend only on the fields the parser actually reads — otherwise any
  // unrelated note-field update (e.g. updated_at after autosave) would
  // re-parse the entire transcript JSON.
  const transcript = useMemo(
    () => transcriptPlainText(note),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, note.transcript, note.enhanced_content, note.content]
  );

  // Meeting notes only support sidebar ↔ hidden. The PanelRight button in
  // EmbeddedChat's header tries to flip into floating; coerce that to
  // sidebar (no-op if already there) so the chat never overlays the note.
  const handleModeChange = (next: EmbeddedChatMode) => {
    onModeChange(next === "floating" ? "sidebar" : next);
  };

  const chat = useEmbeddedChatCli({
    noteId: note.id,
    noteTitle: note.title || "Untitled meeting",
    noteCreatedAt: note.created_at,
    transcript,
    noteSlug: note.client_note_id || `note-${note.id}`,
  });

  const extras = useCliExtras({
    vaultPath,
    agentState: chat.agentState,
    cli: chat.cli,
    hasMessages: chat.messages.length > 0,
    sendMessage: chat.sendMessage,
  });

  return (
    <EmbeddedChat
      mode={mode}
      onModeChange={handleModeChange}
      messages={chat.messages}
      agentState={chat.agentState}
      onTextSubmit={chat.sendMessage}
      onCancel={chat.cancelStream}
      onNewChat={chat.startNewChat}
      headerExtras={extras.headerExtras}
      aboveInput={extras.aboveInput}
      emptyStateOverride={extras.emptyState}
      inputValue={chat.cli.inputValue}
      onInputValueChange={chat.cli.setInputValue}
      onInputKeyDownIntercept={extras.onInputKeyDownIntercept}
    />
  );
}
