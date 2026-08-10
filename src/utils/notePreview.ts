const RE_HEADING = /#{1,6}\s+/g;
const RE_EMPHASIS = /[*_~`]+/g;
const RE_IMAGE = /!\[([^\]]*)\]\([^)]+\)/g;
const RE_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const RE_BLOCKQUOTE = />\s+/g;
const RE_WHITESPACE = /\s+/g;
/** Captures `"text": "..."` pairs, tolerating escaped quotes inside the value. */
const RE_SEGMENT_TEXT = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

function stripMarkdown(text: string): string {
  return text
    .replace(RE_IMAGE, "$1")
    .replace(RE_LINK, "$1")
    .replace(RE_HEADING, "")
    .replace(RE_EMPHASIS, "")
    .replace(RE_BLOCKQUOTE, "")
    .replace(RE_WHITESPACE, " ");
}

/**
 * Pulls readable text out of a stored transcript. The input is usually a
 * truncated slice of the segment JSON, so this scrapes complete `text` values
 * rather than parsing — a partial trailing segment is simply dropped.
 */
function extractTranscriptText(raw: string, maxSegments = 8): string {
  const parts: string[] = [];
  RE_SEGMENT_TEXT.lastIndex = 0;
  let match = RE_SEGMENT_TEXT.exec(raw);
  while (match && parts.length < maxSegments) {
    parts.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\"));
    match = RE_SEGMENT_TEXT.exec(raw);
  }
  return parts.join(" ");
}

/**
 * One-line preview for a meeting row. Accepts a note summary, a note body, or
 * raw transcript JSON — see `getRecentMeetings` in database.js, which returns
 * whichever of those exists.
 */
export function formatNotePreview(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trimStart();
  // `[{` rather than `[`, so a note opening with a markdown link isn't mistaken
  // for transcript JSON.
  const isTranscript = /^\[\s*\{/.test(trimmed);
  const source = isTranscript ? extractTranscriptText(trimmed) : trimmed;
  return stripMarkdown(source).trim();
}
