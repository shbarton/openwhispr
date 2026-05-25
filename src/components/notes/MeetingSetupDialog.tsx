import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, Check, ChevronDown, Search, Users, Tag, Briefcase, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "../lib/utils";
import { useNotes } from "../../stores/noteStore";
import type { NoteItem, VaultMetadata, VaultProject, FolderItem } from "../../types/electron";
import type { CalendarAttendee } from "../../types/calendar";
import { getInitials, getInitialColor } from "../../utils/avatarUtils";

export interface MeetingMetadata {
  title: string;
  folderId: number | null;
  participants: CalendarAttendee[];
  project: string;
  tags: string[];
  description: string;
}

interface MeetingSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (metadata: MeetingMetadata) => void;
  existingNote?: NoteItem | null;
  initialFolderId?: number | null;
  folders?: FolderItem[];
}

export default function MeetingSetupDialog({
  open,
  onOpenChange,
  onConfirm,
  existingNote,
  initialFolderId,
  folders = [],
}: MeetingSetupDialogProps) {
  const { t } = useTranslation();
  const notes = useNotes();

  // Form state
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [project, setProject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [participants, setParticipants] = useState<CalendarAttendee[]>([]);
  const [description, setDescription] = useState("");

  // Folder picker popover
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderSearch, setFolderSearch] = useState("");

  // Vault metadata for autocomplete
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata>({
    tags: [],
    projects: [],
    updatedAt: null,
  });

  // Popover states
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [participantSearch, setParticipantSearch] = useState("");
  const [contactSuggestions, setContactSuggestions] = useState<
    Array<{ email: string; display_name: string | null }>
  >([]);

  // Load vault metadata
  useEffect(() => {
    if (!open) return;

    window.electronAPI.getVaultMetadata?.().then((metadata) => {
      if (metadata) setVaultMetadata(metadata);
    });

    const unsubscribe = window.electronAPI.onVaultMetadataChanged?.((metadata) => {
      setVaultMetadata(metadata);
    });

    return unsubscribe;
  }, [open]);

  // Initialize form when dialog opens
  useEffect(() => {
    if (!open) return;

    if (existingNote) {
      setTitle(existingNote.title || "");
      setFolderId(existingNote.folder_id ?? initialFolderId ?? folders[0]?.id ?? null);
      setProject(existingNote.project || "");
      setTags(
        existingNote.tags
          ? existingNote.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : []
      );
      setDescription(existingNote.description || "");
      try {
        const parsed = existingNote.participants
          ? JSON.parse(existingNote.participants)
          : [];
        setParticipants(Array.isArray(parsed) ? parsed : []);
      } catch {
        setParticipants([]);
      }
    } else {
      setTitle("");
      setFolderId(initialFolderId ?? folders[0]?.id ?? null);
      setProject("");
      setTags([]);
      setParticipants([]);
      setDescription("");
    }

    setProjectSearch("");
    setTagSearch("");
    setParticipantSearch("");
    setFolderSearch("");
  }, [open, existingNote, initialFolderId, folders]);

  // Compute merged project list (vault + local notes)
  const allProjects = useMemo(() => {
    const vaultTitles = vaultMetadata.projects
      .map((p) => (typeof p.title === "string" ? p.title : ""))
      .filter((t) => t.length > 0);
    const localProjects = [
      ...new Set(
        notes
          .map((n) => (typeof n.project === "string" ? n.project : ""))
          .filter((p) => p.length > 0)
      ),
    ];
    // Vault first (already sorted), then local-only
    const vaultSet = new Set(vaultTitles);
    const localOnly = localProjects.filter((p) => !vaultSet.has(p)).sort();
    return [...vaultTitles, ...localOnly];
  }, [vaultMetadata.projects, notes]);

  // Compute merged tag list (vault + local notes)
  const allTags = useMemo(() => {
    const localTags = new Set<string>();
    notes.forEach((n) => {
      if (n.tags) {
        n.tags.split(",").forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) localTags.add(trimmed);
        });
      }
    });
    // Vault tags already sorted by frequency, append local-only
    const vaultSet = new Set(vaultMetadata.tags);
    const localOnly = [...localTags].filter((t) => !vaultSet.has(t)).sort();
    return [...vaultMetadata.tags, ...localOnly];
  }, [vaultMetadata.tags, notes]);

  // Filter projects by search
  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return allProjects.slice(0, 10);
    const q = projectSearch.toLowerCase();
    return allProjects.filter((p) => p.toLowerCase().includes(q)).slice(0, 10);
  }, [allProjects, projectSearch]);

  // Filter tags by search (exclude already selected)
  const filteredTags = useMemo(() => {
    const available = allTags.filter((t) => !tags.includes(t));
    if (!tagSearch.trim()) return available.slice(0, 10);
    const q = tagSearch.toLowerCase();
    return available.filter((t) => t.toLowerCase().includes(q)).slice(0, 10);
  }, [allTags, tags, tagSearch]);

  // Debounced contact search — keystrokes coalesce into one IPC call.
  // Participant exclusion is applied at render time so adding/removing a
  // participant doesn't re-fire the search.
  const [rawContactResults, setRawContactResults] = useState<CalendarAttendee[]>([]);
  useEffect(() => {
    if (!participantsOpen) return;
    const query = participantSearch.trim();
    const timer = setTimeout(() => {
      window.electronAPI.searchContacts(query).then((result) => {
        if (result.success) {
          setRawContactResults(result.contacts);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [participantSearch, participantsOpen]);

  useEffect(() => {
    const existing = new Set(participants.map((p) => p.email));
    setContactSuggestions(rawContactResults.filter((c) => !existing.has(c.email)));
  }, [rawContactResults, participants]);

  const handleSelectProject = useCallback((p: string) => {
    setProject(p);
    setProjectOpen(false);
    setProjectSearch("");
  }, []);

  const handleAddTag = useCallback((tag: string) => {
    const normalized = tag.trim().replace(/,/g, ""); // No commas in tag names
    if (normalized && !tags.includes(normalized)) {
      setTags((prev) => [...prev, normalized]);
    }
    setTagSearch("");
  }, [tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleAddParticipant = useCallback(
    (email: string, displayName?: string | null) => {
      const normalized = email.toLowerCase().trim();
      if (!normalized || participants.some((p) => p.email === normalized)) return;
      setParticipants((prev) => [
        ...prev,
        { email: normalized, displayName: displayName || null, responseStatus: null, self: false },
      ]);
      window.electronAPI.upsertContact({ email: normalized, displayName: displayName || null });
      setParticipantSearch("");
    },
    [participants]
  );

  const handleRemoveParticipant = useCallback((email: string) => {
    setParticipants((prev) => prev.filter((p) => p.email !== email));
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({
      title: title.trim() || t("notes.list.untitledNote"),
      folderId,
      participants,
      project: project.trim(),
      tags,
      description: description.trim(),
    });
  }, [title, folderId, project, tags, participants, description, onConfirm, t]);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folders, folderId]
  );

  const filteredFolders = useMemo(() => {
    if (!folderSearch.trim()) return folders;
    const q = folderSearch.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, folderSearch]);

  const handleSelectFolder = useCallback((id: number) => {
    setFolderId(id);
    setFolderOpen(false);
    setFolderSearch("");
  }, []);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && tagSearch.trim()) {
        e.preventDefault();
        handleAddTag(tagSearch);
      }
    },
    [tagSearch, handleAddTag]
  );

  const handleParticipantKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && participantSearch.includes("@")) {
        e.preventDefault();
        handleAddParticipant(participantSearch);
      }
    },
    [participantSearch, handleAddParticipant]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">
            {existingNote
              ? t("notes.meetingSetup.editTitle", "Edit Meeting Details")
              : t("notes.meetingSetup.title", "Meeting Details")}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/60">
              {t("notes.meetingSetup.titleLabel", "Title")}
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("notes.meetingSetup.titlePlaceholder", "Meeting title...")}
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          {/* Folder */}
          {folders.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/60">
                {t("notes.meetingSetup.folderLabel", "Folder")}
              </label>
              <Popover open={folderOpen} onOpenChange={setFolderOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center justify-between w-full h-9 px-3 rounded-md border text-sm transition-colors",
                      "border-border/70 bg-input hover:border-border-hover",
                      "dark:bg-surface-1 dark:border-border-subtle/50",
                      "focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary",
                      !selectedFolder && "text-foreground/40"
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <FolderOpen size={14} className="shrink-0 text-foreground/30" />
                      {selectedFolder?.name ||
                        t("notes.meetingSetup.folderPlaceholder", "Select folder...")}
                    </span>
                    <ChevronDown size={14} className="shrink-0 text-foreground/30" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <div className="p-2 border-b border-border/50">
                    <div className="relative">
                      <Search
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/20"
                      />
                      <input
                        value={folderSearch}
                        onChange={(e) => setFolderSearch(e.target.value)}
                        placeholder={t("notes.meetingSetup.searchFolders", "Search folders...")}
                        className="w-full h-8 pl-8 pr-3 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {filteredFolders.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-foreground/30">
                        {t("notes.meetingSetup.noFoldersFound", "No folders found")}
                      </div>
                    ) : (
                      filteredFolders.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => handleSelectFolder(f.id)}
                          className={cn(
                            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
                            "hover:bg-foreground/5 dark:hover:bg-white/5",
                            folderId === f.id && "bg-primary/5 text-primary"
                          )}
                        >
                          <FolderOpen size={12} className="shrink-0 text-foreground/30" />
                          <span className="truncate">{f.name}</span>
                          {folderId === f.id && <Check size={12} className="ml-auto shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Project */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/60">
              {t("notes.meetingSetup.projectLabel", "Project")}
            </label>
            <Popover open={projectOpen} onOpenChange={setProjectOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center justify-between w-full h-9 px-3 rounded-md border text-sm transition-colors",
                    "border-border/70 bg-input hover:border-border-hover",
                    "dark:bg-surface-1 dark:border-border-subtle/50",
                    "focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary",
                    !project && "text-foreground/40"
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Briefcase size={14} className="shrink-0 text-foreground/30" />
                    {project || t("notes.meetingSetup.projectPlaceholder", "Select project...")}
                  </span>
                  <ChevronDown size={14} className="shrink-0 text-foreground/30" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <div className="p-2 border-b border-border/50">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/20"
                    />
                    <input
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder={t("notes.meetingSetup.searchProjects", "Search projects...")}
                      className="w-full h-8 pl-8 pr-3 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {project && (
                    <button
                      onClick={() => handleSelectProject("")}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/50 hover:bg-foreground/5 transition-colors"
                    >
                      <X size={12} />
                      {t("notes.meetingSetup.clearProject", "Clear project")}
                    </button>
                  )}
                  {filteredProjects.length === 0 ? (
                    <div className="px-2 py-3 text-center text-xs text-foreground/30">
                      {projectSearch
                        ? t("notes.meetingSetup.noProjectsFound", "No projects found")
                        : t("notes.meetingSetup.noProjects", "No projects available")}
                    </div>
                  ) : (
                    filteredProjects.map((p) => (
                      <button
                        key={p}
                        onClick={() => handleSelectProject(p)}
                        className={cn(
                          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
                          "hover:bg-foreground/5 dark:hover:bg-white/5",
                          project === p && "bg-primary/5 text-primary"
                        )}
                      >
                        <Briefcase size={12} className="shrink-0 text-foreground/30" />
                        <span className="truncate">{p}</span>
                        {project === p && <Check size={12} className="ml-auto shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/60">
              {t("notes.meetingSetup.tagsLabel", "Tags")}
            </label>
            <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center flex-wrap gap-1.5 w-full min-h-9 px-2 py-1.5 rounded-md border text-sm transition-colors",
                    "border-border/70 bg-input hover:border-border-hover",
                    "dark:bg-surface-1 dark:border-border-subtle/50",
                    "focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
                  )}
                >
                  <Tag size={14} className="shrink-0 text-foreground/30" />
                  {tags.length === 0 ? (
                    <span className="text-foreground/40">
                      {t("notes.meetingSetup.tagsPlaceholder", "Add tags...")}
                    </span>
                  ) : (
                    tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/8 text-xs text-primary/80"
                      >
                        {tag}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveTag(tag);
                          }}
                          className="hover:text-primary transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <div className="p-2 border-b border-border/50">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/20"
                    />
                    <input
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      placeholder={t("notes.meetingSetup.searchTags", "Search or add tags...")}
                      className="w-full h-8 pl-8 pr-3 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {tagSearch.trim() && !filteredTags.includes(tagSearch.trim()) && (
                    <button
                      onClick={() => handleAddTag(tagSearch)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/5 transition-colors"
                    >
                      <Tag size={12} />
                      {t("notes.meetingSetup.createTag", 'Create "{{tag}}"', { tag: tagSearch.trim() })}
                    </button>
                  )}
                  {filteredTags.length === 0 && !tagSearch.trim() ? (
                    <div className="px-2 py-3 text-center text-xs text-foreground/30">
                      {t("notes.meetingSetup.noTags", "No tags available")}
                    </div>
                  ) : (
                    filteredTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => handleAddTag(tag)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
                      >
                        <Tag size={12} className="shrink-0 text-foreground/30" />
                        <span className="truncate">{tag}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Participants */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/60">
              {t("notes.meetingSetup.participantsLabel", "Participants")}
            </label>
            <Popover open={participantsOpen} onOpenChange={setParticipantsOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center flex-wrap gap-1.5 w-full min-h-9 px-2 py-1.5 rounded-md border text-sm transition-colors",
                    "border-border/70 bg-input hover:border-border-hover",
                    "dark:bg-surface-1 dark:border-border-subtle/50",
                    "focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
                  )}
                >
                  <Users size={14} className="shrink-0 text-foreground/30" />
                  {participants.length === 0 ? (
                    <span className="text-foreground/40">
                      {t("notes.meetingSetup.participantsPlaceholder", "Add participants...")}
                    </span>
                  ) : (
                    participants.map((p) => (
                      <span
                        key={p.email}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-foreground/5 dark:bg-white/5 text-xs"
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-medium text-white shrink-0"
                          style={{ backgroundColor: getInitialColor(p.email) }}
                        >
                          {getInitials(p.displayName, p.email)}
                        </span>
                        <span className="truncate max-w-24">
                          {p.displayName || p.email.split("@")[0]}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveParticipant(p.email);
                          }}
                          className="text-foreground/30 hover:text-foreground/60 transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <div className="p-2 border-b border-border/50">
                  <input
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    onKeyDown={handleParticipantKeyDown}
                    placeholder={t("notes.meetingSetup.searchParticipants", "Search or type email...")}
                    className="w-full h-8 px-3 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {participantSearch.includes("@") && !contactSuggestions.some(c => c.email === participantSearch.toLowerCase()) && (
                    <button
                      onClick={() => handleAddParticipant(participantSearch)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/5 transition-colors"
                    >
                      <Users size={12} />
                      {t("notes.meetingSetup.addEmail", 'Add "{{email}}"', { email: participantSearch })}
                    </button>
                  )}
                  {contactSuggestions.length === 0 && !participantSearch.includes("@") ? (
                    <div className="px-2 py-3 text-center text-xs text-foreground/30">
                      {participantSearch
                        ? t("notes.meetingSetup.noContactsFound", "No contacts found")
                        : t("notes.meetingSetup.typeEmail", "Type an email to add...")}
                    </div>
                  ) : (
                    contactSuggestions.slice(0, 5).map((contact) => (
                      <button
                        key={contact.email}
                        onClick={() => handleAddParticipant(contact.email, contact.display_name)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
                      >
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white shrink-0"
                          style={{ backgroundColor: getInitialColor(contact.email) }}
                        >
                          {getInitials(contact.display_name, contact.email)}
                        </span>
                        <span className="truncate">{contact.display_name || contact.email}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/60">
              {t("notes.meetingSetup.descriptionLabel", "Description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("notes.meetingSetup.descriptionPlaceholder", "Meeting description...")}
              rows={3}
              className={cn(
                "w-full px-3 py-2 rounded-md border text-sm resize-none transition-colors",
                "border-border/70 bg-input hover:border-border-hover",
                "dark:bg-surface-1 dark:border-border-subtle/50",
                "placeholder:text-foreground/40",
                "focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary"
              )}
            />
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border/30 dark:border-white/5">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button variant="default" size="sm" onClick={handleConfirm}>
            {existingNote
              ? t("notes.meetingSetup.save", "Save")
              : t("notes.meetingSetup.confirm", "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
