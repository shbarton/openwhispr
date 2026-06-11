import React, { useMemo } from "react";
import { X, Check } from "lucide-react";
import "./TranscriptionBar.css";

export type TranscriptionBarState = "idle" | "recording" | "transcribing" | "error";

// How long "transcribing" may run before the View's slow-transcription
// affordance (message + cancel button) should be shown. Shared by every
// surface that drives this View's `showSlowMessage` prop (notes
// TranscriptionBar and the dictation panel in App.jsx).
export const SLOW_TRANSCRIPTION_THRESHOLD_MS = 5000;

interface TranscriptionBarViewProps {
  state: TranscriptionBarState;
  /** Normalized mic levels (0-1), 24 values for waveform bars */
  levels: number[];
  /** Time elapsed since state started, used for animations */
  animationTime: number;
  /** Error message to display in error state */
  errorMessage: string | null;
  /** Show "Taking longer than usual..." message */
  showSlowMessage?: boolean;
  /** Called when user clicks the idle bar to start recording */
  onStartRecording?: () => void;
  /** Called when user clicks cancel button */
  onCancel?: () => void;
  /** Called when user clicks stop button */
  onStop?: () => void;
}

const IDLE_WAVEFORM_LEVELS = [
  0.18, 0.24, 0.32, 0.42, 0.52, 0.58, 0.62,
  0.58, 0.52, 0.42, 0.32, 0.24, 0.18,
];

/**
 * Pure presentation component for the transcription bar widget.
 * Renders different UI based on state: idle, recording, transcribing, or error.
 */
export const TranscriptionBarView: React.FC<TranscriptionBarViewProps> = ({
  state,
  levels,
  animationTime,
  errorMessage,
  showSlowMessage = false,
  onStartRecording,
  onCancel,
  onStop,
}) => {
  // Mirror levels so center bars are loudest
  const mirroredLevels = useMemo(() => {
    const trimmed = levels.slice(0, 12);
    if (!trimmed.length) {
      return Array(24).fill(0);
    }
    return [...trimmed.slice().reverse(), ...trimmed];
  }, [levels]);

  const halfCount = mirroredLevels.length / 2;

  // Generate CSS custom properties for waveform bars
  const waveformStyle = useMemo(() => {
    const props: Record<string, string> = {};
    mirroredLevels.forEach((_, index) => {
      let scale: number;

      if (state === "recording") {
        const value = mirroredLevels[index] || 0;
        const distanceFromCenter = Math.abs(index - halfCount + 0.5) / halfCount;
        const centerWeight = 1 - distanceFromCenter * 0.15;

        // High sensitivity - amplify quiet sounds
        const boosted = Math.min(1, Math.sqrt(value) * 2.5);
        const normalized = Math.min(1, Math.pow(boosted, 0.5));

        // Idle shimmer wave
        const idleWave =
          Math.sin(animationTime * 2 + index * 0.3) * 0.03 +
          Math.sin(animationTime * 1.3 - index * 0.2) * 0.02;
        const idleBase = 0.12 + idleWave;

        scale = Math.max(idleBase, idleBase + normalized * (1 - idleBase) * centerWeight);
      } else if (state === "transcribing") {
        // Organic ripple animation for transcribing
        const rippleSpeed = 0.8;
        const rippleWidth = 8;

        const primaryWave = (animationTime * rippleSpeed * 24) % (24 + rippleWidth);
        const secondaryWave = (animationTime * rippleSpeed * 0.7 * 24) % (24 + rippleWidth);

        let rippleIntensity = 0;
        const dist1 = Math.abs(index - primaryWave);
        const dist2 = Math.abs(index - secondaryWave);

        if (dist1 < rippleWidth / 2) {
          rippleIntensity += Math.cos((dist1 / rippleWidth) * Math.PI * 2) * 0.4 + 0.4;
        }
        if (dist2 < rippleWidth / 2) {
          rippleIntensity += Math.cos((dist2 / rippleWidth) * Math.PI * 2) * 0.2 + 0.2;
        }

        const baseHeight = 0.15 + Math.sin(animationTime * 0.5 + index * 0.2) * 0.05;
        scale = Math.min(1, baseHeight + rippleIntensity * 0.6);
      } else {
        scale = 0.12;
      }

      props[`--bar-${index}`] = scale.toString();
    });
    return props as React.CSSProperties;
  }, [mirroredLevels, state, animationTime, halfCount]);

  // Render idle state
  if (state === "idle") {
    return (
      <div className="transcription-bar-container">
        <button
          type="button"
          className="transcription-bar-idle"
          onClick={onStartRecording}
          aria-label="Start recording"
          title="Click to start recording"
        >
          <div className="transcription-bar-idle-line" />
          <div className="transcription-bar-idle-waveform" aria-hidden="true">
            {IDLE_WAVEFORM_LEVELS.map((value, index) => (
              <span
                key={`idle-bar-${index}`}
                className="transcription-bar-idle-waveform-bar"
                style={{
                  opacity: 0.3 + value * 0.5,
                  transform: `scaleY(${value})`,
                }}
              />
            ))}
          </div>
        </button>
      </div>
    );
  }

  // Render error state
  if (state === "error") {
    return (
      <div className="transcription-bar-container">
        <div
          className="transcription-bar error"
          role="alert"
          aria-live="assertive"
        >
          <div className="transcription-bar-error">
            <span className="transcription-bar-error-icon" aria-hidden="true">!</span>
            <span>{errorMessage || "An error occurred"}</span>
          </div>
        </div>
      </div>
    );
  }

  // Render recording/transcribing state
  return (
    <div className="transcription-bar-container">
      {showSlowMessage && state === "transcribing" && (
        <div className="transcription-bar-slow-message" role="status">
          Taking longer than usual...
        </div>
      )}

      <div
        className={`transcription-bar ${state}`}
        style={waveformStyle}
        role="status"
        aria-label={state === "recording" ? "Recording in progress" : "Transcribing audio"}
        aria-live="polite"
      >
        {/* Cancel button (recording only) */}
        {state === "recording" && onCancel && (
          <button
            type="button"
            className="transcription-bar-button transcription-bar-cancel"
            onClick={onCancel}
            aria-label="Cancel recording"
            title="Cancel recording"
          >
            <X size={7} strokeWidth={2.5} />
          </button>
        )}

        {/* Waveform visualization */}
        <div className="transcription-bar-waveform" aria-hidden="true">
          {mirroredLevels.map((_, index) => {
            const scale = parseFloat(waveformStyle[`--bar-${index}` as keyof typeof waveformStyle] as string) || 0.12;
            const opacity = state === "recording"
              ? 0.35 + (mirroredLevels[index] || 0) * 0.65
              : 0.3 + scale * 0.7;

            return (
              <span
                key={`bar-${index}`}
                className="transcription-bar-waveform-bar"
                style={{
                  opacity,
                  transform: `scaleY(${scale})`,
                }}
              />
            );
          })}
        </div>

        {/* Stop button (recording only) */}
        {state === "recording" && onStop && (
          <button
            type="button"
            className="transcription-bar-button transcription-bar-stop"
            onClick={onStop}
            aria-label="Stop and transcribe"
            title="Stop and transcribe"
          >
            <Check size={7} strokeWidth={2.5} />
          </button>
        )}

        {/* Cancel button for stuck transcription */}
        {state === "transcribing" && showSlowMessage && onCancel && (
          <button
            type="button"
            className="transcription-bar-button transcription-bar-cancel"
            onClick={onCancel}
            aria-label="Cancel transcription"
            title="Cancel transcription"
          >
            <X size={7} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
};
