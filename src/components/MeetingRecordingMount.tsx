import { useEffect } from "react";
import {
  getMicAnalyser,
  primeMeetingWorklet,
  stopRecording,
  useMeetingRecordingStore,
} from "../stores/meetingRecordingStore";
import type { MeetingSessionPatch } from "../types/meetingLifecycle";

const EMA_PREV = 0.5;
const EMA_NEXT = 0.5;
const LIFECYCLE_PUBLISH_INTERVAL_MS = 200;

export default function MeetingRecordingMount(): null {
  const isRecording = useMeetingRecordingStore((s) => s.isRecording);

  useEffect(() => {
    primeMeetingWorklet();
  }, []);

  // "Yes, wrap up" from the end-detection prompt routes here so the stop runs
  // through the exact same control-panel path as the manual Stop button.
  useEffect(() => {
    const cleanup = window.electronAPI?.onMeetingWrapUpStop?.(() => {
      void stopRecording();
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    let rafId = 0;
    let smoothed = 0;
    let buf = new Float32Array(256);
    let lastPublishAt = 0;

    const tick = () => {
      const analyser = getMicAnalyser();
      if (analyser) {
        if (buf.length !== analyser.fftSize) {
          buf = new Float32Array(analyser.fftSize);
        }
        analyser.getFloatTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / buf.length);
        smoothed = EMA_PREV * smoothed + EMA_NEXT * rms;
        const clamped = smoothed < 0 ? 0 : smoothed > 1 ? 1 : smoothed;
        useMeetingRecordingStore.setState({ currentMicLevel: clamped });

        const now = performance.now();
        if (now - lastPublishAt >= LIFECYCLE_PUBLISH_INTERVAL_MS) {
          lastPublishAt = now;
          const patch: MeetingSessionPatch = { micLevel: clamped };
          if (clamped > 0.005) {
            patch.lastMicAudioAt = new Date().toISOString();
          }
          void window.electronAPI?.meetingSessionPublish?.(patch);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      useMeetingRecordingStore.setState({ currentMicLevel: 0 });
    };
  }, [isRecording]);

  return null;
}
