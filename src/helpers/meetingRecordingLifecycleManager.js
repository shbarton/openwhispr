const { BrowserWindow } = require("electron");
const debugLogger = require("./debugLogger");

const LEVEL_HISTORY_SIZE = 64;

const IDLE_SNAPSHOT = Object.freeze({
  sessionId: null,
  status: "idle",
  noteId: null,
  folderId: null,
  title: null,
  startedAt: null,
  stoppedAt: null,
  micLabel: null,
  micLevel: 0,
  levelHistory: [],
  systemAudioActive: false,
  lastMicAudioAt: null,
  lastSystemAudioAt: null,
  lastTranscriptSegmentAt: null,
  lastUtteranceEndAt: null,
  dictationActive: false,
  hudVisible: false,
  endDetectionSuppressed: false,
  wrapPromptVisible: false,
  queuedQuestionCount: 0,
  error: null,
  updatedAt: new Date(0).toISOString(),
  revision: 0,
});

const ACTIVE_STATUSES = new Set(["starting", "recording", "stopping", "wrapping"]);

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    levelHistory: snapshot.levelHistory.slice(),
  };
}

/**
 * Main-process owner of the current meeting recording session state.
 *
 * The control-panel renderer publishes lifecycle transitions and mic levels
 * here; other windows subscribe to broadcasts on `meeting-session-snapshot`
 * instead of importing the renderer-only `meetingRecordingStore`.
 */
class MeetingRecordingLifecycleManager {
  constructor() {
    this._snapshot = cloneSnapshot(IDLE_SNAPSHOT);
  }

  getSnapshot() {
    return cloneSnapshot(this._snapshot);
  }

  applyPatch(patch) {
    if (!patch || typeof patch !== "object") return this.getSnapshot();

    const next = { ...this._snapshot };
    let changed = false;

    for (const [key, value] of Object.entries(patch)) {
      if (key === "updatedAt" || key === "revision") continue;
      if (!(key in IDLE_SNAPSHOT)) continue;
      if (key === "levelHistory") continue;
      if (next[key] !== value) {
        next[key] = value;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "micLevel")) {
      const numeric = Number(patch.micLevel);
      if (Number.isFinite(numeric)) {
        next.micLevel = numeric;
        next.levelHistory = [...this._snapshot.levelHistory, numeric].slice(
          -LEVEL_HISTORY_SIZE
        );
        changed = true;
      }
    }

    // On transition to a terminal non-error status (idle), reset session-scoped
    // fields. `error` status keeps them so consumers can see what errored.
    if (
      Object.prototype.hasOwnProperty.call(patch, "status") &&
      !ACTIVE_STATUSES.has(patch.status) &&
      patch.status !== "error"
    ) {
      next.sessionId = null;
      next.noteId = null;
      next.folderId = null;
      next.title = null;
      next.startedAt = null;
      next.micLabel = null;
      next.micLevel = 0;
      next.levelHistory = [];
      next.systemAudioActive = false;
      next.lastMicAudioAt = null;
      next.lastSystemAudioAt = null;
      next.lastTranscriptSegmentAt = null;
      next.lastUtteranceEndAt = null;
      next.hudVisible = false;
      next.endDetectionSuppressed = false;
      next.wrapPromptVisible = false;
      next.queuedQuestionCount = 0;
      changed = true;
    }

    if (!changed) return this.getSnapshot();

    next.updatedAt = new Date().toISOString();
    next.revision = this._snapshot.revision + 1;

    this._snapshot = next;
    this._broadcast();
    return this.getSnapshot();
  }

  _broadcast() {
    const payload = this.getSnapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed()) continue;
      try {
        win.webContents.send("meeting-session-snapshot", payload);
      } catch (err) {
        debugLogger.warn?.(
          "meeting lifecycle broadcast send failed",
          { error: err?.message, windowId: win.id },
          "meeting"
        );
      }
    }
  }
}

module.exports = MeetingRecordingLifecycleManager;
