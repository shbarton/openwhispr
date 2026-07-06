const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const debugLogger = require("./debugLogger");

class MarkdownMirror {
  constructor() {
    this._basePath = null;
    this._templatePath = "";
    this._templateContent = null;
    // { [folderName]: absoluteDir } — custom per-folder dirs resolved by
    // ipcHandlers (folder.path ?? <base>/<name>). Lets the mirror write to and
    // glob across folders that live outside the base path.
    this._folderDirs = {};
    // { [key]: { hash, path } } per note (`"<id>"`) / transcript sidecar
    // (`"<id>:transcript"`). `hash` is the sha256 of what this mirror last
    // wrote (external-edit detection); `path` is where the file lives —
    // filenames are slug-only, so this index (with a legacy `<id>-` prefix
    // glob as fallback) is the note↔file link. Lives in userData, not the
    // vault.
    this._index = null;
    this._hashStorePath = undefined;
    this._indexSaveQueued = false;
  }

  init(basePath) {
    this._basePath = basePath;
    try {
      fs.mkdirSync(basePath, { recursive: true });
      debugLogger.debug("Markdown mirror initialized", { basePath }, "note-files");
    } catch (err) {
      debugLogger.error("Failed to init markdown mirror", { error: err.message }, "note-files");
    }
  }

  getBasePath() {
    return this._basePath;
  }

  // ipcHandlers pushes the resolved { folderName: absoluteDir } map whenever
  // folders change (create/rename/delete/path-set) or the mirror re-inits.
  setFolderDirs(dirsByName) {
    this._folderDirs = dirsByName || {};
  }

  // A folder's directory: its custom path if registered, else <base>/<name>.
  _resolveDir(folderName) {
    const name = folderName || "Personal";
    return this._folderDirs[name] || path.join(this._basePath, name);
  }

  // Every directory a note file could live in: base subdirectories plus any
  // custom folder dirs (which may sit outside the base path). Used by the
  // glob helpers so stale-cleanup / delete still find files after a note moves
  // between folders or a folder points elsewhere.
  _searchDirs() {
    const dirs = new Set();
    try {
      for (const d of fs.readdirSync(this._basePath, { withFileTypes: true })) {
        if (d.isDirectory()) dirs.add(path.join(this._basePath, d.name));
      }
    } catch {}
    for (const dir of Object.values(this._folderDirs || {})) {
      if (dir) dirs.add(dir);
    }
    return [...dirs];
  }

  // ---- Write safety --------------------------------------------------------
  // Vault files are user data that may also be edited directly (Calyx /
  // Obsidian). Three protections: writes are atomic (a crash can't truncate a
  // file), a file edited outside the app since our last write is never
  // overwritten, and content of unknown provenance is backed up app-side
  // before the first overwrite or any unlink.

  _sha256(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
  }

  _atomicWrite(filePath, content) {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
  }

  _resolveHashStorePath() {
    if (this._hashStorePath !== undefined) return this._hashStorePath;
    try {
      const { app } = require("electron");
      this._hashStorePath = path.join(app.getPath("userData"), "mirror-hashes.json");
    } catch {
      this._hashStorePath = null;
    }
    return this._hashStorePath;
  }

  // File name kept from the hash-only era so existing hashes carry over.
  _loadIndex() {
    if (this._index) return this._index;
    this._index = {};
    try {
      const storePath = this._resolveHashStorePath();
      if (storePath && fs.existsSync(storePath)) {
        const raw = JSON.parse(fs.readFileSync(storePath, "utf-8")) || {};
        // Hash-only-era entries were bare strings; carry them forward with no
        // path (the legacy `<id>-` glob covers those files until next write).
        for (const [key, value] of Object.entries(raw)) {
          this._index[key] = typeof value === "string" ? { hash: value, path: null } : value;
        }
      }
    } catch (err) {
      debugLogger.error("Failed to load mirror index", { error: err.message }, "note-files");
    }
    return this._index;
  }

