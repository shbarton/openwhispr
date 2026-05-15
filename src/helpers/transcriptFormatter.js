const { i18nMain } = require("./i18nMain");

function resolveSpeaker(seg, speakerMappings) {
  if (seg.speakerName && !seg.speakerIsPlaceholder) return seg.speakerName;
  if (seg.speaker && speakerMappings[seg.speaker]) return speakerMappings[seg.speaker];
  if (seg.speaker === "you") return "You";
  if (seg.speaker) {
    const num = parseInt(seg.speaker.replace("speaker_", ""), 10);
    if (!isNaN(num)) return `Speaker ${num + 1}`;
  }
  if (seg.source === "mic") return i18nMain.t("transcript.speaker.you");
  if (seg.source === "system") return i18nMain.t("transcript.speaker.others");
  return "Unknown Speaker";
}

const MERGE_WINDOW_MS = 2000;

function mergeSegments(segments) {
  const merged = [];
  for (const seg of segments) {
    if (!seg.text?.trim()) continue;
    const ts = seg.timestamp || 0;
    const last = merged[merged.length - 1];
    if (last && last.speaker === (seg.speaker || "") && ts - last.timestamp < MERGE_WINDOW_MS) {
      last.text = last.text + " " + seg.text.trim();
      last.timestamp = ts;
    } else {
      merged.push({ ...seg, timestamp: ts, text: seg.text.trim() });
    }
  }
  return merged;
}

function elapsedSeconds(seg, startMs) {
  const ts = seg.timestamp || 0;
  return Math.max(0, (ts - startMs) / 1000);
}

function formatTimestamp(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatSrtTimestamp(seconds) {
  const s = Math.floor(seconds);
  const ms = Math.round((seconds - s) * 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function extractMetadata(note) {
  const title = note.title || "Untitled";
  const noteDate = new Date(note.created_at);
  const dateStr =
    noteDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) +
    " " +
    noteDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  let participants = [];
  try {
    const parsed = JSON.parse(note.participants || "[]");
    participants = parsed.map((p) => p.name).filter(Boolean);
  } catch {}

  return { title, dateStr, participants };
}

function formatTxt(note, segments, speakerMappings) {
  const merged = mergeSegments(segments);
  const startMs = merged[0]?.timestamp || 0;
  const { title, dateStr, participants } = extractMetadata(note);

  const lines = [title, dateStr];
  if (participants.length) lines.push(`Participants: ${participants.join(", ")}`);
  lines.push("", "──────────────────────────────────", "");
  for (const seg of merged) {
    lines.push(
      `[${formatTimestamp(elapsedSeconds(seg, startMs))}] ${resolveSpeaker(seg, speakerMappings)}:`
    );
    lines.push(seg.text);
    lines.push("");
  }
  return lines.join("\n");
}

function formatSrt(segments, speakerMappings) {
  const merged = mergeSegments(segments);
  const startMs = merged[0]?.timestamp || 0;
  const entries = [];
  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i];
    const segElapsed = elapsedSeconds(seg, startMs);
    const nextElapsed =
      i + 1 < merged.length ? elapsedSeconds(merged[i + 1], startMs) : segElapsed + 3;
    entries.push(`${i + 1}`);
    entries.push(`${formatSrtTimestamp(segElapsed)} --> ${formatSrtTimestamp(nextElapsed)}`);
    entries.push(`${resolveSpeaker(seg, speakerMappings)}: ${seg.text}`);
    entries.push("");
  }
  return entries.join("\n");
}

function formatJson(note, segments, speakerMappings) {
  const merged = mergeSegments(segments);
  const startMs = merged[0]?.timestamp || 0;
  const { title, dateStr } = extractMetadata(note);

  const speakersSet = new Set();
  for (const seg of merged) speakersSet.add(resolveSpeaker(seg, speakerMappings));
  const lastSeg = merged[merged.length - 1];

  return JSON.stringify(
    {
      metadata: {
        title,
        date: dateStr,
        duration_seconds: lastSeg ? Math.round(elapsedSeconds(lastSeg, startMs)) : 0,
        speaker_count: speakersSet.size,
        segment_count: merged.length,
      },
      speakers: [...speakersSet],
      segments: merged.map((seg) => ({
        speaker: resolveSpeaker(seg, speakerMappings),
        timestamp: elapsedSeconds(seg, startMs),
        text: seg.text,
      })),
    },
    null,
    2
  );
}

function formatMd(note, segments, speakerMappings) {
  const merged = mergeSegments(segments);
  const startMs = merged[0]?.timestamp || 0;
  const { title, dateStr, participants } = extractMetadata(note);

  const lines = [`# ${title}`, "", `**Date:** ${dateStr}`];
  if (participants.length) lines.push(`**Participants:** ${participants.join(", ")}`);
  lines.push("", "---", "");
  for (const seg of merged) {
    lines.push(
      `**${resolveSpeaker(seg, speakerMappings)}** \`${formatTimestamp(elapsedSeconds(seg, startMs))}\``
    );
    lines.push(`${seg.text}`, "");
  }
  return lines.join("\n");
}

module.exports = { formatTxt, formatSrt, formatJson, formatMd };
