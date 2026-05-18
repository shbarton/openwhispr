/**
 * MeetingChatRail — collapsed state of the meeting-note chat sidebar.
 *
 * Renders a thin vertical bar on the right edge in place of the full
 * sidebar when chatMode === "hidden". Click anywhere on the rail to
 * expand it back to the full sidebar — so the assistant always has a
 * persistent affordance for meeting notes, never fully vanishing.
 */

import { MessageSquare } from "lucide-react";
import { cn } from "../lib/utils";

interface MeetingChatRailProps {
  onExpand: () => void;
}

export default function MeetingChatRail({ onExpand }: MeetingChatRailProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title="Open AI assistant"
      aria-label="Open AI assistant"
      className={cn(
        "shrink-0 group/rail",
        "w-9 h-full",
        "border-l border-border/25 dark:border-white/10",
        "bg-surface-1 dark:bg-surface-2",
        "flex flex-col items-center pt-3 gap-2",
        "text-foreground-muted hover:text-foreground",
        "hover:bg-surface-2/60 dark:hover:bg-surface-3/40",
        "transition-colors cursor-pointer outline-none"
      )}
    >
      <MessageSquare
        size={14}
        className="opacity-70 group-hover/rail:opacity-100 transition-opacity"
      />
      <span
        className="text-[10px] text-foreground-muted/60 tracking-wide"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        AI
      </span>
    </button>
  );
}
