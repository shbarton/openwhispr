import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import type { AgentState } from "./types";

interface ChatInputProps {
  agentState: AgentState;
  partialTranscript: string;
  onTextSubmit?: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /**
   * Optional controlled-mode props. When `value` is defined the input is
   * fully controlled by the parent; `onValueChange` fires on every keystroke.
   * When `value` is undefined, the component manages its own state and
   * `onValueChange` (if provided) is still fired as a notification.
   */
  value?: string;
  onValueChange?: (text: string) => void;
  /**
   * Optional keydown hook fired BEFORE the component's own handler. Return
   * true from this to indicate you handled the event (the component will
   * skip its own logic). Used to wire up autocomplete keyboard navigation.
   */
  onKeyDownIntercept?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

function RecordingIndicator() {
  return (
    <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
      <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse" />
      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
    </div>
  );
}

function ProcessingIndicator() {
  return (
    <div className="flex items-center justify-center w-5 h-5 shrink-0">
      <div className="flex items-center gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-0.5 bg-accent rounded-full"
            style={{
              height: "8px",
              animation: `waveform-bar 0.6s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatInput({
  agentState,
  partialTranscript,
  onTextSubmit,
  onCancel,
  autoFocus = false,
  value,
  onValueChange,
  onKeyDownIntercept,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [internalText, setInternalText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isControlled = value !== undefined;
  const inputText = isControlled ? value! : internalText;

  const setInputText = useCallback(
    (next: string) => {
      if (!isControlled) {
        setInternalText(next);
      }
      onValueChange?.(next);
    },
    [isControlled, onValueChange]
  );

  const handleSubmit = useCallback(() => {
    const text = inputText.trim();
    if (!text || !onTextSubmit) return;
    onTextSubmit(text);
    setInputText("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputText, onTextSubmit, setInputText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onKeyDownIntercept && onKeyDownIntercept(e)) return;
      // Enter submits; Shift+Enter (or Cmd/Alt+Enter) inserts a newline.
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, onKeyDownIntercept]
  );

  const isIdle = agentState === "idle";
  const isListening = agentState === "listening";
  const isTranscribing = agentState === "transcribing";
  const isBusy =
    agentState === "thinking" || agentState === "streaming" || agentState === "tool-executing";

  useEffect(() => {
    if (isIdle) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isIdle]);

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div
        className={cn(
          // items-end keeps the send button anchored at the bottom of
          // the box as the textarea grows downward; min-h matches the
          // previous single-line height.
          "flex items-end gap-2 min-h-11 px-3 py-2 rounded-lg",
          "bg-surface-1 border border-border/30",
          "transition-colors duration-150",
          isIdle && "focus-within:border-primary/30"
        )}
      >
        {isListening && (
          <>
            <RecordingIndicator />
            <span className="text-[12px] text-foreground/80 truncate flex-1">
              {partialTranscript || t("agentMode.input.listening")}
            </span>
          </>
        )}

        {isTranscribing && (
          <>
            <ProcessingIndicator />
            <span className="text-[12px] text-muted-foreground select-none">
              {t("agentMode.input.transcribing")}
            </span>
          </>
        )}

        {(isIdle || isBusy) && (
          <div className="flex items-end gap-2 w-full">
            <textarea
              ref={inputRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
              autoFocus={autoFocus}
              placeholder={t("agentMode.input.typeMessage")}
              // field-sizing: content auto-grows the textarea to fit its
              // content (Chromium 123+, Electron 41 supports it). The
              // max-h cap (~6 lines) keeps it from eating the viewport.
              style={{ fieldSizing: "content" } as React.CSSProperties}
              className={cn(
                "input-inline flex-1 outline-none bg-transparent resize-none",
                "text-[13px] text-foreground placeholder:text-muted-foreground/40",
                "min-w-0 p-0 leading-snug",
                "max-h-36 overflow-y-auto",
                isBusy && "text-muted-foreground/30 cursor-not-allowed"
              )}
            />
            {(() => {
              const baseBtn =
                "flex items-center justify-center w-7 h-7 rounded-full shrink-0 transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40";
              const activeFill =
                "bg-primary text-primary-foreground hover:bg-primary/85 active:scale-95";

              if (isBusy && onCancel) {
                return (
                  <button
                    onClick={onCancel}
                    aria-label={t("embeddedChat.stop", "Stop")}
                    className={cn(baseBtn, activeFill)}
                  >
                    <Square size={11} className="fill-current" />
                  </button>
                );
              }
              if (isIdle) {
                const hasText = inputText.trim().length > 0;
                return (
                  <button
                    onClick={handleSubmit}
                    disabled={!hasText}
                    aria-label={t("embeddedChat.send", "Send")}
                    className={cn(
                      baseBtn,
                      hasText
                        ? activeFill
                        : "bg-foreground/10 dark:bg-white/8 text-foreground/30 dark:text-foreground/25 cursor-default"
                    )}
                  >
                    <ArrowUp size={14} strokeWidth={2.5} />
                  </button>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
