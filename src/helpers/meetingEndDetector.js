const debugLogger = require("./debugLogger");

// Detector cadence and thresholds. Kept conservative on purpose: a false
// "did your meeting end?" mid-call is more annoying than missing one end, so we
// require sustained quiet (and, where available, a corroborating process
// signal) before prompting.
const POLL_INTERVAL_MS = 5000;
// Ignore the opening stretch of a recording — people often start the recorder
// before anyone has spoken.
const START_GRACE_MS = 30000;
// No new transcript segment for this long is the core "nothing is being said"
// signal. Transcript silence covers both mic and system audio.
const SILENCE_TRANSCRIPT_MS = 60000;
// Supporting audio-silence window (mic + system both quiet).
const SILENCE_AUDIO_MS = 45000;
// After a meeting app terminates we still wait this long for any trailing
// audio/transcript before treating it as high-confidence "call ended."
const HIGH_CONF_QUIET_MS = 10000;
// Auto-dismiss the prompt if the user never responds. Unlike the start prompt's
// timeout this does NOT touch start-detection state — the detector owns it.
const PROMPT_TIMEOUT_MS = 45000;

const WRAP_DETECTION_ID = "wrap:meeting-end";

function ageMs(iso, now) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return now - t;
}

/**
 * Main-process detector that watches the meeting recording lifecycle snapshot
 * and, when a call looks finished, surfaces a "Meeting wrapped?" prompt.
 *
 * It consumes the shared lifecycle bus snapshot (never the renderer stores) and
 * commands a stop through the normal control-panel `stopRecording()` path.
 */
class MeetingEndDetector {
  constructor(lifecycleManager, windowManager, meetingProcessDetector) {
    this.lifecycleManager = lifecycleManager;
    this.windowManager = windowManager;
    this.meetingProcessDetector = meetingProcessDetector;

    this._timer = null;
    this._sessionId = null;
    // Process keys for meeting apps that were running when this session began —
    // used to detect "the app I was on just quit."
    this._appsAtStart = new Set();
    this._meetingAppTerminated = false;
    // Snapshot of "latest activity timestamp" captured when the prompt was
    // shown, so we can auto-retract when newer activity arrives.
    this._promptShownAt = 0;
    this._promptActivityMark = 0;
    this._dismissed = false;
    this._promptTimeout = null;
    this._wrapWatchdog = null;

    this._onProcessEnded = (data) => {
      if (!data?.processKey) return;
      if (this._appsAtStart.has(data.processKey)) {
        this._meetingAppTerminated = true;
        debugLogger.info(
          "Meeting app that was open at recording start terminated",
          { processKey: data.processKey },
          "meeting"
        );
      }
    };
  }

  start() {
    if (this._timer) return;
    this.meetingProcessDetector?.on?.("meeting-process-ended", this._onProcessEnded);
    this._timer = setInterval(() => {
      try {
        this._tick();
      } catch (err) {
        debugLogger.warn?.(
          "Meeting end detector tick failed",
          { error: err?.message },
          "meeting"
        );
      }
    }, POLL_INTERVAL_MS);
    debugLogger.info("Meeting end detector started", {}, "meeting");
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._clearPromptTimeout();
    this._clearWrapWatchdog();
    this.meetingProcessDetector?.off?.("meeting-process-ended", this._onProcessEnded);
    this._resetSession(null);
  }

  _resetSession(sessionId) {
    this._sessionId = sessionId;
    // Only snapshot running meeting apps for a real session start — on
    // teardown (sessionId null) the set must be empty, not "whatever is
    // running at stop time."
    this._appsAtStart = sessionId
      ? new Set(
          (this.meetingProcessDetector?.getDetectedProcesses?.() || []).map((p) => p.processKey)
        )
      : new Set();
    this._meetingAppTerminated = false;
    this._dismissed = false;
    this._promptShownAt = 0;
    this._promptActivityMark = 0;
    this._clearPromptTimeout();
  }

  _meetingAppRunning() {
    return (this.meetingProcessDetector?.getDetectedProcesses?.() || []).length > 0;
  }

