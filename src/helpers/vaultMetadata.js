const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");

/**
 * VaultMetadataProvider reads tags and projects from a Calyx vault's
 * properties-index.json file for instant autocomplete in the UI.
 *
 * Architecture:
 * - Reads index once on setVaultPath()
 * - Watches for file changes (debounced)
 * - Pushes updates to listeners only when content actually changed
 * - Caches last good result on parse errors
 */
class VaultMetadataProvider {
  constructor() {
    this._vaultPath = null;
    this._watcher = null;
    this._debounceTimer = null;
    this._cache = { tags: [], projects: [], updatedAt: null };
    this._cacheSignature = "";
    this._listeners = new Set();
  }

  /**
   * Set the vault path and start watching for changes.
   * @param {string|null} vaultPath - Path to the Calyx vault root (contains .chiron/)
   * @returns {Promise<{ valid: boolean, error?: string }>}
   */
  async setVaultPath(vaultPath) {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    this._vaultPath = vaultPath;

    if (!vaultPath) {
      this._setCache({ tags: [], projects: [], updatedAt: null });
      debugLogger.debug("Vault metadata provider cleared (no vault path)", {}, "vault-metadata");
      return { valid: true };
    }

    const indexPath = this._getIndexPath();
    if (!fs.existsSync(indexPath)) {
      debugLogger.warn("Vault index not found", { vaultPath, indexPath }, "vault-metadata");
      this._setCache({ tags: [], projects: [], updatedAt: null });
      return { valid: false, error: "Not a Calyx vault (.chiron/properties-index.json missing)" };
    }

    await this._loadIndex();

    try {
      this._watcher = fs.watch(indexPath, (eventType) => {
        if (eventType === "change") {
          clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => this._loadIndex(), 1000);
        }
      });

      this._watcher.on("error", (err) => {
        debugLogger.error("Vault watcher error", { error: err.message }, "vault-metadata");
      });
    } catch (err) {
      debugLogger.warn("Could not watch vault index", { error: err.message }, "vault-metadata");
    }

    debugLogger.debug(
      "Vault metadata provider initialized",
      { vaultPath, indexPath },
      "vault-metadata"
    );
    return { valid: true };
  }

  _getIndexPath() {
    return this._vaultPath
      ? path.join(this._vaultPath, ".chiron", "properties-index.json")
      : null;
  }

  async _loadIndex() {
    const indexPath = this._getIndexPath();
    if (!indexPath) return;

    let raw;
    try {
      raw = await fs.promises.readFile(indexPath, "utf-8");
    } catch (err) {
      debugLogger.error(
        "Failed to read vault index; keeping previous cache",
        { error: err.message, indexPath },
        "vault-metadata"
      );
      return;
    }

    try {
      const index = JSON.parse(raw);
      const tagCounts = new Map();
      const projects = [];

      const snapshots = index.snapshots || {};
      for (const [uri, snapshot] of Object.entries(snapshots)) {
        const props = snapshot.properties || {};

        if (Array.isArray(props.tags)) {
          for (const t of props.tags) {
            const tag = String(t).trim();
            if (tag) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }

        if (props.type === "project") {
          let projectId = props.project_id;
          if (!projectId) {
            const match = uri.match(/projects\/([^/]+)\/index\.md$/);
            projectId = match ? match[1] : path.basename(path.dirname(decodeURIComponent(uri)));
          }

          const rawTitle = props.title;
          const titleStr =
            typeof rawTitle === "string" && rawTitle.trim()
              ? rawTitle
              : projectId || "Untitled";
          projects.push({
            id: projectId,
            title: titleStr,
            status: typeof props.status === "string" ? props.status : null,
            tags: Array.isArray(props.tags) ? props.tags : [],
          });
        }
      }

      const tags = [...tagCounts.keys()].sort((a, b) => {
        const countDiff = (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0);
        return countDiff !== 0 ? countDiff : a.localeCompare(b);
      });

      projects.sort((a, b) => {
        if (a.status === "active" && b.status !== "active") return -1;
        if (b.status === "active" && a.status !== "active") return 1;
        const aTitle = typeof a.title === "string" ? a.title : "";
        const bTitle = typeof b.title === "string" ? b.title : "";
        return aTitle.localeCompare(bTitle);
      });

      this._setCache({ tags, projects, updatedAt: Date.now() });

      debugLogger.debug(
        "Vault metadata loaded",
        { tagCount: tags.length, projectCount: projects.length },
        "vault-metadata"
      );
    } catch (err) {
      debugLogger.error(
        "Failed to parse vault index; keeping previous cache",
        { error: err.message, indexPath },
        "vault-metadata"
      );
    }
  }

  // Sets cache and notifies listeners only if the content signature changed.
  // Skipping no-op notifies prevents thrashing renderers on unrelated vault saves.
  _setCache(next) {
    const signature = JSON.stringify({ tags: next.tags, projects: next.projects });
    if (signature === this._cacheSignature) {
      this._cache = next;
      return;
    }
    this._cache = next;
    this._cacheSignature = signature;
    this._notifyListeners();
  }

  /**
   * Get current cached metadata.
   * @returns {{ tags: string[], projects: Array<{id: string, title: string, status: string|null, tags: string[]}>, updatedAt: number|null }}
   */
  getMetadata() {
    return this._cache;
  }

  /**
   * Subscribe to metadata changes.
   * @param {Function} callback - Called with new metadata when index updates
   * @returns {Function} Unsubscribe function
   */
  onMetadataChanged(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notifyListeners() {
    for (const cb of this._listeners) {
      try {
        cb(this._cache);
      } catch (err) {
        debugLogger.error("Vault metadata listener error", { error: err.message }, "vault-metadata");
      }
    }
  }

  /**
   * Clean up watchers and listeners.
   */
  dispose() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._listeners.clear();
  }
}

module.exports = { VaultMetadataProvider };
