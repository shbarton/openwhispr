/**
 * Meeting Detection Probe (macOS 14.2+)
 *
 * A throwaway diagnostic to validate the per-process CoreAudio approach to
 * meeting auto-detection BEFORE we commit to an architecture. It enumerates
 * every process currently registered with CoreAudio and reports, per process,
 * whether it is capturing input (mic) and/or producing output (speaker), plus
 * its bundle id / name.
 *
 * Why this exists: our shipping `macos-mic-listener.swift` uses the legacy
 * device-level `kAudioDevicePropertyDeviceIsRunningSomewhere` — it only knows
 * "some app is using the mic," can't see who, misses muted-but-listening, and
 * is buggy on Bluetooth. The per-process properties below fix all of that.
 *
 * Two questions this probe answers:
 *   1) Does it correctly flag a Slack huddle / Zoom call / browser Meet, and
 *      can the "input AND output active" heuristic distinguish a call from
 *      music (output only)?
 *   2) What macOS permission does merely READING these properties require —
 *      just Microphone, or the heavier Screen & System Audio Recording? Run it
 *      and watch for (or note the absence of) a TCC prompt.
 *
 * Compile:
 *   xcrun swiftc -O tools/meeting-detection-probe.swift -o tools/meeting-detection-probe \
 *     -framework CoreAudio -framework Foundation -framework AppKit
 *
 * Run:
 *   tools/meeting-detection-probe            # one-shot snapshot of all audio processes
 *   tools/meeting-detection-probe --watch    # live: prints when the call-candidate set changes
 */

import AppKit
import CoreAudio
import Foundation

// Bundle ids we treat as "communication apps." For these, output-only audio
// (a muted listener) is a strong meeting signal; for everything else we require
// input AND output to avoid false-firing on music/video.
let COMMS_BUNDLE_IDS: Set<String> = [
    "us.zoom.xos",
    "com.tinyspeck.slackmacgap",
    "com.microsoft.teams",
    "com.microsoft.teams2",
    "com.cisco.webexmeetingsapp",
    "com.webex.meetingmanager",
    "com.apple.FaceTime",
    "com.hnc.Discord",
]

// Browsers — meeting candidates only when BOTH input and output are live
// (a real call), since they also play ordinary media.
let BROWSER_BUNDLE_IDS: Set<String> = [
    "com.google.Chrome",
    "com.apple.Safari",
    "company.thebrowser.Browser", // Arc
    "com.microsoft.edgemac",
    "org.mozilla.firefox",
    "com.brave.Browser",
]

// MARK: - CoreAudio property helpers

func audioObjectList(_ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
            == noErr, size > 0
    else { return [] }

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var ids = [AudioObjectID](repeating: 0, count: count)
    guard
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr
    else { return [] }
    return ids
}

func uint32Prop(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(obj, &address, 0, nil, &size, &value)
    return value
}

func pidProp(_ obj: AudioObjectID) -> pid_t {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyPID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: pid_t = -1
    var size = UInt32(MemoryLayout<pid_t>.size)
    AudioObjectGetPropertyData(obj, &address, 0, nil, &size, &value)
    return value
}

func bundleIDProp(_ obj: AudioObjectID) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyBundleID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(obj, &address, 0, nil, &size) == noErr, size > 0 else {
        return nil
    }
    var cfStr: Unmanaged<CFString>?
    let status = withUnsafeMutablePointer(to: &cfStr) {
        AudioObjectGetPropertyData(obj, &address, 0, nil, &size, $0)
    }
    guard status == noErr, let cfStr = cfStr else { return nil }
    let str = cfStr.takeRetainedValue() as String
    return str.isEmpty ? nil : str
}

// MARK: - Model

struct AudioProc {
    let pid: pid_t
    let caBundleID: String?   // from kAudioProcessPropertyBundleID (may be permission-gated)
    let pidBundleID: String?  // resolved from PID via NSRunningApplication (no permission)
    let pidName: String?      // app display name from PID (no permission)
    let input: Bool
    let output: Bool

    // The bundle id we'd actually key the whitelist on. Prefer CoreAudio's, fall
    // back to the PID-resolved one — so identity survives even if the CoreAudio
    // bundle-id read turns out to be gated.
    var effectiveBundleID: String? {
        if let b = caBundleID, !b.isEmpty { return b }
        if let b = pidBundleID, !b.isEmpty { return b }
        return nil
    }

    // True when CoreAudio gave us no bundle id but the PID did — the tell that
    // the bundle-id property read is permission-gated.
    var bundleIDLikelyGated: Bool {
        (caBundleID == nil || caBundleID!.isEmpty) && (pidBundleID != nil || pidName != nil)
    }

    var label: String {
        if let b = effectiveBundleID { return b }
        if let n = pidName { return n }
        return "pid \(pid)"
    }