  // Coalesced via setImmediate: a rebuild writes many notes in one tick but
  // persists the store once. Losing an unsaved update on hard crash is safe —
  // the affected file just gets the backup-then-write treatment next time.
  _saveIndex() {
    if (this._indexSaveQueued) return;
    this._indexSaveQueued = true;
    setImmediate(() => {
      this._indexSaveQueued = false;
      const storePath = this._resolveHashStorePath();
      if (!storePath || !this._index) return;
      try {
        this._atomicWrite(storePath, JSON.stringify(this._index));
      } catch (err) {
        debugLogger.error("Failed to save mirror index", { error: err.message }, "note-files");
      }
    });
  }

  _setIndexPath(key, filePath) {
    const index = this._loadIndex();
    index[key] = { hash: index[key]?.hash ?? null, path: filePath };
    this._saveIndex();
  }

  _pruneIndex(...keys) {
    const index = this._loadIndex();
    let changed = false;
    for (const key of keys) {
      if (key in index) {
        delete index[key];
        changed = true;
      }
    }
    if (changed) this._saveIndex();
  }

  // App-side copy (userData/mirror-overwrite-backups/) of vault content we're
  // about to overwrite or unlink without being able to prove it's ours.
  _backupFile(filePath, content) {
    try {
      const storePath = this._resolveHashStorePath();
      if (!storePath) return;
      const backupDir = path.join(path.dirname(storePath), "mirror-overwrite-backups");
      fs.mkdirSync(backupDir, { recursive: true });
      // Content-hash component keeps same-name backups written in the same
      // instant from overwriting each other (identical content colliding is
      // harmless — same bytes).
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const hash8 = this._sha256(content).slice(0, 8);
      const backupPath = path.join(backupDir, `${stamp}-${hash8}-${path.basename(filePath)}`);
      fs.writeFileSync(backupPath, content, "utf-8");
      debugLogger.info(
        "Backed up vault file before mirror overwrite/delete",
        { filePath, backupPath },
        "note-files"
      );
    } catch (err) {
      debugLogger.error(
        "Failed to back up vault file",
        { filePath, error: err.message },
        "note-files"
      );
    }
  }

