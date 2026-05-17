import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Tag, Users, FileText, X, Search, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "../lib/utils";
import type { NoteItem, VaultMetadata } from "../../types/electron";
import type { CalendarAttendee } from "../../types/calendar";
import { getInitials, getInitialColor } from "../../utils/avatarUtils";
import { useNotes } from "../../stores/noteStore";

interface MeetingMetadataRowProps {
  note: NoteItem;
  onUpdate: (updates: Partial<NoteItem>) => void;
}

/**
 * Inline metadata row for meeting notes.
 * Displays project, tags, participants, and description as clickable pills
 * that open popovers for editing. Changes save immediately (except description
 * which is debounced).
 */
export default function MeetingMetadataRow({ note, onUpdate }: MeetingMetadataRowProps) {
  const { t } = useTranslation();
  const notes = useNotes();

  // Parse participants from JSON string
  const participants = useMemo<CalendarAttendee[]>(() => {
    try {
      return note.participants ? JSON.parse(note.participants) : [];
    } catch {
      return [];
    }
  }, [note.participants]);

  // Parse tags from comma-separated string
  const tags = useMemo<string[]>(() => {
    return note.tags
      ? note.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
  }, [note.tags]);

  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {/* Primary row: Project, Tags, Participants */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ProjectPicker
          value={note.project || ""}
          notes={notes}
          onSelect={(project) => onUpdate({ project: project || null })}
        />

        <span className="text-foreground/15 dark:text-foreground/10 text-xs">·</span>

        <TagsEditor
          tags={tags}
          notes={notes}
          onTagsChange={(newTags) =>
            onUpdate({ tags: newTags.length > 0 ? newTags.join(", ") : null })
          }
        />

        <span className="text-foreground/15 dark:text-foreground/10 text-xs">·</span>

        <ParticipantsPicker
          noteId={note.id}
          participants={participants}
          onParticipantsChange={(updated) =>
            onUpdate({ participants: JSON.stringify(updated) })
          }
        />
      </div>

      {/* Secondary row: Description (if present or being edited) */}
      <DescriptionEditor
        value={note.description || ""}
        onChange={(description) => onUpdate({ description: description || null })}
      />
    </div>
  );
}

// ============================================================================
// ProjectPicker - Inline project selection
// ============================================================================

interface ProjectPickerProps {
  value: string;
  notes: NoteItem[];
  onSelect: (project: string) => void;
}

