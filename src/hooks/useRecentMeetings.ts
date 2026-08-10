import { useCallback, useEffect, useRef, useState } from "react";
import type { RecentMeetingItem } from "../types/electron";

/**
 * Recently recorded meetings (note_type = "meeting"), newest first.
 *
 * Independent of the notes view's store: the dashboard needs a small,
 * meeting-only slice with trimmed rows, while `noteStore` holds whole notes for
 * whatever folder the notes view is browsing.
 *
 * Passing `project` narrows the list to that project instead of showing the
 * most recent across all of them.
 */
export function useRecentMeetings(
  limit = 5,
  project: string | null = null
): {
  meetings: RecentMeetingItem[];
  isLoading: boolean;
  refresh: () => void;
} {
  const [meetings, setMeetings] = useState<RecentMeetingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const rows = (await window.electronAPI?.getRecentMeetings?.(limit, project)) ?? [];
      if (!isMountedRef.current) return;
      setMeetings(rows);
    } catch {
      if (isMountedRef.current) setMeetings([]);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [limit, project]);

  // Note events fire per save while a note is being edited, so coalesce them
  // into one reload.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      load();
    }, 300);
  }, [load]);

  useEffect(() => {
    isMountedRef.current = true;
    load();

    const disposers: Array<() => void> = [];
    const added = window.electronAPI?.onNoteAdded?.(scheduleRefresh);
    if (added) disposers.push(added);
    const updated = window.electronAPI?.onNoteUpdated?.(scheduleRefresh);
    if (updated) disposers.push(updated);
    const deleted = window.electronAPI?.onNoteDeleted?.(scheduleRefresh);
    if (deleted) disposers.push(deleted);

    return () => {
      isMountedRef.current = false;
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      disposers.forEach((dispose) => dispose());
    };
  }, [load, scheduleRefresh]);

  return { meetings, isLoading, refresh: load };
}
