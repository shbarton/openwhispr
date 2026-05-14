import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Key, Cpu, Network, FolderOpen, Check, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { InferenceModeSelector, SettingsRow } from "../ui/SettingsSection";
import type { InferenceModeOption } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import TranscriptionModelPicker from "../TranscriptionModelPicker";
import SelfHostedPanel from "../SelfHostedPanel";
import type { InferenceMode } from "../../types/electron";

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
      window.electronAPI?.setVaultPath?.(null);
      setStatus("idle");
      return;
    }

    // Check if .chiron/properties-index.json exists
    try {
      const indexPath = `${path}/.chiron/properties-index.json`;
      const exists = await window.electronAPI?.pathExists?.(indexPath);
      if (exists) {
        setVaultPath(path);
        await window.electronAPI?.setVaultPath?.(path);
        setStatus("valid");
      } else {
        setStatus("invalid");
      }
    } catch {
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
      <VaultPathRow />
    </div>
  );
}
