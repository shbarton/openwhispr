import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  Key,
  Cpu,
  Network,
  FolderOpen,
  Check,
  X,
  RotateCcw,
  Plus,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { InferenceModeSelector, SettingsRow, SettingsPanel } from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { ThreeOptionDialog, ConfirmDialog } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
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
  const [newFolderName, setNewFolderName] = useState("");
  // True while a Move/Leave choice is in flight, so dialog dismissal (Escape/
  // overlay/Cancel) knows whether to revert the edited path field.
  const moveActionRef = useRef(false);
  const [localNames, setLocalNames] = useState<Record<number, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{
    id: number;
    name: string;
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
    setLocalNames(Object.fromEntries(list.map((f) => [f.id, f.name])));
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

  // Create a folder directly from here (same pipeline as the Notes view). The
  // new folder appears in the list below, where its path can then be set.
  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const res = await window.electronAPI?.createFolder?.(name);
    if (res?.success) {
      setNewFolderName("");
      await load();
    } else {
      toast({
        title: res?.error ?? t("settings.folders.createFailed", "Couldn't create folder"),
        variant: "destructive",
      });
    }
  }, [newFolderName, load, toast, t]);

  const handleRename = useCallback(
    async (folder: FolderItem, rawName: string) => {
      const name = rawName.trim();
      if (!name || name === folder.name) {
        setLocalNames((p) => ({ ...p, [folder.id]: folder.name })); // revert blanks
        return;
      }
      const res = await window.electronAPI?.renameFolder?.(folder.id, name);
      if (res?.success) {
        await load();
      } else {
        setLocalNames((p) => ({ ...p, [folder.id]: folder.name }));
        toast({
          title: res?.error ?? t("settings.folders.renameFailed", "Couldn't rename folder"),
          variant: "destructive",
        });
      }
    },
    [load, toast, t]
  );

  const handleDelete = useCallback(
    async (id: number, deleteFiles: boolean) => {
      const res = await window.electronAPI?.deleteFolder?.(id, deleteFiles);
      if (res?.success) {
        await load();
      } else {
        toast({
          title: res?.error ?? t("settings.folders.deleteFailed", "Couldn't delete folder"),
          variant: "destructive",
        });
      }
    },
    [load, toast, t]
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
                {folder.is_default ? (
                  <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">
                    {folder.name}
                  </span>
                ) : (
                  <Input
                    value={localNames[folder.id] ?? folder.name}
                    onChange={(e) =>
                      setLocalNames((p) => ({ ...p, [folder.id]: e.target.value }))
                    }
                    onBlur={() => handleRename(folder, localNames[folder.id] ?? "")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape")
                        setLocalNames((p) => ({ ...p, [folder.id]: folder.name }));
                    }}
                    aria-label={t("settings.folders.nameLabel", "Folder name")}
                    title={t("settings.folders.nameHint", "Click to rename")}
                    className="h-8 text-xs font-medium min-w-0 flex-1 border-transparent bg-transparent px-2 shadow-none"
                  />
                )}
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
                  {(folder.path || !folder.is_default) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 shrink-0 text-muted-foreground/60 hover:text-foreground data-[state=open]:text-foreground"
                          title={t("settings.folders.more", "More")}
                        >
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4} className="min-w-40">
                        {folder.path && (
                          <DropdownMenuItem
                            onClick={() => {
                              setLocalPaths((p) => ({ ...p, [folder.id]: "" }));
                              commit(folder, "");
                            }}
                            className="text-xs gap-2 rounded-md px-2 py-1"
                          >
                            <RotateCcw size={12} className="text-muted-foreground/60" />
                            {t("settings.folders.reset", "Reset to default")}
                          </DropdownMenuItem>
                        )}
                        {!folder.is_default && (
                          <>
                            {folder.path && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirmDelete({
                                  id: folder.id,
                                  name: folder.name,
                                  count: counts[folder.id] || 0,
                                })
                              }
                              className="text-xs gap-2 rounded-md px-2 py-1 text-destructive focus:text-destructive"
                            >
                              <Trash2 size={12} />
                              {t("settings.folders.delete", "Delete folder")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="px-3 py-2.5 border-t border-border/30 dark:border-border-subtle/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground min-w-0 flex-1 truncate">
              {t("settings.folders.addLabel", "New folder")}
            </span>
            <div className="flex items-center gap-1.5 w-full max-w-sm">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                }}
                placeholder={t("settings.folders.addPlaceholder", "New folder name")}
                className="h-8 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="h-8 px-2 shrink-0"
                title={t("settings.folders.add", "Add folder")}
              >
                <Plus size={14} />
              </Button>
            </div>
          </div>
        </div>
      </SettingsPanel>

      <ThreeOptionDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            // Dismissed via Escape/overlay/Cancel without choosing Move or
            // Leave — revert the edited path field to the saved value.
            if (!moveActionRef.current && pending) revertLocal(pending.id);
            moveActionRef.current = false;
            setPending(null);
          }
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
          moveActionRef.current = true;
          if (pending) save(pending.id, pending.path, true);
        }}
        onSecondary={() => {
          moveActionRef.current = true;
          if (pending) save(pending.id, pending.path, false);
        }}
      />

      {/* Empty folder — nothing on disk, so a plain confirm. */}
      <ConfirmDialog
        open={confirmDelete !== null && confirmDelete.count === 0}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={t("settings.folders.deleteTitle", "Delete folder?")}
        description={
          confirmDelete
            ? t("settings.folders.deleteDescriptionEmpty", {
                name: confirmDelete.name,
                defaultValue: 'Remove “{{name}}” from the app?',
              })
            : ""
        }
        confirmText={t("settings.folders.deleteConfirm", "Delete")}
        variant="destructive"
        onConfirm={() => {
          if (confirmDelete) handleDelete(confirmDelete.id, false);
        }}
      />

      {/* Folder with notes — always remove from the app, then choose whether the
          on-disk note files (which may live in the user's vault) are kept. */}
      <ThreeOptionDialog
        open={confirmDelete !== null && confirmDelete.count > 0}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={t("settings.folders.deleteTitle", "Delete folder?")}
        description={
          confirmDelete
            ? t("settings.folders.deleteFilesPrompt", {
                name: confirmDelete.name,
                count: confirmDelete.count,
                defaultValue:
                  'Remove “{{name}}” and its {{count}} note(s) from the app. Keep the note files on disk, or delete them too?',
              })
            : ""
        }
        primaryText={t("settings.folders.keepFiles", "Keep files")}
        secondaryText={t("settings.folders.deleteFiles", "Delete files too")}
        onPrimary={() => {
          if (confirmDelete) handleDelete(confirmDelete.id, false);
        }}
        onSecondary={() => {
          if (confirmDelete) handleDelete(confirmDelete.id, true);
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