  // Latest of the activity timestamps — the most recent moment "something
  // happened" in the meeting.
  _latestActivity(snapshot, now) {
    const candidates = [
      snapshot.lastTranscriptSegmentAt,
      snapshot.lastMicAudioAt,
      snapshot.lastSystemAudioAt,
      snapshot.lastUtteranceEndAt,
    ];
    let latest = 0;
    for (const iso of candidates) {
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    return latest;
  }

  _tick() {
    const snapshot = this.lifecycleManager?.getSnapshot?.();
    if (!snapshot) return;
    const now = Date.now();

    // Track session boundaries. A new sessionId (or leaving "recording") resets
    // per-session detector state.
    if (snapshot.status !== "recording" || !snapshot.sessionId) {
      if (this._sessionId !== null) this._resetSession(null);
      return;
    }
    if (snapshot.sessionId !== this._sessionId) {
      this._resetSession(snapshot.sessionId);
    }

    // If a prompt is currently showing, the only thing we do is watch for
    // resumed activity and auto-retract.
    if (snapshot.wrapPromptVisible) {
      const latest = this._latestActivity(snapshot, now);
      if (latest > this._promptActivityMark) {
        debugLogger.info(
          "Meeting activity resumed while wrap prompt visible — auto-retracting",
          {},
          "meeting"
        );
        this._retractPrompt();
      }
      return;
    }

    // Gates that hard-block any prompt.
    if (snapshot.endDetectionSuppressed) return; // user chose "Keep recording"
    if (snapshot.dictationActive) return; // don't interrupt dictation
    if (ageMs(snapshot.startedAt, now) < START_GRACE_MS) return; // opening grace

    const confidence = this._evaluate(snapshot, now);
    if (!confidence) return;

    // After a dismiss, only re-fire on high-confidence evidence — don't re-nag
    // on the same sustained silence.
    if (this._dismissed && confidence !== "high") return;

    this._showPrompt(snapshot, now, confidence);
  }

  // Returns "high" | "medium" | null.
  _evaluate(snapshot, now) {
    const transcriptQuiet = ageMs(snapshot.lastTranscriptSegmentAt, now) >= HIGH_CONF_QUIET_MS;
    const micQuiet = ageMs(snapshot.lastMicAudioAt, now) >= HIGH_CONF_QUIET_MS;
    const systemQuiet = ageMs(snapshot.lastSystemAudioAt, now) >= HIGH_CONF_QUIET_MS;

    // High: a meeting app that was open when we started recording has quit, and
    // nothing has been heard for a short tail.
    if (this._meetingAppTerminated && transcriptQuiet && micQuiet && systemQuiet) {
      return "high";
    }

    // Medium: sustained transcript + audio silence. Suppressed while a known
    // desktop meeting app is still running (probably just a quiet moment).
    const transcriptSilent = ageMs(snapshot.lastTranscriptSegmentAt, now) >= SILENCE_TRANSCRIPT_MS;
    const micSilent = ageMs(snapshot.lastMicAudioAt, now) >= SILENCE_AUDIO_MS;
    const systemSilent = ageMs(snapshot.lastSystemAudioAt, now) >= SILENCE_AUDIO_MS;
    if (transcriptSilent && micSilent && systemSilent && !this._meetingAppRunning()) {
      return "medium";
    }

    return null;
  }

  _showPrompt(snapshot, now, confidence) {
    this._promptShownAt = now;
    this._promptActivityMark = this._latestActivity(snapshot, now);
    this.lifecycleManager?.applyPatch?.({ wrapPromptVisible: true });

    debugLogger.info("Showing meeting wrap-up prompt", { confidence }, "meeting");

    this.windowManager?.showMeetingNotification?.({
      kind: "wrap",
      detectionId: WRAP_DETECTION_ID,
      source: "end-detection",
      key: confidence,
      title: "Meeting wrapped?",
      body: "Your call looks finished — stop recording and save your notes?",
      event: null,
    });

    this._clearPromptTimeout();
    this._promptTimeout = setTimeout(() => {
      // Treated as a soft dismiss: hide, allow re-fire only on stronger evidence.
      debugLogger.info("Meeting wrap-up prompt timed out", {}, "meeting");
      this._dismissed = true;
      this._retractPrompt();
    }, PROMPT_TIMEOUT_MS);
  }

  _retractPrompt() {
    this._clearPromptTimeout();
    this.lifecycleManager?.applyPatch?.({ wrapPromptVisible: false });
    this.windowManager?.dismissMeetingNotification?.();
    this._promptShownAt = 0;
    this._promptActivityMark = 0;
  }

  _clearPromptTimeout() {
    if (this._promptTimeout) {
      clearTimeout(this._promptTimeout);
      this._promptTimeout = null;
    }
  }

  // Not cleared in _resetSession: the bus leaves "recording" (→ "wrapping")
  // before the watchdog's check runs, and that transition resets the session.
  // The watchdog's own status check makes a late fire harmless.
  _clearWrapWatchdog() {
    if (this._wrapWatchdog) {
      clearTimeout(this._wrapWatchdog);
      this._wrapWatchdog = null;
    }
  }

  // Called from the IPC layer when the user responds to a `wrap:` prompt.
  async handleResponse(action) {
    debugLogger.info("Meeting wrap-up response", { action }, "meeting");
    this._clearPromptTimeout();

    if (action === "wrap") {
      // Stop through the normal control-panel stopRecording() path. The store's
      // stop transition publishes status:"idle", which resets detector state on
      // the next tick.
      this.lifecycleManager?.applyPatch?.({ status: "wrapping", wrapPromptVisible: false });
      this.windowManager?.sendToControlPanel?.("meeting-wrap-up-stop", {});
      // Watchdog: if the stop command is lost (e.g. no listener registered in
      // the control panel at that moment), the bus would wedge in "wrapping"
      // forever and block any new session. Reflect reality (still recording)
      // and retry the stop once; if the renderer is alive the store's stop
      // transition publishes its own status right after.
      this._clearWrapWatchdog();
      this._wrapWatchdog = setTimeout(() => {
        this._wrapWatchdog = null;
        const current = this.lifecycleManager?.getSnapshot?.();
        if (current?.status !== "wrapping") return;
        debugLogger.warn?.(
          "Wrap-up stop did not complete within 10s — retrying and unwedging status",
          {},
          "meeting"
        );
        this.lifecycleManager?.applyPatch?.({ status: "recording" });
        this.windowManager?.sendToControlPanel?.("meeting-wrap-up-stop", {});
      }, 10000);
    } else if (action === "keep") {
      // Suppress for the rest of this recording session.
      this.lifecycleManager?.applyPatch?.({
        wrapPromptVisible: false,
        endDetectionSuppressed: true,
      });
    } else {
      // dismiss — hide, allow re-fire only on stronger evidence.
      this._dismissed = true;
      this.lifecycleManager?.applyPatch?.({ wrapPromptVisible: false });
    }

    this.windowManager?.dismissMeetingNotification?.();
  }
}

module.exports = MeetingEndDetector;
