import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Key, Cpu, Network, FolderOpen, Check, X, RotateCcw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { InferenceModeSelector, SettingsRow, SettingsPanel } from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { ThreeOptionDialog } from "../ui/dialog";
import { useToast } from "../ui/useToast";
import TranscriptionModelPicker from "../TranscriptionModelPicker";
import SelfHostedPanel from "../SelfHostedPanel";
import type { InferenceMode, FolderItem } from "../../types/electron";

export function MeetingSpeakerDetectionRow() {
  const { t } = useTranslation();
  const speakerDiarizationEnabled = useSettingsStore((s) => s.speakerDiarizationEnabled);
  const setSpeakerDiarizationEnabled = useSettingsStore((s) => s.setSpeakerDiarizationEnabled);

  return (
    <SettingsRow
      label={t("settings.meeting.speakerDetection.title")}
      description={t("settings.meeting.speakerDetection.description")}
    >
      <Toggle checked={speakerDiarizationEnabled} onChange={setSpeakerDiarizationEnabled} />
    </SettingsRow>
  );
}

export function VaultPathRow() {
  const { t } = useTranslation();
  const vaultPath = useSettingsStore((s) => s.vaultPath);
  const setVaultPath = useSettingsStore((s) => s.setVaultPath);
  const [localPath, setLocalPath] = useState(vaultPath || "");
  const [status, setStatus] = useState<"idle" | "valid" | "invalid">("idle");

  const handleBrowse = useCallback(async () => {
    const result = await window.electronAPI?.showOpenDialog?.({
      properties: ["openDirectory"],
      title: t("settings.meeting.vaultPath.browseTitle", "Select Calyx Vault"),
    });
    if (result?.filePaths?.[0]) {
      const path = result.filePaths[0];
      setLocalPath(path);
      validateAndSave(path);
    }
  }, [t]);

  const validateAndSave = useCallback(async (path: string) => {
    if (!path.trim()) {
      setVaultPath("");
      await window.electronAPI?.setVaultPath?.(null);
      setStatus("idle");
      return;
    }

    const result = await window.electronAPI?.setVaultPath?.(path);
    if (result?.valid) {
      setVaultPath(path);
      setStatus("valid");
    } else {
      setStatus("invalid");
    }
  }, [setVaultPath]);

  const handlePathChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalPath(e.target.value);
    setStatus("idle");
  }, []);

  const handleBlur = useCallback(() => {
    if (localPath !== vaultPath) {
      validateAndSave(localPath);
    }
  }, [localPath, vaultPath, validateAndSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      validateAndSave(localPath);
    }
  }, [localPath, validateAndSave]);

  return (
    <SettingsRow
      label={t("settings.meeting.vaultPath.title", "Calyx Vault")}
      description={t("settings.meeting.vaultPath.description", "Path to your Calyx vault for tags and projects autocomplete in meeting notes.")}
    >
      <div className="flex items-center gap-2 w-full max-w-sm">
        <div className="relative flex-1">
          <Input
            value={localPath}
            onChange={handlePathChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={t("settings.meeting.vaultPath.placeholder", "/path/to/vault")}
            className="h-8 text-xs pr-7"
          />
          {status === "valid" && (
            <Check size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500" />
          )}
          {status === "invalid" && (
            <X size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-destructive" />
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleBrowse}
          className="h-8 px-2 shrink-0"
        >
          <FolderOpen size={14} />
        </Button>
      </div>
      {status === "invalid" && (
        <p className="text-xs text-destructive mt-1">
          {t("settings.meeting.vaultPath.invalid", "Not a valid Calyx vault (no .chiron/properties-index.json)")}
        </p>
      )}
    </SettingsRow>
  );
}

export function MeetingDefaultFolderRow() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [defaultFolderId, setDefaultFolderId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI?.getFolders?.() ?? Promise.resolve([]),
      window.electronAPI?.getDefaultMeetingFolder?.() ?? Promise.resolve(null),
    ]).then(([items, current]) => {
      if (cancelled) return;
      setFolders(items ?? []);
      setDefaultFolderId(current ?? null);
    });
    // Stay in sync when the default is changed elsewhere (e.g. the folder
    // context menu in the notes view).
    const unsubscribe = window.electronAPI?.onMeetingDefaultFolderChanged?.((payload) => {
      setDefaultFolderId(payload?.folderId ?? null);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value ? Number(e.target.value) : null;
    try {
      const result = await window.electronAPI?.setDefaultMeetingFolder?.(next);
      if (result?.success) setDefaultFolderId(result.folderId ?? next);
    } catch {
      // Swallow — local state is unchanged on failure, so the dropdown
      // simply keeps showing the previous selection.
    }
  }, []);

  return (
    <SettingsRow
      label={t("settings.meeting.defaultFolder.title", "Default meeting folder")}
      description={t(
        "settings.meeting.defaultFolder.description",
        "Where auto-detected meetings are filed. You can also set this from the folder menu in Notes."
      )}
    >
      <select
        value={defaultFolderId ?? ""}
        onChange={handleChange}
        className="h-8 text-xs rounded-md border border-border/70 bg-input px-2 dark:bg-surface-1 dark:border-border-subtle/50 focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary max-w-sm"
      >
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </SettingsRow>
  );
}

