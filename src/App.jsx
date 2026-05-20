import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./index.css";
import { useToast } from "./components/ui/useToast";
import { useHotkey } from "./hooks/useHotkey";
import { formatHotkeyLabel } from "./utils/hotkeys";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useSettingsStore } from "./stores/settingsStore";
import { TranscriptionBarView } from "./components/notes/TranscriptionBarView";

// Drag threshold in px — below this, mousedown→mouseup is treated as a click
// and the bar action fires; above it, it's treated as a window drag and the
// click is suppressed.
const DRAG_THRESHOLD_PX = 5;

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

  const [dragStartPos, setDragStartPos] = useState(null);
  const hasDraggedRef = useRef(false);

  // Animation clock for the bar's synthetic shimmer / ripple animations.
  const [animationTime, setAnimationTime] = useState(0);

  // Mic levels sampled from the AudioManager's silence analyser at ~10Hz.
  // A ref carries the latest sample to avoid re-rendering the whole tree on
  // every tick; the rAF animation loop copies it into state so the bar
  // updates roughly with each frame.
  const levelsRef = useRef(ZERO_LEVELS);
  const [levels, setLevels] = useState(ZERO_LEVELS);
  const handleLevels = React.useCallback((next) => {
    levelsRef.current = next;
  }, []);

  // Floating icon auto-hide setting (read from store, synced via IPC).
  const floatingIconAutoHide = useSettingsStore((s) => s.floatingIconAutoHide);
  const prevAutoHideRef = useRef(floatingIconAutoHide);

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

  const isRecordingRef = useRef(isRecording);

  useLayoutEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCancelHotkeyPressed?.(() => {
      if (isRecordingRef.current) cancelRecording();
    });
    return () => unsubscribe?.();
  }, [cancelRecording]);

  // Auto-hide the floating icon when idle (setting enabled or dictation cycle completed)
  useEffect(() => {
    let hideTimeout;

    if (floatingIconAutoHide && !isRecording && !isProcessing && toastCount === 0) {
      // Delay briefly so processing can start after recording stops without a flash
      hideTimeout = setTimeout(() => {
        window.electronAPI?.hideWindow?.();
      }, 500);
    } else if (!floatingIconAutoHide && prevAutoHideRef.current) {
      window.electronAPI?.showDictationPanel?.();
    }

    prevAutoHideRef.current = floatingIconAutoHide;
    return () => clearTimeout(hideTimeout);
  }, [isRecording, isProcessing, floatingIconAutoHide, toastCount]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
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
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

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

  // Advance the animation clock and republish the latest mic levels at rAF
  // cadence. The View clamps to 30fps internally via CSS, so we don't need
  // to throttle here. The levels ref is updated by AudioManager at ~10Hz;
  // copying it into state on every frame lets the bars decay smoothly
  // between samples instead of stepping.
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      setAnimationTime((now - start) / 1000);
      setLevels(levelsRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Clear lingering mic data when we're not actively recording so the bar
  // falls back to its synthetic shimmer baseline.
  useEffect(() => {
    if (!isRecording) {
      levelsRef.current = ZERO_LEVELS;
      setLevels(ZERO_LEVELS);
    }
  }, [isRecording]);

  // Map useAudioRecording booleans → 3-state bar machine.
  const barState = isRecording ? "recording" : isProcessing ? "transcribing" : "idle";

  // Suppress click actions if the user just dragged the window. Mirrors the
  // 5px threshold the round-button design used.
  const guardClick = React.useCallback((fn) => {
    return () => {
      if (hasDraggedRef.current) return;
      setIsCommandMenuOpen(false);
      fn();
    };
  }, []);

  const handleStartRecording = useMemo(
    () => guardClick(() => toggleListening()),
    [guardClick, toggleListening]
  );
  const handleStop = useMemo(
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
    setIsCommandMenuOpen(false);
    setDragStartPos({ x: e.clientX, y: e.clientY });
    hasDraggedRef.current = false;
    handleMouseDown(e);
  };

  const onWrapperMouseMove = (e) => {
    if (dragStartPos && !hasDraggedRef.current) {
      const distance = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
      if (distance > DRAG_THRESHOLD_PX) {
        hasDraggedRef.current = true;
      }
    }
  };

  const onWrapperMouseUp = (e) => {
    handleMouseUp(e);
    setDragStartPos(null);
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
    if (!hasDraggedRef.current) {
      setWindowInteractivity(true);
      setIsCommandMenuOpen((prev) => {
        const next = !prev;
        // Focus the panel when opening so Escape works and so clicking
        // away emits a window `blur` we can use to dismiss the menu. The
        // panel is otherwise a non-activating overlay (showInactive).
        if (next) window.electronAPI?.focusMainWindow?.();
        return next;
      });
    }
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
          showSlowMessage={false}
          onStartRecording={handleStartRecording}
          onStop={handleStop}
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
              onClick={() => {
                setIsCommandMenuOpen(false);
                setWindowInteractivity(false);
                handleClose();
              }}
            >
              {t("app.commandMenu.hideForNow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
