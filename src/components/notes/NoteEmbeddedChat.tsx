/**
 * NoteEmbeddedChat — wrapper that drives EmbeddedChat with the Claude Code
 * CLI backend for EVERY note type (formerly MeetingEmbeddedChat, meetings
 * only — unified 2026-08-10: one agent chat everywhere; note type only tunes
 * the suggestion chips and prompt wording). Computes the readable transcript
 * text from the note, wires up the CLI hook + extras, and passes EmbeddedChat
 * the same prop shape it always had.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { NoteItem } from "../../types/electron";
import { useEmbeddedChatCli } from "../../hooks/useEmbeddedChatCli";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import EmbeddedChat, { type EmbeddedChatMode } from "./EmbeddedChat";
import { useCliExtras } from "./EmbeddedChatCliExtras";

interface NoteEmbeddedChatProps {
  note: NoteItem;
  isMeetingNote: boolean;
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

export default function NoteEmbeddedChat({
  note,
  isMeetingNote,
  mode,
  onModeChange,
}: NoteEmbeddedChatProps) {
  const { t } = useTranslation();
  const vaultPath = useSettingsStore((s) => s.vaultPath);

  // Depend only on the fields the parser actually reads — otherwise any
  // unrelated note-field update (e.g. updated_at after autosave) would
  // re-parse the entire transcript JSON.
  const transcript = useMemo(
    () => transcriptPlainText(note),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, note.transcript, note.enhanced_content, note.content]
  );

  // Chat only supports sidebar ↔ hidden. The PanelRight button in
  // EmbeddedChat's header tries to flip into floating; coerce that to
  // sidebar (no-op if already there) so the chat never overlays the note.
  const handleModeChange = (next: EmbeddedChatMode) => {
    onModeChange(next === "floating" ? "sidebar" : next);
  };

  const chat = useEmbeddedChatCli({
    noteId: note.id,
    noteTitle: note.title || (isMeetingNote ? "Untitled meeting" : "Untitled note"),
    noteCreatedAt: note.created_at,
    transcript,
    noteSlug: note.client_note_id || `note-${note.id}`,
    isMeeting: isMeetingNote,
  });

  // Chip prompts stay English on purpose — they're instructions to the model,
  // not UI copy (same rule as the system prompt). Labels are translated.
  const suggestions = useMemo(
    () =>
      isMeetingNote
        ? [
            {
              label: t("notes.chat.suggest.summarise"),
              prompt: "Give me a concise summary of this meeting.",
            },
            {
              label: t("notes.chat.suggest.actionItems"),
              prompt:
                "Extract 3-5 action items as bullets. Include who's responsible if it's clear from the transcript.",
            },
            {
              label: t("notes.chat.suggest.followUps"),
              prompt:
                "What follow-up conversations or questions should I chase up after this meeting?",
            },
          ]
        : [
            {
              label: t("notes.chat.suggest.summariseNote"),
              prompt: "Give me a concise summary of this note.",
            },
            {
              label: t("notes.chat.suggest.extractTasks"),
              prompt:
                "Extract any tasks or to-dos from this note as bullets, with owners if they're clear.",
            },
            {
              label: t("notes.chat.suggest.keyIdeas"),
              prompt: "What are the key ideas in this note?",
            },
          ],
    [isMeetingNote, t]
  );

  const extras = useCliExtras({
    vaultPath,
    agentState: chat.agentState,
    cli: chat.cli,
    hasMessages: chat.messages.length > 0,
    sendMessage: chat.sendMessage,
    suggestions,
    emptyStateText: isMeetingNote
      ? t("notes.chat.emptyMeeting")
      : t("notes.chat.emptyNote"),
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
