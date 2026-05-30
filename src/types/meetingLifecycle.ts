export type MeetingSessionStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "wrapping"
  | "error";

export interface MeetingSessionSnapshot {
  sessionId: string | null;
  status: MeetingSessionStatus;
  noteId: number | null;
  folderId: number | null;
  title: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  micLabel: string | null;
  micLevel: number;
  levelHistory: number[];
  systemAudioActive: boolean;
  lastMicAudioAt: string | null;
  lastSystemAudioAt: string | null;
  lastTranscriptSegmentAt: string | null;
  dictationActive: boolean;
  hudVisible: boolean;
  endDetectionSuppressed: boolean;
  wrapPromptVisible: boolean;
  queuedQuestionCount: number;
  error: string | null;
  updatedAt: string;
  revision: number;
}

export type MeetingSessionPatch = Partial<
  Omit<MeetingSessionSnapshot, "updatedAt" | "revision">
>;