function ProjectPicker({ value, notes, onSelect }: ProjectPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata>({
    tags: [],
    projects: [],
    updatedAt: null,
  });

  // Load vault metadata when popover opens
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
    const vaultSet = new Set(vaultTitles);
    const localOnly = localProjects.filter((p) => !vaultSet.has(p)).sort();
    return [...vaultTitles, ...localOnly];
  }, [vaultMetadata.projects, notes]);

  // Filter projects by search
  const filteredProjects = useMemo(() => {
    if (!search.trim()) return allProjects.slice(0, 10);
    const q = search.toLowerCase();
    return allProjects.filter((p) => p.toLowerCase().includes(q)).slice(0, 10);
  }, [allProjects, search]);

  const handleSelect = useCallback(
    (project: string) => {
      onSelect(project);
      setOpen(false);
      setSearch("");
    },
    [onSelect]
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors",
            "hover:bg-foreground/5 dark:hover:bg-white/5",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            value ? "text-foreground/60" : "text-foreground/35"
          )}
        >
          <Folder size={11} className="shrink-0" />
          <span className="truncate max-w-32">{value || t("notes.metadata.addProject", "Add project")}</span>
          <ChevronDown size={10} className="shrink-0 text-foreground/25" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b border-border/50">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/20"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("notes.metadata.searchProjects", "Search projects...")}
              className="w-full h-7 pl-7 pr-2 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto p-1">
          {value && (
            <button
              onClick={() => handleSelect("")}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/50 hover:bg-foreground/5 transition-colors"
            >
              <X size={11} />
              {t("notes.metadata.clearProject", "Clear project")}
            </button>
          )}
          {filteredProjects.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-foreground/30">
              {search
                ? t("notes.metadata.noProjectsFound", "No projects found")
                : t("notes.metadata.noProjects", "No projects available")}
            </div>
          ) : (
            filteredProjects.map((p) => (
              <button
                key={p}
                onClick={() => handleSelect(p)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
                  "hover:bg-foreground/5 dark:hover:bg-white/5",
                  value === p && "bg-primary/5 text-primary"
                )}
              >
                <Folder size={11} className="shrink-0 text-foreground/30" />
                <span className="truncate">{p}</span>
                {value === p && <Check size={11} className="ml-auto shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// TagsEditor - Inline tags editing
// ============================================================================

interface TagsEditorProps {
  tags: string[];
  notes: NoteItem[];
  onTagsChange: (tags: string[]) => void;
}

function TagsEditor({ tags, notes, onTagsChange }: TagsEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata>({
    tags: [],
    projects: [],
    updatedAt: null,
  });

  // Load vault metadata when popover opens
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
    const vaultSet = new Set(vaultMetadata.tags);
    const localOnly = [...localTags].filter((t) => !vaultSet.has(t)).sort();
    return [...vaultMetadata.tags, ...localOnly];
  }, [vaultMetadata.tags, notes]);

  // Filter tags by search (exclude already selected)
  const filteredTags = useMemo(() => {
    const available = allTags.filter((t) => !tags.includes(t));
    if (!search.trim()) return available.slice(0, 10);
    const q = search.toLowerCase();
    return available.filter((t) => t.toLowerCase().includes(q)).slice(0, 10);
  }, [allTags, tags, search]);

  const handleAddTag = useCallback(
    (tag: string) => {
      const normalized = tag.trim().replace(/,/g, "");
      if (normalized && !tags.includes(normalized)) {
        onTagsChange([...tags, normalized]);
      }
      setSearch("");
    },
    [tags, onTagsChange]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      onTagsChange(tags.filter((t) => t !== tag));
    },
    [tags, onTagsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && search.trim()) {
        e.preventDefault();
        handleAddTag(search);
      }
    },
    [search, handleAddTag]
  );

  const tagDisplay =
    tags.length > 0
      ? tags.slice(0, 2).join(", ") + (tags.length > 2 ? ` +${tags.length - 2}` : "")
      : t("notes.metadata.addTags", "Add tags");

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors",
            "hover:bg-foreground/5 dark:hover:bg-white/5",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            tags.length > 0 ? "text-foreground/60" : "text-foreground/35"
          )}
        >
          <Tag size={11} className="shrink-0" />
          <span className="truncate max-w-32">{tagDisplay}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* Selected tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 p-2 border-b border-border/50">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/8 text-[10px] text-primary/80"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-primary transition-colors"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        <div className="p-2 border-b border-border/50">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/20"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("notes.metadata.searchTags", "Search or add tags...")}
              className="w-full h-7 pl-7 pr-2 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
              autoFocus
            />
          </div>
        </div>

        {/* Tag suggestions */}
        <div className="max-h-48 overflow-y-auto p-1">
          {search.trim() && !filteredTags.includes(search.trim()) && (
            <button
              onClick={() => handleAddTag(search)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/5 transition-colors"
            >
              <Tag size={11} />
              {t("notes.metadata.createTag", 'Create "{{tag}}"', { tag: search.trim() })}
            </button>
          )}
          {filteredTags.length === 0 && !search.trim() ? (
            <div className="px-2 py-3 text-center text-xs text-foreground/30">
              {t("notes.metadata.noTags", "No tags available")}
            </div>
          ) : (
            filteredTags.map((tag) => (
              <button
                key={tag}
                onClick={() => handleAddTag(tag)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
              >
                <Tag size={11} className="shrink-0 text-foreground/30" />
                <span className="truncate">{tag}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// ParticipantsPicker - Inline participants editing
// ============================================================================

interface ParticipantsPickerProps {
  noteId: number;
  participants: CalendarAttendee[];
  onParticipantsChange: (participants: CalendarAttendee[]) => void;
}

function ParticipantsPicker({
  noteId,
  participants,
  onParticipantsChange,
}: ParticipantsPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ email: string; display_name: string | null }>
  >([]);

  // Search contacts when typing
  useEffect(() => {
    if (!open) return;
    const query = search.trim();
    const timer = setTimeout(() => {
      window.electronAPI.searchContacts(query).then((result) => {
        if (result.success) {
          const existing = new Set(participants.map((p) => p.email));
          setSuggestions(result.contacts.filter((c) => !existing.has(c.email)));
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [search, open, participants]);

  const addParticipant = useCallback(
    (email: string, displayName?: string | null) => {
      const normalized = email.toLowerCase().trim();
      if (!normalized || participants.some((p) => p.email === normalized)) return;
      const updated = [
        ...participants,
        { email: normalized, displayName: displayName || null, responseStatus: null, self: false },
      ];
      onParticipantsChange(updated);
      window.electronAPI.upsertContact({ email: normalized, displayName: displayName || null });
      setSearch("");
    },
    [participants, onParticipantsChange]
  );

  const removeParticipant = useCallback(
    (email: string) => {
      const updated = participants.filter((p) => p.email !== email);
      onParticipantsChange(updated);
    },
    [participants, onParticipantsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && search.includes("@")) {
        e.preventDefault();
        addParticipant(search);
      }
    },
    [search, addParticipant]
  );

  const chipLabel =
    participants.length > 0
      ? `${participants.length} ${
          participants.length === 1
            ? t("notes.participants.attendee", "attendee")
            : t("notes.participants.attendees", "attendees")
        }`
      : t("notes.metadata.addParticipants", "Add participants");

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors",
            "hover:bg-foreground/5 dark:hover:bg-white/5",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            participants.length > 0 ? "text-foreground/60" : "text-foreground/35"
          )}
        >
          <Users size={11} className="shrink-0" />
          <span>{chipLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* Search input */}
        <div className="p-2 border-b border-border/50">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("notes.participants.addPlaceholder", "Add attendees...")}
            className="w-full h-7 px-2 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto">
          {/* Contact suggestions */}
          {search && suggestions.length > 0 && (
            <div className="p-1 border-b border-border/30">
              {suggestions.slice(0, 5).map((contact) => (
                <button
                  key={contact.email}
                  onClick={() => addParticipant(contact.email, contact.display_name)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-foreground/70 hover:bg-foreground/5 transition-colors cursor-pointer"
                >
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white"
                    style={{ backgroundColor: getInitialColor(contact.email) }}
                  >
                    {getInitials(contact.display_name, contact.email)}
                  </span>
                  <span className="truncate">{contact.display_name || contact.email}</span>
                </button>
              ))}
            </div>
          )}

          {/* Add email directly */}
          {search.includes("@") &&
            !suggestions.some((c) => c.email === search.toLowerCase()) && (
              <div className="p-1 border-b border-border/30">
                <button
                  onClick={() => addParticipant(search)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-primary hover:bg-primary/5 transition-colors"
                >
                  <Users size={11} />
                  {t("notes.metadata.addEmail", 'Add "{{email}}"', { email: search })}
                </button>
              </div>
            )}

          {/* Current participants */}
          {participants.length > 0 ? (
            <div className="p-1">
              {participants.map((p) => (
                <div
                  key={p.email}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-foreground/5 transition-colors"
                >
                  <span
                    className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white"
                    style={{ backgroundColor: getInitialColor(p.email) }}
                  >
                    {getInitials(p.displayName, p.email)}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
                    {p.displayName || p.email.split("@")[0]}
                  </span>
                  <button
                    onClick={() => removeParticipant(p.email)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-foreground/30 hover:text-foreground/60 transition-opacity cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-[11px] text-foreground/30">
              {t("notes.participants.typeEmail", "Type an email to add...")}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// DescriptionEditor - Inline description editing with debounce
// ============================================================================

interface DescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
}

function DescriptionEditor({ value, onChange }: DescriptionEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync draft with prop value when note changes
  useEffect(() => {
    setDraft(value);
    setSavedValue(value);
  }, [value]);

  // Debounced save on draft change
  useEffect(() => {
    if (draft === savedValue) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      onChange(draft);
      setSavedValue(draft);
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [draft, savedValue, onChange]);

  // Handle Escape to revert
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft(savedValue);
        setOpen(false);
      }
    },
    [savedValue]
  );

  // Save on blur
  const handleBlur = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (draft !== savedValue) {
      onChange(draft);
      setSavedValue(draft);
    }
  }, [draft, savedValue, onChange]);

  const hasDescription = draft.trim().length > 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          handleBlur();
        }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-left transition-colors w-full",
            "hover:bg-foreground/5 dark:hover:bg-white/5",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            hasDescription ? "text-foreground/50" : "text-foreground/30"
          )}
        >
          <FileText size={11} className="shrink-0" />
          <span className="truncate">
            {hasDescription
              ? draft.length > 60
                ? draft.slice(0, 60) + "..."
                : draft
              : t("notes.metadata.addDescription", "Add description...")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={t("notes.metadata.descriptionPlaceholder", "Brief description of this meeting...")}
          rows={3}
          className="w-full px-2 py-1.5 rounded-md bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/8 dark:border-white/8 text-xs text-foreground placeholder:text-foreground/25 outline-none focus:border-primary/30 resize-none"
          autoFocus
        />
        <p className="text-[10px] text-foreground/25 mt-1.5">
          {t("notes.metadata.descriptionHint", "Press Escape to cancel, changes save automatically.")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
