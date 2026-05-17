import React, { useState } from "react";
import {
  Home,
  MessageSquare,
  NotebookPen,
  BookOpen,
  Upload,
  Blocks,
  Gift,
  Settings,
  HelpCircle,
  UserCircle,
  X,
  Search,
  Sparkles,
} from "lucide-react";
import logoIcon from "../assets/icon.png";
import calyxVoiceLogo from "../assets/calyxvoice-logo.png";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import SupportDropdown from "./ui/SupportDropdown";
import { getCachedPlatform } from "../utils/platform";

const platform = getCachedPlatform();

export type ControlPanelView =
  | "home"
  | "chat"
  | "personal-notes"
  | "post-meeting"
  | "dictionary"
  | "upload"
  | "integrations";

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenReferrals?: () => void;
  onUpgrade?: () => void;
  isOverLimit?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  isProUser?: boolean;
  usageLoaded?: boolean;
  updateAction?: React.ReactNode;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  onOpenReferrals,
  onUpgrade,
  isOverLimit,
  userName,
  userEmail,
  userImage,
  isSignedIn,
  authLoaded,
  isProUser,
  usageLoaded,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const [upgradeDismissed, setUpgradeDismissed] = useState(
    () => localStorage.getItem("upgradeProDismissed") === "true"
  );

  const showLimitBanner = authLoaded && isSignedIn && !isProUser && isOverLimit;
  const showUpgradeBanner =
    !showLimitBanner &&
    authLoaded &&
    (!isSignedIn || usageLoaded !== false) &&
    !isProUser &&
    !upgradeDismissed;

  const navItems: {
    id: ControlPanelView;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  }[] = [
    { id: "home", label: t("sidebar.home"), icon: Home },
    { id: "chat", label: t("sidebar.chat"), icon: MessageSquare },
    { id: "personal-notes", label: t("sidebar.notes"), icon: NotebookPen },
    {
      id: "post-meeting",
      label: t("sidebar.postMeeting", "Post Meeting"),
      icon: Sparkles,
    },
    { id: "upload", label: t("sidebar.upload"), icon: Upload },
    { id: "dictionary", label: t("sidebar.dictionary"), icon: BookOpen },
    { id: "integrations", label: t("sidebar.integrations"), icon: Blocks },
  ];

  return (
    <div className="w-48 h-full shrink-0 flex flex-col bg-surface-1 dark:bg-surface-1">
      <div
        className="w-full h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* CalyxVoice brand header */}
      <div className="flex items-center gap-2.5 px-3 pb-4 pt-1">
        <img
          src={calyxVoiceLogo}
          alt="CalyxVoice"
          className="w-7 h-7 rounded-md shrink-0 object-contain"
        />
        <span
          className="text-lg text-foreground whitespace-nowrap"
          style={{ fontFamily: "var(--font-family-display)" }}
        >
          CalyxVoice
        </span>
      </div>

      {onOpenSearch && (
        <div className="px-2 pb-2">
          <button
            onClick={onOpenSearch}
            className="group flex items-center w-full h-8 px-2.5 rounded-md bg-transparent hover:bg-surface-hover transition-colors duration-150 gap-2 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          >
            <Search size={14} strokeWidth={1.5} className="text-foreground-muted shrink-0" />
            <span className="flex-1 text-xs text-left text-foreground-muted">
              {t("commandSearch.shortPlaceholder")}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <kbd className="text-[10px] px-1 py-px rounded bg-surface-hover text-foreground-tertiary font-mono leading-tight">
                {platform === "darwin" ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="text-[10px] px-1 py-px rounded bg-surface-hover text-foreground-tertiary font-mono leading-tight">
                K
              </kbd>
            </div>
          </button>
        </div>
      )}

      <nav className="flex flex-col gap-0.5 px-2 pt-1 pb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "group relative flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md outline-none text-left",
                "transition-colors duration-150 motion-reduce:transition-none",
                "focus-visible:ring-1 focus-visible:ring-primary/40",
                isActive
                  ? "bg-surface-hover"
                  : "hover:bg-surface-hover"
              )}
            >
              <Icon
                size={16}
                strokeWidth={1.5}
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  isActive
                    ? "text-foreground"
                    : "text-foreground-muted group-hover:text-foreground"
                )}
              />
              <span
                className={cn(
                  "text-xs transition-colors duration-150",
                  isActive
                    ? "text-foreground font-medium"
                    : "text-foreground-muted group-hover:text-foreground"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {showLimitBanner && (
        <div className="px-2 pb-2">
          <div className="rounded-lg bg-destructive/8 dark:bg-destructive/12 p-3">
            <div className="flex flex-col items-center text-center">
              <p
                className="text-sm text-foreground mb-1"
                style={{ fontFamily: "var(--font-family-display)" }}
              >
                {t("sidebar.limitReached")}
              </p>
              <p className="text-[11px] leading-snug text-foreground-muted mb-3">
                {t("sidebar.limitReachedDescription")}
              </p>
              <button
                onClick={onUpgrade}
                className="w-full h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors duration-150"
              >
                {t("sidebar.viewPlans")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpgradeBanner && (
        <div className="px-2 pb-2">
          <div className="relative rounded-lg bg-accent-light p-3">
            <button
              onClick={() => {
                setUpgradeDismissed(true);
                localStorage.setItem("upgradeProDismissed", "true");
              }}
              aria-label={t("common.dismiss")}
              className="absolute top-2 right-2 p-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors duration-150"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
            <div className="flex flex-col items-center text-center pt-2">
              <p
                className="text-sm text-foreground mb-1"
                style={{ fontFamily: "var(--font-family-display)" }}
              >
                {t("sidebar.upgradeTitle")}
              </p>
              <p className="text-[11px] leading-snug text-foreground-muted mb-3">
                {t("sidebar.upgradeDescription")}
              </p>
              <button
                onClick={onUpgrade}
                className="w-full h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors duration-150"
              >
                {t("sidebar.learnMore")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-2 pb-2 space-y-0.5">
        {updateAction && (
          <div className="px-1 pb-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {updateAction}
          </div>
        )}

        {isSignedIn && onOpenReferrals && (
          <button
            onClick={onOpenReferrals}
            aria-label={t("sidebar.referral")}
            className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors duration-150 motion-reduce:transition-none"
          >
            <Gift
              size={16}
              strokeWidth={1.5}
              className="shrink-0 text-foreground-muted group-hover:text-foreground transition-colors duration-150"
            />
            <span className="text-xs text-foreground-muted group-hover:text-foreground transition-colors duration-150">
              {t("sidebar.referral")}
            </span>
          </button>
        )}

        <button
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors duration-150 motion-reduce:transition-none"
        >
          <Settings
            size={16}
            strokeWidth={1.5}
            className="shrink-0 text-foreground-muted group-hover:text-foreground transition-colors duration-150"
          />
          <span className="text-xs text-foreground-muted group-hover:text-foreground transition-colors duration-150">
            {t("sidebar.settings")}
          </span>
        </button>

        <SupportDropdown
          trigger={
            <button
              aria-label={t("sidebar.support")}
              className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors duration-150 motion-reduce:transition-none"
            >
              <HelpCircle
                size={16}
                strokeWidth={1.5}
                className="shrink-0 text-foreground-muted group-hover:text-foreground transition-colors duration-150"
              />
              <span className="text-xs text-foreground-muted group-hover:text-foreground transition-colors duration-150">
                {t("sidebar.support")}
              </span>
            </button>
          }
        />

        <div className="mx-1 h-px bg-border-subtle my-2" />

        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          {userImage ? (
            <img src={userImage} alt="" className="w-6 h-6 rounded-full shrink-0 object-cover" />
          ) : (
            <UserCircle size={18} strokeWidth={1.5} className="shrink-0 text-foreground-tertiary" />
          )}
          <div className="flex-1 min-w-0">
            {isSignedIn && (userName || userEmail) ? (
              <>
                <p className="text-xs text-foreground truncate leading-tight">
                  {userName || t("sidebar.defaultUser")}
                </p>
                {userEmail && (
                  <p className="text-xs text-foreground-tertiary truncate leading-tight">
                    {userEmail}
                  </p>
                )}
              </>
            ) : authLoaded && !isSignedIn ? (
              <p className="text-xs text-foreground-tertiary">
                {t("sidebar.notSignedIn")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
