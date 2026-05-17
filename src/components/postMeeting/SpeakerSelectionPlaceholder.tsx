/**
 * SpeakerSelectionPlaceholder - Greyed-out placeholder for future speaker
 * matching feature. V1 stub.
 */

import { Users } from "lucide-react";

export default function SpeakerSelectionPlaceholder() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-border bg-surface-2/40 dark:bg-surface-3/30 text-foreground-muted">
      <Users size={16} className="shrink-0" />
      <div className="flex-1">
        <div className="text-sm font-medium">Speaker selection</div>
        <div className="text-xs">
          Map detected speakers to your contacts — coming soon.
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-foreground-muted">
        Soon
      </span>
    </div>
  );
}
