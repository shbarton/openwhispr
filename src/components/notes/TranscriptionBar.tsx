import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useMeetingRecordingStore,
  startRecording,
  stopRecording,
  getMicAnalyser,
} from "../../stores/meetingRecordingStore";
import { TranscriptionBarView, type TranscriptionBarState } from "./TranscriptionBarView";

interface TranscriptionBarProps {
  /** Note ID to record to (optional - will create new note if not provided) */
  noteId?: number | null;
  /** Note title for the recording */
  noteTitle?: string | null;
  /** Folder ID for the note */
  folderId?: number | null;
  /** Callback when recording starts successfully */
  onRecordingStart?: () => void;
  /** Callback when recording stops */
  onRecordingStop?: () => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
}

const LEVEL_BAR_COUNT = 12;
const ERROR_AUTO_DISMISS_MS = 3200;
const SLOW_TRANSCRIPTION_THRESHOLD_MS = 5000;
const TRANSCRIPTION_TIMEOUT_MS = 30000;

/**
 * TranscriptionBar widget - SpellStream-style recording interface.
 *
 * States:
 * - idle: Small horizontal line (56x6px), expands on hover
 * - recording: Pill with 24-bar waveform visualization
 * - transcribing: Pill with ripple animation
 * - error: Red text with auto-dismiss
 *
 * The widget is rendered as a portal to document.body for fixed positioning.
 */
export default function TranscriptionBar({
  noteId = null,
  noteTitle = null,
  folderId = null,
  onRecordingStart,
  onRecordingStop,
  onError,
}: TranscriptionBarProps) {
  const isRecording = useMeetingRecordingStore((s) => s.isRecording);
  const isTranscribing = useMeetingRecordingStore((s) => s.isTranscribing);
  const storeError = useMeetingRecordingStore((s) => s.error);

  const [state, setState] = useState<TranscriptionBarState>("idle");
  const [levels, setLevels] = useState<number[]>(Array(LEVEL_BAR_COUNT).fill(0));
  const [animationTime, setAnimationTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  const animationRef = useRef<number | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transcribingStartRef = useRef<number | null>(null);
  const smoothedLevelsRef = useRef<number[]>(Array(LEVEL_BAR_COUNT).fill(0));
  const lastFrameTimeRef = useRef<number>(0);

  // Derive state from store
  useEffect(() => {
    if (storeError) {
      setState("error");
      setErrorMessage(storeError);
    } else if (isTranscribing && !isRecording) {
      setState("transcribing");
    } else if (isRecording) {
      setState("recording");
    } else {
      setState("idle");
    }
  }, [isRecording, isTranscribing, storeError]);

  // Handle error auto-dismiss
  useEffect(() => {
    if (state === "error") {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }

      errorTimeoutRef.current = setTimeout(() => {
        setState("idle");
        setErrorMessage(null);
        useMeetingRecordingStore.setState({ error: null });
      }, ERROR_AUTO_DISMISS_MS);

      return () => {
        if (errorTimeoutRef.current) {
          clearTimeout(errorTimeoutRef.current);
        }
      };
    }
  }, [state]);

  // Track slow transcription
  useEffect(() => {
    if (state === "transcribing") {
      transcribingStartRef.current = Date.now();
      setShowSlowMessage(false);

      const slowTimer = setTimeout(() => {
        setShowSlowMessage(true);
      }, SLOW_TRANSCRIPTION_THRESHOLD_MS);

      // Timeout for stuck transcriptions
      const timeoutTimer = setTimeout(() => {
        setState("error");
        setErrorMessage("Transcription timed out");
        useMeetingRecordingStore.setState({
          error: "Transcription timed out",
          isTranscribing: false,
        });
      }, TRANSCRIPTION_TIMEOUT_MS);

      return () => {
        clearTimeout(slowTimer);
        clearTimeout(timeoutTimer);
        transcribingStartRef.current = null;
      };
    } else {
      setShowSlowMessage(false);
      transcribingStartRef.current = null;
    }
  }, [state]);

  // Animation loop for waveform and time tracking (capped at 30fps)
  useEffect(() => {
    if (state !== "recording" && state !== "transcribing") {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const startTime = performance.now();
    lastFrameTimeRef.current = startTime;

    const animate = (currentTime: number) => {
      // Cap at ~30fps (33ms between frames)
      const elapsed = currentTime - lastFrameTimeRef.current;
      if (elapsed < 33) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameTimeRef.current = currentTime;

      // Update animation time
      const totalElapsed = (currentTime - startTime) / 1000;
      setAnimationTime(totalElapsed);

      // Update mic levels during recording
      if (state === "recording") {
        const analyser = getMicAnalyser();
        if (analyser) {
          const buf = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(buf);

          // Compute RMS for each segment of the buffer
          const segmentSize = Math.floor(buf.length / LEVEL_BAR_COUNT);
          const newLevels: number[] = [];

          for (let i = 0; i < LEVEL_BAR_COUNT; i++) {
            let sumSquares = 0;
            const start = i * segmentSize;
            const end = Math.min(start + segmentSize, buf.length);

            for (let j = start; j < end; j++) {
              const v = buf[j];
              sumSquares += v * v;
            }

            const rms = Math.sqrt(sumSquares / (end - start));
            newLevels.push(rms);
          }

          // Smooth the levels
          const smoothed = smoothedLevelsRef.current.map((prev, i) => {
            const target = newLevels[i] || 0;
            const factor = target > prev ? 0.5 : 0.35;
            return prev * (1 - factor) + target * factor;
          });

          smoothedLevelsRef.current = smoothed;
          setLevels(smoothed);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state]);

  // Handle start recording
  const handleStartRecording = useCallback(async () => {
    try {
      await startRecording({
        noteId,
        noteTitle,
        folderId,
      });
      onRecordingStart?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start recording";
      setState("error");
      setErrorMessage(message);
      onError?.(message);
    }
  }, [noteId, noteTitle, folderId, onRecordingStart, onError]);

  // Handle cancel recording
  const handleCancel = useCallback(async () => {
    try {
      // Stop recording without keeping the transcription
      await stopRecording();
      setState("idle");
      setLevels(Array(LEVEL_BAR_COUNT).fill(0));
      smoothedLevelsRef.current = Array(LEVEL_BAR_COUNT).fill(0);
      useMeetingRecordingStore.setState({
        segments: [],
        transcript: "",
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel recording";
      setState("error");
      setErrorMessage(message);
      onError?.(message);
    }
  }, [onError]);

  // Handle stop recording
  const handleStop = useCallback(async () => {
    try {
      await stopRecording();
      onRecordingStop?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop recording";
      setState("error");
      setErrorMessage(message);
      onError?.(message);
    }
  }, [onRecordingStop, onError]);

  // Render as portal to document.body
  return createPortal(
    <TranscriptionBarView
      state={state}
      levels={levels}
      animationTime={animationTime}
      errorMessage={errorMessage}
      showSlowMessage={showSlowMessage}
      onStartRecording={handleStartRecording}
      onCancel={handleCancel}
      onStop={handleStop}
    />,
    document.body
  );
}