// Per-folder on-disk locations for the markdown mirror. Each folder can point
// at its own directory; blank = the default (<notes base>/<folder name>).
export function FolderLocationsPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const noteFilesEnabled = useSettingsStore((s) => s.noteFilesEnabled);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [localPaths, setLocalPaths] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<{
    id: number;
    name: string;
    path: string | null;
    count: number;
  } | null>(null);

  const load = useCallback(async () => {
    const [items, noteCounts] = await Promise.all([
      window.electronAPI?.getFolders?.() ?? Promise.resolve([]),
      window.electronAPI?.getFolderNoteCounts?.() ?? Promise.resolve([]),
    ]);
    const list = items ?? [];
    setFolders(list);
    setLocalPaths(Object.fromEntries(list.map((f) => [f.id, f.path || ""])));
    const cm: Record<number, number> = {};
    (noteCounts ?? []).forEach((c) => {
      cm[c.folder_id] = c.count;
    });
    setCounts(cm);
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = window.electronAPI?.onFolderPathChanged?.(() => load());
    return () => unsubscribe?.();
  }, [load]);

  const save = useCallback(
    async (id: number, folderPath: string | null, moveExisting: boolean) => {
      const res = await window.electronAPI?.setFolderPath?.(id, folderPath, moveExisting);
      if (res?.success) {
        if (moveExisting && res.moved) {
          toast({
            title: t("settings.folders.moved", { count: res.moved, defaultValue: "Moved {{count}} note(s)" }),
            variant: "success",
          });
        }
        await load();
      } else {
        toast({
          title: t("settings.folders.saveFailed", "Couldn't update folder location"),
          description: res?.error,
          variant: "destructive",
        });
      }
    },
    [load, toast, t]
  );

  // Commit a path edit: prompt about existing files when the folder has notes,
  // otherwise save straight away.
  const commit = useCallback(
    (folder: FolderItem, rawPath: string) => {
      const normalized = rawPath.trim() ? rawPath.trim() : null;
      if ((folder.path || null) === normalized) return; // unchanged
      const count = counts[folder.id] || 0;
      if (count > 0) {
        setPending({ id: folder.id, name: folder.name, path: normalized, count });
      } else {
        save(folder.id, normalized, false);
      }
    },
    [counts, save]
  );

  const handleBrowse = useCallback(
    async (folder: FolderItem) => {
      const result = await window.electronAPI?.showOpenDialog?.({
        properties: ["openDirectory"],
        title: t("settings.folders.browseTitle", "Choose a folder location"),
      });
      const picked = result?.filePaths?.[0];
      if (picked) {
        setLocalPaths((p) => ({ ...p, [folder.id]: picked }));
        commit(folder, picked);
      }
    },
    [commit, t]
  );

  const revertLocal = useCallback(
    (id: number) => {
      setLocalPaths((p) => ({ ...p, [id]: folders.find((f) => f.id === id)?.path || "" }));
    },
    [folders]
  );

  return (
    <div className="space-y-2">
      <SettingsRow
        label={t("settings.folders.title", "Folder locations")}
        description={t(
          "settings.folders.description",
          "Choose where each folder's notes are saved on disk. Blank uses the default notes location. Applies when “Save notes as files” is on."
        )}
      >
        {!noteFilesEnabled && (
          <span className="text-xs text-muted-foreground/70">
            {t("settings.folders.mirrorOff", "Enable “Save notes as files” to use these.")}
          </span>
        )}
      </SettingsRow>

      <SettingsPanel className="divide-y-0">
        {folders.map((folder) => {
          const value = localPaths[folder.id] ?? "";
          return (
            <div key={folder.id} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">
                  {folder.name}
                </span>
                <div className="flex items-center gap-1.5 w-full max-w-sm">
                  <Input
                    value={value}
                    onChange={(e) => setLocalPaths((p) => ({ ...p, [folder.id]: e.target.value }))}
                    onBlur={() => commit(folder, value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(folder, value);
                    }}
                    placeholder={t("settings.folders.placeholder", "Default location")}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBrowse(folder)}
                    className="h-8 px-2 shrink-0"
                    title={t("settings.folders.browse", "Browse")}
                  >
                    <FolderOpen size={14} />
                  </Button>
                  {folder.path && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setLocalPaths((p) => ({ ...p, [folder.id]: "" }));
                        commit(folder, "");
                      }}
                      className="h-8 px-2 shrink-0"
                      title={t("settings.folders.reset", "Reset to default")}
                    >
                      <RotateCcw size={14} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </SettingsPanel>

      <ThreeOptionDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("settings.folders.moveTitle", "Move existing notes?")}
        description={
          pending
            ? t("settings.folders.moveDescription", {
                name: pending.name,
                count: pending.count,
                defaultValue:
                  '“{{name}}” already has {{count}} note(s) on disk. Move them to the new location, or leave them where they are?',
              })
            : ""
        }
        primaryText={t("settings.folders.move", "Move them")}
        secondaryText={t("settings.folders.leave", "Leave them")}
        onPrimary={() => {
          if (pending) save(pending.id, pending.path, true);
        }}
        onSecondary={() => {
          if (pending) save(pending.id, pending.path, false);
        }}
        onCancel={() => {
          if (pending) revertLocal(pending.id);
        }}
      />
    </div>
  );
}