    // Is this process plausibly a live call?
    var isMeetingCandidate: Bool {
        guard input || output else { return false }
        let b = effectiveBundleID ?? ""
        if COMMS_BUNDLE_IDS.contains(b) {
            // Comms app with ANY audio (covers muted listener = output only).
            return true
        }
        if BROWSER_BUNDLE_IDS.contains(b) {
            // Browser: require both directions (a real call, not YouTube).
            return input && output
        }
        // Unknown app: only the unambiguous both-directions case.
        return input && output
    }
}

func snapshot() -> [AudioProc] {
    audioObjectList(kAudioHardwarePropertyProcessObjectList).map { id in
        let pid = pidProp(id)
        let app = pid > 0 ? NSRunningApplication(processIdentifier: pid) : nil
        return AudioProc(
            pid: pid,
            caBundleID: bundleIDProp(id),
            pidBundleID: app?.bundleIdentifier,
            pidName: app?.localizedName,
            input: uint32Prop(id, kAudioProcessPropertyIsRunningInput) != 0,
            output: uint32Prop(id, kAudioProcessPropertyIsRunningOutput) != 0
        )
    }
}

// MARK: - Output

func printAll(_ procs: [AudioProc]) {
    print("\n  Total processes in CoreAudio process list: \(procs.count)")
    print("  (if this is ~0–2 during an active call, the LIST itself is gated)\n")
    print("  IN  OUT  PROCESS")
    print("  --  ---  -------------------------------------------")
    for p in procs.sorted(by: { ($0.label) < ($1.label) }) {
        let gated = p.bundleIDLikelyGated ? "  [CA bundleID empty → from PID]" : ""
        let cand = p.isMeetingCandidate ? "  ← CANDIDATE" : ""
        print("  \(p.input ? "● " : "○ ") \(p.output ? "●  " : "○  ") \(p.label)\(cand)\(gated)")
    }
    print("")
}

func printSnapshot(_ procs: [AudioProc]) {
    let active = procs.filter { $0.input || $0.output }
    print("\n  IN  OUT  PROCESS")
    print("  --  ---  -------------------------------------------")
    if active.isEmpty {
        print("  (no process is currently using audio)")
    }
    var anyGated = false
    for p in active.sorted(by: { ($0.effectiveBundleID ?? "") < ($1.effectiveBundleID ?? "") }) {
        let mark = p.isMeetingCandidate ? "  ← MEETING CANDIDATE" : ""
        // Show CoreAudio-bundleID vs PID-resolved so gating is visible.
        let gated = p.bundleIDLikelyGated ? "  [CA bundleID empty → resolved from PID]" : ""
        if p.bundleIDLikelyGated { anyGated = true }
        print("  \(p.input ? "● " : "○ ") \(p.output ? "●  " : "○  ") \(p.label)\(mark)\(gated)")
    }

    let candidates = procs.filter { $0.isMeetingCandidate }
    print("")
    if candidates.isEmpty {
        print("  VERDICT: no meeting detected")
    } else {
        let names = candidates.map { $0.label }.joined(separator: ", ")
        print("  VERDICT: MEETING — \(names)")
    }
    if anyGated {
        print("  NOTE: CoreAudio bundle-id read came back empty for some apps but the")
        print("        PID resolved one → the bundle-id property is likely permission-")
        print("        gated. Identity via PID still works with no extra permission.")
    }
    print("")
}

// MARK: - Main

let watch = CommandLine.arguments.contains("--watch")
let all = CommandLine.arguments.contains("--all")

if all {
    printAll(snapshot())
    exit(0)
}

if !watch {
    printSnapshot(snapshot())
    exit(0)
}

// Watch mode: print whenever the call-candidate set changes, plus a heartbeat.
print("Watching for meetings (Ctrl-C to stop)…")
var lastKey = ""

func tick() {
    let procs = snapshot()
    let candidates = procs.filter { $0.isMeetingCandidate }
    let key = candidates.map { "\($0.label)|\($0.input ? 1 : 0)\($0.output ? 1 : 0)" }
        .sorted().joined(separator: ",")
    if key != lastKey {
        lastKey = key
        let ts = ISO8601DateFormatter().string(from: Date())
        if candidates.isEmpty {
            print("[\(ts)] — no meeting")
        } else {
            for c in candidates {
                print("[\(ts)] MEETING: \(c.label)  in=\(c.input) out=\(c.output)")
            }
        }
    }
}

// React quickly to processes entering/leaving the audio graph…
var listenerAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
AudioObjectAddPropertyListenerBlock(
    AudioObjectID(kAudioObjectSystemObject), &listenerAddress, DispatchQueue.main
) { _, _ in tick() }

// …and poll on an interval to catch mute/unmute (in/out flips without a
// process-list change).
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: 1.0)
timer.setEventHandler { tick() }
timer.resume()

CFRunLoopRun()
