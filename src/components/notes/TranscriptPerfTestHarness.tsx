import { useEffect, useRef, useState } from "react";
import { MeetingTranscriptChat } from "./MeetingTranscriptChat";
import type { TranscriptSegment } from "../../stores/meetingRecordingStore";

// Dev-only perf harness for the live meeting transcript list.
// Reach it in a browser at the Vite dev URL: `?ui-test=transcript-perf`.
//
// Purpose: reproduce the long-meeting render load WITHOUT a 40-minute call.
// "Load 3000" injects thousands of synthetic segments; "Stream" appends them
// rapidly to mimic live arrival. The FPS meter + the always-spinning indicator
// make jank obvious. Flip "Virtualized" off to feel the pre-fix behaviour
// (every segment rendered as a DOM node) for comparison.

const SENTENCES = [
  "And you know, normally, if it's within budget we just sign off on it.",
  "Right, so the other thing is how we want to tackle the rollout.",
  "When people come into the office we should capture that too.",
  "Meanwhile I was writing the docs ahead of the launch.",
  "We need to tell the design team to rewrite the onboarding flow.",
  "Yep, that works for me — let's circle back next week.",
  "Potential buyers, not only small to medium organizations.",
  "Okay so the referral discounts — how do we share those out?",
];

const BASE_TS = 1_700_000_000_000;

function makeSegment(i: number): TranscriptSegment {
  const isSystem = i % 2 === 1;
  return {
    id: `syn-${i}`,
    text: `${i + 1}. ${SENTENCES[i % SENTENCES.length]}`,
    source: isSystem ? "system" : "mic",
    timestamp: BASE_TS + i * 1000,
    speaker: isSystem ? `speaker_${i % 3}` : undefined,
    speakerName: isSystem ? undefined : undefined,
  };
}

function makeRange(start: number, count: number): TranscriptSegment[] {
  return Array.from({ length: count }, (_, k) => makeSegment(start + k));
}

export default function TranscriptPerfTestHarness() {
  const [segments, setSegments] = useState<TranscriptSegment[]>(() => makeRange(0, 200));
  const [virtualized, setVirtualized] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [fps, setFps] = useState(0);

  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // FPS meter — drops visibly if the main thread is blocked by rendering.
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!streaming) {
      if (streamRef.current) clearInterval(streamRef.current);
      streamRef.current = null;
      return;
    }
    // Append 3 finals every 100ms — ~30 segments/sec, faster than a real call,
    // a deliberately harsh sustained load.
    streamRef.current = setInterval(() => {
      setSegments((prev) => [...prev, ...makeRange(prev.length, 3)]);
    }, 100);
    return () => {
      if (streamRef.current) clearInterval(streamRef.current);
      streamRef.current = null;
    };
  }, [streaming]);

  const load = (n: number) => {
    setStreaming(false);
    setSegments(makeRange(0, n));
  };

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 flex-wrap border-b border-border px-4 py-2 text-xs">
        <strong className="text-sm">Transcript perf harness</strong>
        <span className="tabular-nums">
          segments: <b>{segments.length.toLocaleString()}</b>
        </span>
        <span
          className="tabular-nums"
          style={{ color: fps >= 50 ? "var(--color-primary, green)" : fps >= 30 ? "orange" : "red" }}
        >
          fps: <b>{fps}</b>
        </span>
        {/* Always-spinning reference: stutters whenever the main thread blocks. */}
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        <span className="ml-2 flex items-center gap-1">
          load:
          {[500, 2000, 3000, 5000].map((n) => (
            <button
              key={n}
              onClick={() => load(n)}
              className="px-2 py-0.5 rounded border border-border hover:bg-accent"
            >
              {n.toLocaleString()}
            </button>
          ))}
        </span>
        <button
          onClick={() => setStreaming((s) => !s)}
          className="px-2 py-0.5 rounded border border-border hover:bg-accent"
        >
          {streaming ? "■ stop stream" : "▶ stream (+30/s)"}
        </button>
        <button
          onClick={() => {
            setStreaming(false);
            setSegments([]);
          }}
          className="px-2 py-0.5 rounded border border-border hover:bg-accent"
        >
          clear
        </button>
        <label className="flex items-center gap-1 ml-2 cursor-pointer">
          <input
            type="checkbox"
            checked={virtualized}
            onChange={(e) => setVirtualized(e.target.checked)}
          />
          Virtualized {virtualized ? "(new)" : "(OFF — naïve render-all, pre-fix)"}
        </label>
      </div>

      <div className="flex-1 min-h-0">
        {virtualized ? (
          <MeetingTranscriptChat segments={segments} isRecording />
        ) : (
          <NaiveAllNodesList segments={segments} />
        )}
      </div>
    </div>
  );
}

// Approximates the pre-fix behaviour: every segment is a mounted DOM node and
// the whole list re-renders on each change. Use the toggle to feel the jank at
// 3000+ segments, especially while streaming.
function NaiveAllNodesList({ segments }: { segments: TranscriptSegment[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight; // forced reflow per change, like the old code
  });
  return (
    <div ref={ref} className="h-full overflow-y-auto px-4 pt-3 pb-24 flex flex-col gap-1.5">
      {segments.map((s) => {
        const selfSide = s.source === "mic" && !s.speaker;
        return (
          <div key={s.id} className={`flex flex-col ${selfSide ? "items-start" : "items-end"}`}>
            <div className="relative max-w-[80%]">
              <div
                className={`px-3 py-1.5 rounded-lg text-[13px] leading-relaxed ${
                  selfSide
                    ? "bg-primary/90 text-primary-foreground"
                    : "bg-surface-2 border border-border/30 text-foreground"
                }`}
              >
                {s.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
