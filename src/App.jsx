import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { useToast } from "./components/ui/useToast";
import { useHotkey } from "./hooks/useHotkey";
import { formatHotkeyLabel } from "./utils/hotkeys";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";
import {
  TranscriptionBarView,
  SLOW_TRANSCRIPTION_THRESHOLD_MS,
} from "./components/notes/TranscriptionBarView";

// Drag threshold in px — below this, mousedown→mouseup is treated as a click
// and the bar action fires; above it, it's treated as a window drag and the
// click is suppressed.
const DRAG_THRESHOLD_PX = 5;

// Snooze durations offered in the bar's command menu.
const SNOOZE_TEN_MINUTES_MS = 10 * 60 * 1000;
const SNOOZE_ONE_HOUR_MS = 60 * 60 * 1000;

// Bars start at zero so the View's `animationTime`-driven shimmer carries
// the visual until the first sample lands from the analyser (~100ms).
const ZERO_LEVELS = Object.freeze(Array(12).fill(0));

const PANEL_POSITION_STORAGE_KEY = "dictationPanelPosition";

function readStoredPanelPosition() {
  try {
    const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredPanelPosition(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return;
  }
  try {
    localStorage.setItem(
      PANEL_POSITION_STORAGE_KEY,
      JSON.stringify({ x: bounds.x, y: bounds.y })
    );
  } catch {
    // Quota exceeded or storage disabled — position simply won't persist.
  }
}

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const wrapperRef = useRef(null);
  const { toast, dismiss, toastCount } = useToast();
  const { t } = useTranslation();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();

  const dragStartPosRef = useRef(null);
  const hasDraggedRef = useRef(false);

  const [animationTime, setAnimationTime] = useState(0);

  // A ref carries the latest sample (written ~10Hz by AudioManager) so that
  // write alone doesn't re-render; the rAF loop copies it into state.
  const levelsRef = useRef(ZERO_LEVELS);
  const [levels, setLevels] = useState(ZERO_LEVELS);
  const handleLevels = React.useCallback((next) => {
    levelsRef.current = next;
  }, []);

  // Floating icon auto-hide setting (read from store, synced via IPC).
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);

  // Dictation-bar snooze ("Hide for 10 min / 1 hour / until I turn it back on").
  // Owned by the main process (timer + persistence); the renderer only mirrors
  // the active flag and folds it into the auto-hide behaviour below.
  const [dictationSnoozed, setDictationSnoozed] = useState(false);

  // The bar hides while idle if EITHER the user's auto-hide preference is on or
  // a snooze is active. Recording always shows it (see effect below).
  const shouldAutoHide = floatingIconAutoHide || dictationSnoozed;
  const prevAutoHideRef = useRef(shouldAutoHide);

  // Initialize vault path for Calyx integration (tags/projects autocomplete)
  const vaultPath = useSettingsStore((s) => s.vaultPath);
  useEffect(() => {
    if (vaultPath) {
      window.electronAPI?.setVaultPath?.(vaultPath);
    }
  }, [vaultPath]);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: t("app.toasts.hotkeyChanged.title"),
        description: t("app.toasts.hotkeyChanged.description", {
          original: data.original,
          fallback: data.fallback,
        }),
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: t("app.toasts.hotkeyUnavailable.title"),
        description: t("app.toasts.hotkeyUnavailable.description"),
        duration: 10000,
      });
    });

    const unsubscribeCorrections = window.electronAPI?.onCorrectionsLearned?.((words) => {
      if (words && words.length > 0) {
        const wordList = words.map((w) => `“${w}”`).join(", ");
        let toastId;
        toastId = toast({
          title: t("app.toasts.addedToDict", { words: wordList }),
          variant: "success",
          duration: 6000,
          action: (
            <button
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.undoLearnedCorrections?.(words);
                  if (result?.success) {
                    dismiss(toastId);
                  }
                } catch {
                  // silently fail — word stays in dictionary
                }
              }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-sm whitespace-nowrap
                text-emerald-100/90 hover:text-white
                bg-emerald-500/15 hover:bg-emerald-500/25
                border border-emerald-400/20 hover:border-emerald-400/35
                transition-all duration-150"
            >
              {t("app.toasts.undo")}
            </button>
          ),
        });
      }
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeCorrections?.();
    };
  }, [toast, dismiss, t]);

  useEffect(() => {
    if (isCommandMenuOpen || toastCount > 0) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, toastCount, setWindowInteractivity]);

  // Resize the Electron window so it can host the bar (BAR), the command menu
  // (WITH_MENU), toasts (WITH_TOAST), or both (EXPANDED). Default state is
  // BAR — large enough for the recording pill plus drop shadow, with a 44px
  // accessible hit area for the idle bar.
  useEffect(() => {
    const resizeWindow = () => {
      if (isCommandMenuOpen && toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("EXPANDED");
      } else if (isCommandMenuOpen) {
        window.electronAPI?.resizeMainWindow?.("WITH_MENU");
      } else if (toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
      } else {
        window.electronAPI?.resizeMainWindow?.("BAR");
      }
    };
    resizeWindow();
  }, [isCommandMenuOpen, toastCount]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const { isRecording, isProcessing, toggleListening, cancelRecording, cancelProcessing } =
    useAudioRecording(toast, {
      onToggle: handleDictationToggle,
      onLevels: handleLevels,
    });

  // Sync auto-hide from main process — setState directly to avoid IPC echo
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onFloatingIconAutoHideChanged?.((enabled) => {
      localStorage.setItem("floatingIconAutoHide", String(enabled));
      useSettingsStore.setState({ floatingIconAutoHide: enabled });
    });
    return () => unsubscribe?.();
  }, []);

  // Sync snooze state from main process: fetch the current value on mount
  // (covers a snooze restored from a previous session) and subscribe to changes.
  useEffect(() => {
    let active = true;
    window.electronAPI?.getDictationSnooze?.().then((state) => {
      if (active) setDictationSnoozed(Boolean(state?.active));
    });
    const unsubscribe = window.electronAPI?.onDictationSnoozeChanged?.((state) => {
      setDictationSnoozed(Boolean(state?.active));
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const isRecordingRef = useRef(isRecording);
  const isProcessingRef = useRef(isProcessing);

  useLayoutEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useLayoutEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
      // State-aware like the in-window Escape handler below: while recording
      // cancel the take; while transcribing cancel the processing pipeline.
      if (isRecordingRef.current) cancelRecording();
      else if (isProcessingRef.current) cancelProcessing();
    });
    return () => unsubscribe?.();
  }, [cancelRecording, cancelProcessing]);

  // Auto-hide the floating bar when idle — driven by the auto-hide preference
  // OR an active snooze. Recording/processing always keeps it visible, so the
  // hotkey still works while snoozed (the bar appears only during a take).
  useEffect(() => {
    let hideTimeout;

    if (shouldAutoHide && !isRecording && !isProcessing && toastCount === 0) {
      // Delay briefly so processing can start after recording stops without a flash
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, 500);
    } else if (!shouldAutoHide && prevAutoHideRef.current) {
      // Auto-hide just turned off (preference cleared or snooze ended) — bring
      // the bar back.
      window.electronAPI?.showDictationPanel?.();
    }

    prevAutoHideRef.current = shouldAutoHide;
    return () => clearTimeout(hideTimeout);
  }, [isRecording, isProcessing, shouldAutoHide, toastCount]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  // Snooze the bar from the command menu. `mode` is a duration in ms or
  // "always"; the main process owns the timer, persistence, and re-show.
  const handleSnooze = (mode) => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
    window.electronAPI?.snoozeDictation?.(mode);
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key !== "Escape") return;
      if (isCommandMenuOpen) {
        setIsCommandMenuOpen(false);
      } else if (isRecording) {
        cancelRecording();
      } else if (isProcessing) {
        cancelProcessing();
      } else {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen, isRecording, isProcessing, cancelRecording, cancelProcessing]);

  // Dismiss the command menu when the panel loses focus (i.e. the user
  // clicked another app/window). Clicks landing outside the small overlay
  // window never reach our document-level mousedown handler — they hit the
  // click-through region or another app entirely — so `blur` is the only
  // reliable signal for "clicked away". Requires the panel to have been
  // focused on menu-open (see onWrapperContextMenu).
  useEffect(() => {
    if (!isCommandMenuOpen) return;
    const handleBlur = () => setIsCommandMenuOpen(false);
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [isCommandMenuOpen]);

  // Restore the user's last-dragged panel position on mount. Mid-drag
  // updates are not persisted — we only save on mouseup (see
  // onWrapperMouseUp). If no stored position exists, the main process's
  // default bottom-center anchor is used.
  useEffect(() => {
    const stored = readStoredPanelPosition();
    if (stored) {
      window.electronAPI?.setMainWindowPosition?.(stored);
    }
  }, []);

  const barState = isRecording ? "recording" : isProcessing ? "transcribing" : "idle";

  // Surface the slow-transcription affordance (message + cancel button in
  // the View) once transcribing has dragged on past the shared threshold;
  // reset whenever the bar leaves the transcribing state.
  const [showSlowMessage, setShowSlowMessage] = useState(false);
  useEffect(() => {
    if (barState !== "transcribing") {
      setShowSlowMessage(false);
      return;
    }
    const slowTimer = setTimeout(() => setShowSlowMessage(true), SLOW_TRANSCRIPTION_THRESHOLD_MS);
    return () => clearTimeout(slowTimer);
  }, [barState]);

  // Drive animationTime + level republishing only while the bar is visible
  // as recording/transcribing. The idle bar uses neither, so running the
  // loop there would re-render the overlay 60fps for nothing. The ref is
  // updated by AudioManager at ~10Hz; copying it each frame lets the bars
  // decay smoothly between samples.
  useEffect(() => {
    if (barState === "idle") return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      setAnimationTime((now - start) / 1000);
      setLevels(levelsRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [barState]);

  const guardClick = React.useCallback((fn) => {
    return () => {
      if (hasDraggedRef.current) return;
      setIsCommandMenuOpen(false);
      fn();
    };
  }, []);

  // Idle-click-to-start and recording's Stop both just toggle listening.
  const handleToggle = useMemo(
    () => guardClick(() => toggleListening()),
    [guardClick, toggleListening]
  );
  const handleCancel = useMemo(
    () =>
      guardClick(() => {
        if (isRecordingRef.current) cancelRecording();
        else cancelProcessing();
      }),
    [guardClick, cancelRecording, cancelProcessing]
  );

  const onWrapperMouseDown = (e) => {
    // Clicks inside the command menu are UI interactions, not drag handles.
    // Starting a window drag here races the menu-close resize and yanks the
    // window up by the menu height (bug: widget climbs on "Hide for now").
    if (commandMenuRef.current?.contains(e.target)) return;
    setIsCommandMenuOpen(false);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;
    handleMouseDown(e);
  };

  const onWrapperMouseMove = (e) => {
    const start = dragStartPosRef.current;
    if (start && !hasDraggedRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD_PX) {
        hasDraggedRef.current = true;
      }
    }
  };

  const onWrapperMouseUp = (e) => {
    handleMouseUp(e);
    dragStartPosRef.current = null;
    // Persist the new position only if the user actually moved the window.
    // Otherwise we'd overwrite the stored bounds on every plain click.
    if (hasDraggedRef.current) {
      window.electronAPI?.getMainWindowBounds?.().then(writeStoredPanelPosition);
    }
    // Leave hasDraggedRef true until the next mousedown so click handlers
    // (which fire after mouseup) can still see it and suppress their action.
  };

  const onWrapperContextMenu = (e) => {
    e.preventDefault();
    if (hasDraggedRef.current) return;
    setWindowInteractivity(true);
    const opening = !isCommandMenuOpen;
    setIsCommandMenuOpen(opening);
    // Focus the panel when opening so Escape works and so clicking away
    // emits a window `blur` we use to dismiss the menu — the panel is
    // otherwise a non-activating overlay (showInactive).
    if (opening) window.electronAPI?.focusMainWindow?.();
  };

  return (
    <div className="dictation-window">
      {/* Wrapper is a plain container — TranscriptionBarView positions itself
          via its own `position: fixed; bottom: 12px` CSS, so we just need an
          element here to attach drag/menu handlers to. Events bubble up from
          the bar (a descendant) reliably. */}
      <div
        ref={wrapperRef}
        title={barState === "idle" ? formatHotkeyLabel(hotkey) : undefined}
        onMouseEnter={() => {
          setIsHovered(true);
          setWindowInteractivity(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!isCommandMenuOpen) {
            setWindowInteractivity(false);
          }
        }}
        onMouseDown={onWrapperMouseDown}
        onMouseMove={onWrapperMouseMove}
        onMouseUp={onWrapperMouseUp}
        onContextMenu={onWrapperContextMenu}
        style={{
          cursor: isProcessing
            ? "not-allowed"
            : isDragging
              ? "grabbing"
              : "default",
        }}
      >
        <TranscriptionBarView
          state={barState}
          levels={levels}
          animationTime={animationTime}
          errorMessage={null}
          showSlowMessage={showSlowMessage}
          onStartRecording={handleToggle}
          onStop={handleToggle}
          onCancel={handleCancel}
        />

        {isCommandMenuOpen && (
          <div
            ref={commandMenuRef}
            // Bar lives at `bottom: 12px` with max height 44px (idle hit
            // area). Place the menu just above that with an 8px gap.
            className="fixed bottom-[64px] left-1/2 -translate-x-1/2 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-sm"
            onMouseEnter={() => {
              setWindowInteractivity(true);
            }}
            onMouseLeave={() => {
              if (!isHovered) {
                setWindowInteractivity(false);
              }
            }}
          >
            <button
              className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => {
                toggleListening();
              }}
            >
              {isRecording
                ? t("app.commandMenu.stopListening")
                : t("app.commandMenu.startListening")}
            </button>
            <div className="h-px bg-border" />
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => handleSnooze(SNOOZE_TEN_MINUTES_MS)}
            >
              {t("app.commandMenu.hideTenMinutes")}
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => handleSnooze(SNOOZE_ONE_HOUR_MS)}
            >
              {t("app.commandMenu.hideOneHour")}
            </button>
            <button
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={() => handleSnooze("always")}
            >
              {t("app.commandMenu.hideAlways")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
