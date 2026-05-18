/**
 * useOnFallingEdge — fire a callback once when `value` transitions from
 * truthy to falsy. Used for "recording just stopped" style effects where
 * we want to react to a state going false without firing on the initial
 * mount and without firing repeatedly while still false.
 *
 * Pattern previously written inline as `prevRef + useEffect` in multiple
 * places (auto-show chat on stop, kick diarization on stop, …).
 */

import { useEffect, useRef } from "react";

export function useOnFallingEdge(
  value: boolean,
  callback: () => void | (() => void)
): void {
  const prevRef = useRef(false);
  useEffect(() => {
    const cleanup =
      prevRef.current && !value ? callback() : undefined;
    prevRef.current = value;
    return typeof cleanup === "function" ? cleanup : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
