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
 * - Pushes updates to listeners (for IPC broadcast)
 * - Caches last good result on parse errors
 */
class VaultMetadataProvider {
  constructor() {
    this._vaultPath = null;
    this._watcher = null;
    this._debounceTimer = null;
    this._cache = { tags: [], projects: [], updatedAt: null };
    this._listeners = new Set();
  }

  /**
   * Set the vault path and start watching for changes.
   * @param {string|null} vaultPath - Path to the Calyx vault root (contains .chiron/)
   */
  setVaultPath(vaultPath) {
    console.log("[vault-metadata] setVaultPath called with:", vaultPath);
    // Clean up old watcher
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
      this._cache = { tags: [], projects: [], updatedAt: null };
      this._notifyListeners();
      debugLogger.debug("Vault metadata provider cleared (no vault path)", {}, "vault-metadata");
      return;
    }

    // Validate vault path
    const indexPath = this._getIndexPath();
    if (!fs.existsSync(indexPath)) {
      debugLogger.warn(
        "Vault index not found",
        { vaultPath, indexPath },
        "vault-metadata"
      );
      this._cache = { tags: [], projects: [], updatedAt: null };
      this._notifyListeners();
      return;
    }

    // Initial load
    this._loadIndex();

    // Watch for changes using native fs.watch (debounced)
    try {
      this._watcher = fs.watch(indexPath, (eventType) => {
        if (eventType === "change") {
          clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => this._loadIndex(), 300);
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
  }

  _getIndexPath() {
    return this._vaultPath
      ? path.join(this._vaultPath, ".chiron", "properties-index.json")
      : null;
  }

  _loadIndex() {
    const indexPath = this._getIndexPath();
    console.log("[vault-metadata] _loadIndex called, indexPath:", indexPath);
    if (!indexPath || !fs.existsSync(indexPath)) {
      console.log("[vault-metadata] Index path not found or doesn't exist");
      return;
    }

    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      console.log("[vault-metadata] Read index file, size:", raw.length);
      const index = JSON.parse(raw);

      // Extract tags: unique values from all snapshots[].properties.tags arrays
      const tagCounts = new Map();

      // Extract projects: entries where type === "project"
      const projects = [];

      const snapshots = index.snapshots || {};
      for (const [uri, snapshot] of Object.entries(snapshots)) {
        const props = snapshot.properties || {};

        // Collect tags with counts
        if (Array.isArray(props.tags)) {
          for (const t of props.tags) {
            const tag = String(t).trim();
            if (tag) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }

        // Collect projects
        if (props.type === "project") {
          // Extract project_id from URI or properties
          let projectId = props.project_id;
          if (!projectId) {
            // Try to derive from URI: file:///path/to/vault/projects/my-project/index.md
            const match = uri.match(/projects\/([^/]+)\/index\.md$/);
            projectId = match ? match[1] : path.basename(path.dirname(decodeURIComponent(uri)));
          }

          projects.push({
            id: projectId,
            title: props.title || projectId || "Untitled",
            status: props.status || null,
            tags: Array.isArray(props.tags) ? props.tags : [],
          });
        }
      }

      // Sort tags by frequency (most used first), then alphabetically
      const tags = [...tagCounts.keys()].sort((a, b) => {
        const countDiff = (tagCounts.get(b) || 0) - (tagCounts.get(a) || 0);
        return countDiff !== 0 ? countDiff : a.localeCompare(b);
      });

      // Sort projects: active first, then by title
      projects.sort((a, b) => {
        if (a.status === "active" && b.status !== "active") return -1;
        if (b.status === "active" && a.status !== "active") return 1;
        return (a.title || "").localeCompare(b.title || "");
      });

      this._cache = {
        tags,
        projects,
        updatedAt: Date.now(),
      };

      debugLogger.debug(
        "Vault metadata loaded",
        { tagCount: tags.length, projectCount: projects.length },
        "vault-metadata"
      );

      this._notifyListeners();
    } catch (err) {
      // Keep last good cache on parse error
      debugLogger.error(
        "Failed to load vault index; keeping previous cache",
        { error: err.message, indexPath },
        "vault-metadata"
      );
    }
  }

  /**
   * Get current cached metadata.
   * @returns {{ tags: string[], projects: Array<{id: string, title: string, status: string|null, tags: string[]}>, updatedAt: number|null }}
   */
  getMetadata() {
    console.log("[vault-metadata] getMetadata called, cache:", { tags: this._cache.tags.length, projects: this._cache.projects.length });
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
