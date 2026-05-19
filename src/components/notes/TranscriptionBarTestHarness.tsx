import { useEffect, useRef, useState } from "react";
import { TranscriptionBarView, type TranscriptionBarState } from "./TranscriptionBarView";

type LevelMode = "zero" | "noise" | "manual";

const STATES: TranscriptionBarState[] = ["idle", "recording", "transcribing", "error"];
const LEVEL_BAR_COUNT = 12;

export default function TranscriptionBarTestHarness() {
  const [state, setState] = useState<TranscriptionBarState>("idle");
  const [levelMode, setLevelMode] = useState<LevelMode>("noise");
  const [manualLevel, setManualLevel] = useState(0.5);
  const [errorMessage, setErrorMessage] = useState("Microphone access required");
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  const [levels, setLevels] = useState<number[]>(Array(LEVEL_BAR_COUNT).fill(0));
  const [animationTime, setAnimationTime] = useState(0);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Animation loop: drive levels + animationTime regardless of state
  // (so transcribing ripple animates too).
  useEffect(() => {
    startTimeRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - startTimeRef.current) / 1000;
      setAnimationTime(elapsed);

      if (levelMode === "zero") {
        setLevels(Array(LEVEL_BAR_COUNT).fill(0));
      } else if (levelMode === "manual") {
        setLevels(Array(LEVEL_BAR_COUNT).fill(manualLevel));
      } else {
        // Animated pseudo-mic noise: per-bar sine + jitter
        const next = Array.from({ length: LEVEL_BAR_COUNT }, (_, i) => {
          const a = Math.sin(elapsed * 4 + i * 0.7) * 0.35 + 0.4;
          const b = Math.sin(elapsed * 11 + i * 1.3) * 0.15;
          return Math.max(0, Math.min(1, a + b));
        });
        setLevels(next);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [levelMode, manualLevel]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-background, #0f172a)",
        color: "var(--color-text-primary, #e2e8f0)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        padding: "32px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gap: 24 }}>
        <header>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            TranscriptionBar — UI test harness
          </h1>
          <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: 13 }}>
            Pure presentational. The widget renders fixed at bottom-center via portal.
          </p>
        </header>

        <Section title="State">
          <ButtonRow>
            {STATES.map((s) => (
              <ToggleButton key={s} active={state === s} onClick={() => setState(s)}>
                {s}
              </ToggleButton>
            ))}
          </ButtonRow>
        </Section>

        <Section title="Mic levels">
          <ButtonRow>
            {(["zero", "noise", "manual"] as LevelMode[]).map((m) => (
              <ToggleButton key={m} active={levelMode === m} onClick={() => setLevelMode(m)}>
                {m}
              </ToggleButton>
            ))}
          </ButtonRow>
          {levelMode === "manual" && (
            <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <span style={{ fontSize: 13, opacity: 0.8, width: 80 }}>
                level: {manualLevel.toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={manualLevel}
                onChange={(e) => setManualLevel(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
            </label>
          )}
        </Section>

        <Section title="Transcribing options">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showSlowMessage}
              onChange={(e) => setShowSlowMessage(e.target.checked)}
            />
            Show "Taking longer than usual…" message + cancel button
          </label>
        </Section>

        <Section title="Error message">
          <input
            type="text"
            value={errorMessage}
            onChange={(e) => setErrorMessage(e.target.value)}
            placeholder="Error message text"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "inherit",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
          <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.6 }}>
            Only visible when state is "error". (In production, auto-dismisses after 3.2s.)
          </p>
        </Section>

        <Section title="Live values">
          <pre
            style={{
              fontSize: 11,
              opacity: 0.7,
              margin: 0,
              padding: 12,
              background: "rgba(255,255,255,0.03)",
              borderRadius: 6,
              overflow: "auto",
            }}
          >
{`state          ${state}
levelMode      ${levelMode}
animationTime  ${animationTime.toFixed(2)}s
levels[0..3]   ${levels.slice(0, 4).map((l) => l.toFixed(2)).join(", ")}`}
          </pre>
        </Section>
      </div>

      <TranscriptionBarView
        state={state}
        levels={levels}
        animationTime={animationTime}
        errorMessage={errorMessage}
        showSlowMessage={showSlowMessage}
        onStartRecording={() => setState("recording")}
        onCancel={() => setState("idle")}
        onStop={() => setState("transcribing")}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>;
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        border: `1px solid ${active ? "rgba(120,170,255,0.6)" : "rgba(255,255,255,0.12)"}`,
        background: active ? "rgba(80,130,230,0.25)" : "rgba(255,255,255,0.04)",
        color: "inherit",
        fontSize: 13,
        fontFamily: "inherit",
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {children}
    </button>
  );
}
