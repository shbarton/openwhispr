# tools/

Dev/diagnostic tooling — **not** shipped with the app. (Production native helpers
live in `resources/*.swift`, built by `scripts/build-*.js`.)

## meeting-detection-probe

Validates the per-process CoreAudio approach to meeting auto-detection (macOS
14.2+) before we commit to building it into the app. See the full write-up in the
vault: `projects/openwhispr/docs/meeting-detection-research.md`.

```bash
xcrun swiftc -O tools/meeting-detection-probe.swift -o tools/meeting-detection-probe \
  -framework CoreAudio -framework Foundation -framework AppKit

tools/meeting-detection-probe          # one-shot snapshot + meeting verdict
tools/meeting-detection-probe --watch  # live: prints when the call set changes
```

### What to test (the point of the probe)

Run `--watch`, then:

1. **Slack huddle** — start one. Expect `com.tinyspeck.slackmacgap` to show as a
   MEETING with `out=true` (and `in=true` once unmuted). This is the case our
   shipping mic-only listener misses.
2. **Zoom desktop** — join a call **muted**. Expect `us.zoom.xos` flagged on
   `out=true` alone. Unmute → `in=true`.
3. **Browser Google Meet** — join. Expect the browser bundle (e.g.
   `com.google.Chrome`) with `in`/`out`. (The real app would then AppleScript-check
   the tab URL; the probe flags any both-directions browser audio.)
4. **Negative control** — play YouTube/Spotify. Expect output-only and
   **"no meeting detected"** (the media false-positive filter).

### The key thing to learn

This is **not** a performance question — both permission levels read the same
metadata flags; the cost is identical. It's an **accuracy** question: does the
*lighter* permission still surface every app with correct in/out flags?

Specifically: can the packaged app identify apps with only the **Microphone**
permission it already has, or does it need the heavier
`NSAudioCaptureUsageDescription` (Screen & System Audio Recording)? The probe
now resolves each app's identity **two ways** — the CoreAudio `bundleID`
property *and* from the PID via `NSRunningApplication` — and prints
`[CA bundleID empty → resolved from PID]` when the CoreAudio read came back empty
but the PID resolved one. That's the tell that the bundle-id property is
permission-gated. Even if it is, the **PID path needs no permission**, so
detection stays light either way. Run it during a real Slack huddle / Zoom call
and watch whether that note appears.