const noop = () => {};

function useStartOnboarding() {
  return useCallback(() => {
    localStorage.setItem("pendingCloudMigration", "true");
    localStorage.setItem("onboardingCurrentStep", "0");
    localStorage.removeItem("onboardingCompleted");
    window.location.reload();
  }, []);
}

export function MeetingTranscriptionPanel() {
  const { t } = useTranslation();
  const startOnboarding = useStartOnboarding();

  const {
    isSignedIn,
    meetingTranscriptionMode,
    setMeetingTranscriptionMode,
    setMeetingUseLocalWhisper,
    meetingWhisperModel,
    setMeetingWhisperModel,
    meetingLocalTranscriptionProvider,
    setMeetingLocalTranscriptionProvider,
    meetingParakeetModel,
    setMeetingParakeetModel,
    meetingCloudTranscriptionProvider,
    setMeetingCloudTranscriptionProvider,
    meetingCloudTranscriptionModel,
    setMeetingCloudTranscriptionModel,
    meetingCloudTranscriptionBaseUrl,
    setMeetingCloudTranscriptionBaseUrl,
    setMeetingCloudTranscriptionMode,
    meetingRemoteTranscriptionUrl,
    setMeetingRemoteTranscriptionUrl,
  } = useSettingsStore();

  const transcriptionModes: InferenceModeOption[] = [
    {
      id: "openwhispr",
      label: t("settingsPage.transcription.modes.openwhispr"),
      description: t("settingsPage.transcription.modes.openwhisprDesc"),
      icon: <Cloud className="w-4 h-4" />,
      disabled: !isSignedIn,
      badge: !isSignedIn ? t("common.freeAccountRequired") : undefined,
    },
    {
      id: "providers",
      label: t("settingsPage.transcription.modes.providers"),
      description: t("settingsPage.transcription.modes.providersDesc"),
      icon: <Key className="w-4 h-4" />,
    },
    {
      id: "local",
      label: t("settingsPage.transcription.modes.local"),
      description: t("settingsPage.transcription.modes.localDesc"),
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "self-hosted",
      label: t("settingsPage.transcription.modes.selfHosted"),
      description: t("settingsPage.transcription.modes.selfHostedDesc"),
      icon: <Network className="w-4 h-4" />,
    },
  ];

  const handleTranscriptionModeSelect = (mode: InferenceMode) => {
    if (mode === "openwhispr" && !isSignedIn) {
      startOnboarding();
      return;
    }
    if (mode === meetingTranscriptionMode) return;
    setMeetingTranscriptionMode(mode);
    setMeetingUseLocalWhisper(mode === "local");
    setMeetingCloudTranscriptionMode(mode === "openwhispr" ? "openwhispr" : "byok");
  };

  const handleLocalTranscriptionModelSelect = useCallback(
    (modelId: string) => {
      if (meetingLocalTranscriptionProvider === "nvidia") {
        setMeetingParakeetModel(modelId);
      } else {
        setMeetingWhisperModel(modelId);
      }
    },
    [meetingLocalTranscriptionProvider, setMeetingParakeetModel, setMeetingWhisperModel]
  );

  const renderTranscriptionPicker = (mode: "cloud" | "local") => (
    <TranscriptionModelPicker
      streamingOnly
      selectedCloudProvider={meetingCloudTranscriptionProvider}
      onCloudProviderSelect={setMeetingCloudTranscriptionProvider}
      selectedCloudModel={meetingCloudTranscriptionModel}
      onCloudModelSelect={setMeetingCloudTranscriptionModel}
      selectedLocalModel={
        meetingLocalTranscriptionProvider === "nvidia" ? meetingParakeetModel : meetingWhisperModel
      }
      onLocalModelSelect={handleLocalTranscriptionModelSelect}
      selectedLocalProvider={meetingLocalTranscriptionProvider}
      onLocalProviderSelect={setMeetingLocalTranscriptionProvider}
      useLocalWhisper={mode === "local"}
      onModeChange={noop}
      mode={mode}
      cloudTranscriptionBaseUrl={meetingCloudTranscriptionBaseUrl}
      setCloudTranscriptionBaseUrl={setMeetingCloudTranscriptionBaseUrl}
      variant="settings"
    />
  );

  return (
    <div className="space-y-3">
      <InferenceModeSelector
        modes={transcriptionModes}
        activeMode={meetingTranscriptionMode}
        onSelect={handleTranscriptionModeSelect}
      />

      {meetingTranscriptionMode === "providers" && renderTranscriptionPicker("cloud")}
      {meetingTranscriptionMode === "local" && renderTranscriptionPicker("local")}
      {meetingTranscriptionMode === "self-hosted" && (
        <>
          <SelfHostedPanel
            service="transcription"
            url={meetingRemoteTranscriptionUrl}
            onUrlChange={setMeetingRemoteTranscriptionUrl}
          />
          <p className="text-xs text-muted-foreground/80 px-1">
            {t("settingsPage.speechToText.selfHostedStreamingNote")}
          </p>
        </>
      )}
      <MeetingSpeakerDetectionRow />
    </div>
  );
}