  _backupIfExternallyModified(key, filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (this._loadIndex()[key]?.hash === this._sha256(content)) return;
      this._backupFile(filePath, content);
    } catch {
      // Unreadable/missing — nothing to preserve.
    }
  }

  // Central write path for mirror files. No-op when on-disk content already
  // matches (keeps rebuilds cheap and mtime-stable). Refuses to overwrite a
  // file edited outside the app since our last write — the DB copy stays
  // intact and the conflict is logged. Existing content with no recorded hash
  // (pre-guard files) is backed up app-side once, then adopted.
  _guardedWrite(key, filePath, content) {
    const index = this._loadIndex();
    const entry = index[key];
    const newHash = this._sha256(content);
    let diskContent = null;
    try {
      diskContent = fs.readFileSync(filePath, "utf-8");
    } catch {}
    if (diskContent != null) {
      const diskHash = this._sha256(diskContent);
      if (diskHash === newHash) {
        if (entry?.hash !== newHash || entry?.path !== filePath) {
          index[key] = { hash: newHash, path: filePath };
          this._saveIndex();
        }
        return;
      }
      if (entry?.hash && diskHash !== entry.hash) {
        debugLogger.warn(
          "Skipped mirror write: file was edited outside the app since the last mirror write",
          { key, filePath },
          "note-files"
        );
        // Still track where the file lives so renames/moves/deletes find it.
        if (entry.path !== filePath) {
          index[key] = { ...entry, path: filePath };
          this._saveIndex();
        }
        return;
      }
      if (!entry?.hash) this._backupFile(filePath, diskContent);
    }
    this._atomicWrite(filePath, content);
    index[key] = { hash: newHash, path: filePath };
    this._saveIndex();
  }

  // Where a note's file currently lives: the index's path when it still
  // exists on disk, else the legacy `<id>-` prefix glob (files written before
  // filenames went slug-only).
  _resolveExistingPath(key, noteId, isTranscript) {
    const entry = this._loadIndex()[key];
    if (entry?.path && fs.existsSync(entry.path)) return entry.path;
    const legacy = isTranscript ? this._globTranscriptFiles(noteId) : this._globNoteFiles(noteId);
    const files = isTranscript
      ? legacy
      : legacy.filter((f) => !/-transcript\.(md|txt)$/.test(f));
    return files[0] || null;
  }

  // Slug-only target filename, deduped against files we don't own:
  // `<base>.md`, then `<base>-2.md`, `<base>-3.md`… A candidate is free when
  // it's this note's own current file, or nothing exists there and no other
  // note claims it in the index.
  _resolveTargetPath(dirPath, baseName, key, currentPath) {
    const index = this._loadIndex();
    const claimedByOther = (p) =>
      Object.entries(index).some(([k, v]) => k !== key && v?.path === p);
    for (let n = 1; n <= 200; n++) {
      const name = n === 1 ? `${baseName}.md` : `${baseName}-${n}.md`;
      const candidate = path.join(dirPath, name);
      if (candidate === currentPath) return candidate;
      if (!fs.existsSync(candidate) && !claimedByOther(candidate)) return candidate;
    }
    // Effectively unreachable; the id suffix guarantees uniqueness.
    return path.join(dirPath, `${baseName}-${key.replace(":", "-")}.md`);
  }

  // With the id gone from the filename, the file itself must carry the
  // note's identity — vault-meeting-spec's anchor, and what
  // meeting-folder-sync's reconciliation will match on. Injected into the
  // rendered output's frontmatter (template or stock), or a minimal block is
  // prepended when the template emits none.
  _stampIdentity(output, note) {
    const stamp = `openwhispr_id: ${note.id}\nsource: calyxvoice`;
    if (output.startsWith("---\n")) {
      const close = output.indexOf("\n---", 4);
      if (close !== -1) {
        if (/^openwhispr_id:/m.test(output.slice(4, close))) return output;
        return `${output.slice(0, close)}\n${stamp}${output.slice(close)}`;
      }
    }
    return `---\n${stamp}\n---\n\n${output}`;
  }

  setTemplatePath(templatePath) {
    this._templatePath = templatePath || "";
    if (!this._templatePath) {
      this._templateContent = null;
      debugLogger.debug("Markdown mirror template cleared", {}, "note-files");
      return;
    }
    try {
      this._templateContent = fs.readFileSync(this._templatePath, "utf-8");
      debugLogger.debug(
        "Markdown mirror template loaded",
        { templatePath: this._templatePath, bytes: this._templateContent.length },
        "note-files"
      );
    } catch (err) {
      // Keep prior content (if any) so a transient read error doesn't silently
      // strip user formatting on the next write.
      debugLogger.error(
        "Failed to read note files template; keeping previous template",
        { templatePath: this._templatePath, error: err.message },
        "note-files"
      );
    }
  }

  _slugify(title) {
    return (title || "Untitled")
      .replace(/[/\\?%*:|"<>]/g, "-")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60);
  }

  _formatTimestamp(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  _buildTemplateContext(note, folderName, segments, speakerMappings) {
    const safe = (v) => (v == null ? "" : String(v));
    const created = note.created_at ? new Date(note.created_at) : new Date();
    const recordedAtIso = isNaN(created.getTime()) ? "" : created.toISOString();
    const dateStr = isNaN(created.getTime())
      ? ""
      : created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const timeStr = isNaN(created.getTime())
      ? ""
      : created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    let participantsList = [];
    try {
      const parsed = JSON.parse(note.participants || "[]");
      participantsList = parsed.map((p) => p?.name).filter(Boolean);
    } catch {}

    let durationSeconds = 0;
    if (Array.isArray(segments) && segments.length > 0) {
      const first = segments[0]?.timestamp || 0;
      const last = segments[segments.length - 1]?.timestamp || first;
      durationSeconds = Math.max(0, Math.round((last - first) / 1000));
    }

    let transcriptMd = "";
    if (Array.isArray(segments) && segments.length > 0) {
      try {
        const { formatMd } = require("./transcriptFormatter");
        transcriptMd = formatMd(note, segments, speakerMappings || {});
      } catch (err) {
        debugLogger.error(
          "Template render: failed to format transcript",
          { noteId: note.id, error: err.message },
          "note-files"
        );
      }
    }

    const audioPath = safe(note.audio_path || note.audio_file_path || "");
    const audioFilename = audioPath ? path.basename(audioPath) : "";

    return {
      id: safe(note.id),
      title: safe(note.title || "Untitled"),
      slug: this._slugify(note.title),
      type: safe(note.note_type || "personal"),
      folder: safe(folderName || "Personal"),
      description: safe(note.description || ""),
      project: safe(note.project || ""),
      tags: safe(note.tags || ""),
      tags_yaml: "",
      participants: participantsList.join(", "),
      attendees: participantsList.join(", "),
      trigger_app: safe(note.trigger_app || ""),
      audio_path: audioPath,
      audio_filename: audioFilename,
      recorded_at: recordedAtIso,
      created: safe(note.created_at || recordedAtIso),
      updated: safe(note.updated_at || recordedAtIso),
      date: dateStr,
      time: timeStr,
      duration: this._formatTimestamp(durationSeconds),
      duration_seconds: String(durationSeconds),
      transcript: transcriptMd,
      transcript_with_speakers: transcriptMd,
    };
  }

  _renderTemplate(template, context) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match
    );
  }

  _buildFrontmatter(note, folderName) {
    const escYaml = (str) => {
      if (!str) return '""';
      if (/[:#{}[\],&*?|>!%@`]/.test(str) || str.includes('"') || str.includes("'")) {
        return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return str;
    };
    const lines = [
      "---",
      `id: ${note.id}`,
      `title: ${escYaml(note.title)}`,
      `type: ${note.note_type || "personal"}`,
      `folder: ${escYaml(folderName || "Personal")}`,
      `created: ${note.created_at || new Date().toISOString()}`,
      `updated: ${note.updated_at || new Date().toISOString()}`,
      "---",
    ];
    return lines.join("\n");
  }

  writeNote(note, folderName, speakerMappings) {
    if (!this._basePath) return;
    try {
      const dirName = folderName || "Personal";
      const dirPath = this._resolveDir(dirName);
      fs.mkdirSync(dirPath, { recursive: true });

      const noteKey = String(note.id);
      const transcriptKey = `${note.id}:transcript`;

      const currentPath = this._resolveExistingPath(noteKey, note.id, false);
      const newFilePath = this._resolveTargetPath(
        dirPath,
        this._slugify(note.title),
        noteKey,
        currentPath
      );

      // Title rename / folder change / legacy `<id>-` file: move the
      // existing file instead of write-new-and-delete-old — a plain rename
      // preserves any edits made directly in the vault.
      if (currentPath && currentPath !== newFilePath) {
        try {
          fs.renameSync(currentPath, newFilePath);
          this._setIndexPath(noteKey, newFilePath);
        } catch (err) {
          debugLogger.error(
            "Failed to rename note file; will write fresh and clean up",
            { from: currentPath, to: newFilePath, error: err.message },
            "note-files"
          );
        }
      }

      // Leftovers beyond the tracked file: older duplicates from the legacy
      // prefix scheme, and — in template mode — the orphaned transcript
      // sidecar (its content is inlined via {{transcript}}). Stock mode
      // leaves sidecars to writeTranscript's own lifecycle.
      for (const stale of this._globNoteFiles(note.id)) {
        if (stale === newFilePath) continue;
        const isSidecar = /-transcript\.(md|txt)$/.test(stale);
        if (isSidecar && !this._templateContent) continue;
        this._backupIfExternallyModified(isSidecar ? transcriptKey : noteKey, stale);
        try {
          fs.unlinkSync(stale);
        } catch {}
      }
      if (this._templateContent) {
        const sidecar = this._resolveExistingPath(transcriptKey, note.id, true);
        if (sidecar && sidecar !== newFilePath) {
          this._backupIfExternallyModified(transcriptKey, sidecar);
          try {
            fs.unlinkSync(sidecar);
          } catch {}
        }
        this._pruneIndex(transcriptKey);
      }

      // Template branch renders one self-contained file with {{transcript}}
      // inlined; the existing `<id>-*.md` cleanup above already removes the
      // sidecar. Stock branch keeps the bare frontmatter + body shape and
      // lets writeTranscript produce the sidecar.
      let output;
      if (this._templateContent) {
        let segments = [];
        try {
          segments = JSON.parse(note.transcript || "[]");
        } catch {}
        const ctx = this._buildTemplateContext(note, dirName, segments, speakerMappings || {});
        output = this._renderTemplate(this._templateContent, ctx);
      } else {
        const frontmatter = this._buildFrontmatter(note, dirName);
        const body = note.enhanced_content || note.content || "";
        output = `${frontmatter}\n\n${body}`;
      }

      this._guardedWrite(noteKey, newFilePath, this._stampIdentity(output, note));
    } catch (err) {
      debugLogger.error(
        "Failed to write note file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  writeTranscript(note, folderName, speakerMappings) {
    if (!this._basePath) return;
    // When a template is configured, the transcript is inlined via the
    // {{transcript}} substitution in writeNote; skip the sidecar file.
    if (this._templateContent) return;
    try {
      const segments = JSON.parse(note.transcript || "[]");
      if (!segments.length) return;

      const dirName = folderName || "Personal";
      const dirPath = this._resolveDir(dirName);
      fs.mkdirSync(dirPath, { recursive: true });

      const transcriptKey = `${note.id}:transcript`;
      const currentPath = this._resolveExistingPath(transcriptKey, note.id, true);
      const newFilePath = this._resolveTargetPath(
        dirPath,
        `${this._slugify(note.title)}-transcript`,
        transcriptKey,
        currentPath
      );

      if (currentPath && currentPath !== newFilePath) {
        try {
          fs.renameSync(currentPath, newFilePath);
          this._setIndexPath(transcriptKey, newFilePath);
        } catch (err) {
          debugLogger.error(
            "Failed to rename transcript file; will write fresh and clean up",
            { from: currentPath, to: newFilePath, error: err.message },
            "note-files"
          );
        }
      }

      for (const stale of this._globTranscriptFiles(note.id)) {
        if (stale === newFilePath) continue;
        this._backupIfExternallyModified(transcriptKey, stale);
        try {
          fs.unlinkSync(stale);
        } catch {}
      }

      const { formatMd } = require("./transcriptFormatter");
      this._guardedWrite(transcriptKey, newFilePath, formatMd(note, segments, speakerMappings || {}));
    } catch (err) {
      debugLogger.error(
        "Failed to write transcript file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  deleteNote(noteId) {
    if (!this._basePath) return;
    try {
      const noteKey = String(noteId);
      const transcriptKey = `${noteId}:transcript`;
      const index = this._loadIndex();
      const files = new Set([
        ...this._globNoteFiles(noteId),
        ...this._globTranscriptFiles(noteId),
      ]);
      // Slug-named files aren't matched by the legacy glob — add the tracked
      // paths.
      if (index[noteKey]?.path) files.add(index[noteKey].path);
      if (index[transcriptKey]?.path) files.add(index[transcriptKey].path);
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const isSidecar = /-transcript\.(md|txt)$/.test(f);
        this._backupIfExternallyModified(isSidecar ? transcriptKey : noteKey, f);
        try {
          fs.unlinkSync(f);
        } catch {}
      }
      this._pruneIndex(noteKey, transcriptKey);
    } catch (err) {
      debugLogger.error("Failed to delete note file", { noteId, error: err.message }, "note-files");
    }
  }

  // Move a note's tracked file + sidecar between folder directories (folder
  // path change). Legacy `<id>-` files are found by the glob fallback.
  // Returns the number of files moved.
  relocateNoteFiles(noteId, fromDir, toDir) {
    let moved = 0;
    for (const key of [String(noteId), `${noteId}:transcript`]) {
      const isTranscript = key.endsWith(":transcript");
      const current = this._resolveExistingPath(key, noteId, isTranscript);
      if (!current || path.dirname(current) !== fromDir) continue;
      // Re-resolve the destination name — the target dir may already hold a
      // same-slug file belonging to another note.
      const base = path.basename(current).replace(/\.md$/, "");
      const dst = this._resolveTargetPath(toDir, base, key, null);
      try {
        fs.renameSync(current, dst);
      } catch {
        // Cross-filesystem fallback; per-file guard so one failure doesn't
        // abort the rest of the folder move.
        try {
          fs.copyFileSync(current, dst);
          fs.unlinkSync(current);
        } catch (err) {
          debugLogger.error(
            "Failed to move mirror file; leaving it in place",
            { file: current, error: err.message },
            "note-files"
          );
          continue;
        }
      }
      this._setIndexPath(key, dst);
      moved++;
    }
    return moved;
  }

  ensureFolder(folderName) {
    if (!this._basePath) return;
    try {
      fs.mkdirSync(this._resolveDir(folderName), { recursive: true });
    } catch (err) {
      debugLogger.error(
        "Failed to ensure folder",
        { folderName, error: err.message },
        "note-files"
      );
    }
  }

  renameFolder(oldName, newName) {
    if (!this._basePath) return;
    try {
      const oldPath = path.join(this._basePath, oldName);
      const newPath = path.join(this._basePath, newName);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    } catch (err) {
      debugLogger.error(
        "Failed to rename folder",
        { oldName, newName, error: err.message },
        "note-files"
      );
    }
  }

  // Remove a folder's directory only if it is now empty (after its note files
  // were deleted individually). Never recursive — safe for a dir another folder
  // shares or a user vault location that holds other content.
  removeFolderDirIfEmpty(folderName) {
    if (!this._basePath) return;
    try {
      fs.rmdirSync(this._resolveDir(folderName));
    } catch {
      // ENOTEMPTY / ENOENT — leave the directory in place.
    }
  }

  rebuildAll(notes, folderMap, speakerMappingsMap) {
    if (!this._basePath) return;
    try {
      for (const note of notes) {
        const folderName = folderMap[note.folder_id] || "Personal";
        const speakerMappings = speakerMappingsMap?.[note.id] || {};
        this.writeNote(note, folderName, speakerMappings);
        if (note.transcript) {
          this.writeTranscript(note, folderName, speakerMappings);
        }
      }
      debugLogger.info("Markdown mirror rebuild complete", { count: notes.length }, "note-files");
    } catch (err) {
      debugLogger.error("Failed to rebuild all note files", { error: err.message }, "note-files");
    }
  }

  getNotePath(noteId) {
    if (!this._basePath) return null;
    return this._resolveExistingPath(String(noteId), noteId, false);
  }

  getFolderPath(folderName) {
    if (!this._basePath) return null;
    const dirPath = this._resolveDir(folderName);
    return fs.existsSync(dirPath) ? dirPath : null;
  }

  // Files named `<noteId>-*` matching `predicate(filename)`, across every dir a
  // note could live in (base subdirs + custom folder dirs).
  _globByPrefix(noteId, predicate) {
    if (!this._basePath) return [];
    const prefix = `${noteId}-`;
    const results = [];
    for (const dirPath of this._searchDirs()) {
      try {
        for (const file of fs.readdirSync(dirPath)) {
          if (file.startsWith(prefix) && predicate(file)) {
            results.push(path.join(dirPath, file));
          }
        }
      } catch {}
    }
    return results;
  }

  // Matches `-transcript.md` too, by design: writeNote's stale-cleanup relies on
  // it to remove an orphaned sidecar when switching to template mode (which
  // inlines the transcript and skips writeTranscript).
  _globNoteFiles(noteId) {
    return this._globByPrefix(noteId, (f) => f.endsWith(".md"));
  }

  _globTranscriptFiles(noteId) {
    return this._globByPrefix(
      noteId,
      (f) => f.endsWith("-transcript.md") || f.endsWith("-transcript.txt")
    );
  }
}

module.exports = new MarkdownMirror();
