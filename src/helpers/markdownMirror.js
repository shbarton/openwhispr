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
    // { [key]: sha256 } of the content this mirror last wrote per note
    // (`"<id>"`) / transcript sidecar (`"<id>:transcript"`). Lives in userData,
    // not the vault. Lets writes detect files edited outside the app and
    // refuse to clobber them.
    this._hashes = null;
    this._hashStorePath = undefined;
    this._hashSaveQueued = false;
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

  _loadHashes() {
    if (this._hashes) return this._hashes;
    this._hashes = {};
    try {
      const storePath = this._resolveHashStorePath();
      if (storePath && fs.existsSync(storePath)) {
        this._hashes = JSON.parse(fs.readFileSync(storePath, "utf-8")) || {};
      }
    } catch (err) {
      debugLogger.error("Failed to load mirror hash store", { error: err.message }, "note-files");
    }
    return this._hashes;
  }

  // Coalesced via setImmediate: a rebuild writes many notes in one tick but
  // persists the store once. Losing an unsaved update on hard crash is safe —
  // the affected file just gets the backup-then-write treatment next time.
  _saveHashes() {
    if (this._hashSaveQueued) return;
    this._hashSaveQueued = true;
    setImmediate(() => {
      this._hashSaveQueued = false;
      const storePath = this._resolveHashStorePath();
      if (!storePath || !this._hashes) return;
      try {
        this._atomicWrite(storePath, JSON.stringify(this._hashes));
      } catch (err) {
        debugLogger.error("Failed to save mirror hash store", { error: err.message }, "note-files");
      }
    });
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
      if (this._loadHashes()[key] === this._sha256(content)) return;
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
    const hashes = this._loadHashes();
    const newHash = this._sha256(content);
    let diskContent = null;
    try {
      diskContent = fs.readFileSync(filePath, "utf-8");
    } catch {}
    if (diskContent != null) {
      const diskHash = this._sha256(diskContent);
      if (diskHash === newHash) {
        if (hashes[key] !== newHash) {
          hashes[key] = newHash;
          this._saveHashes();
        }
        return;
      }
      if (hashes[key] && diskHash !== hashes[key]) {
        debugLogger.warn(
          "Skipped mirror write: file was edited outside the app since the last mirror write",
          { key, filePath },
          "note-files"
        );
        return;
      }
      if (!hashes[key]) this._backupFile(filePath, diskContent);
    }
    this._atomicWrite(filePath, content);
    hashes[key] = newHash;
    this._saveHashes();
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

      // Remove stale files (title changed or note moved to different folder)
      const noteKey = String(note.id);
      const transcriptKey = `${note.id}:transcript`;
      const glob = this._globNoteFiles(note.id);
      const slug = this._slugify(note.title);
      const newFileName = `${note.id}-${slug}.md`;
      const newFilePath = path.join(dirPath, newFileName);
      for (const existing of glob) {
        if (existing === newFilePath) continue;
        const isSidecar = /-transcript\.(md|txt)$/.test(existing);
        // Stock mode: writeTranscript owns the sidecar lifecycle (including
        // its own stale sweep on rename) — deleting it here would churn it on
        // every note write. Template mode inlines the transcript, so a
        // sidecar is an orphan to remove.
        if (isSidecar && !this._templateContent) continue;
        this._backupIfExternallyModified(isSidecar ? transcriptKey : noteKey, existing);
        try {
          fs.unlinkSync(existing);
        } catch {}
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

      this._guardedWrite(noteKey, newFilePath, output);
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

      const slug = this._slugify(note.title);
      const newFileName = `${note.id}-${slug}-transcript.md`;
      const newFilePath = path.join(dirPath, newFileName);
      const transcriptKey = `${note.id}:transcript`;

      const stale = this._globTranscriptFiles(note.id);
      for (const existing of stale) {
        if (existing === newFilePath) continue;
        this._backupIfExternallyModified(transcriptKey, existing);
        try {
          fs.unlinkSync(existing);
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
      const files = [
        ...new Set([...this._globNoteFiles(noteId), ...this._globTranscriptFiles(noteId)]),
      ];
      for (const f of files) {
        const isSidecar = /-transcript\.(md|txt)$/.test(f);
        this._backupIfExternallyModified(isSidecar ? transcriptKey : noteKey, f);
        try {
          fs.unlinkSync(f);
        } catch {}
      }
      const hashes = this._loadHashes();
      if (noteKey in hashes || transcriptKey in hashes) {
        delete hashes[noteKey];
        delete hashes[transcriptKey];
        this._saveHashes();
      }
    } catch (err) {
      debugLogger.error("Failed to delete note file", { noteId, error: err.message }, "note-files");
    }
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
    const files = this._globNoteFiles(noteId);
    return files.length > 0 ? files[0] : null;
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
