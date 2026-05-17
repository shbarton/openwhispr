/**
 * AgentBackendManager - Tracks active CLI agent streams keyed by streamId.
 *
 * Lives in the Electron main process. IPC handlers (separate task) will call
 * into this manager to start, cancel, and clean up streams; each stream owns a
 * single ClaudeAgentBackend subprocess.
 *
 * Spec from PlatosRaveCave/projects/openwhispr/tasks/agent-bridge-infra/index.md:
 *
 *   class AgentBackendManager {
 *     constructor() { this.activeStreams = new Map(); }
 *     async start(streamId, prompt, config, sessionId) { ... }
 *     cancel(streamId) { ... }
 *     cleanup(streamId) { ... }
 *   }
 */

const { ClaudeAgentBackend } = require("./ClaudeAgentBackend");

class AgentBackendManager {
  constructor() {
    /**
     * Active streams keyed by caller-supplied streamId.
     * @type {Map<string, { backend: ClaudeAgentBackend, sessionId: string | null }>}
     */
    this.activeStreams = new Map();
  }

  /**
   * Start a new stream.
   *
   * Creates a ClaudeAgentBackend, calls start() (or resume() if a sessionId is
   * supplied), then send(). Returns the backend so the caller can iterate its
   * `stream()` and forward events via IPC.
   *
   * @param {string} streamId          Caller-supplied identifier (typically a UUID).
   * @param {string} prompt            User message content.
   * @param {import('./ChatBackend').BackendConfig} config  Backend configuration.
   * @param {string} [sessionId]       Optional session ID to resume.
   * @returns {Promise<ClaudeAgentBackend>}
   */
  async start(streamId, prompt, config, sessionId) {
    if (this.activeStreams.has(streamId)) {
      throw new Error(`Stream already active: ${streamId}`);
    }

    const backend = new ClaudeAgentBackend();
    if (sessionId) {
      await backend.resume(sessionId, config);
    } else {
      await backend.start(config);
    }

    this.activeStreams.set(streamId, {
      backend,
      sessionId: sessionId || null,
    });

    await backend.send({ content: prompt });

    return backend;
  }

  /**
   * Cancel an active stream. Safe to call for unknown streamIds (no-op).
   * @param {string} streamId
   */
  cancel(streamId) {
    const entry = this.activeStreams.get(streamId);
    if (!entry) return;
    try {
      entry.backend.cancel();
    } catch (err) {
      console.error(
        `[AgentBackendManager] Error cancelling stream ${streamId}:`,
        err
      );
    }
  }

  /**
   * Remove a stream from the active map and close its backend.
   * Should be called after the stream's events have been fully drained.
   * @param {string} streamId
   * @returns {Promise<void>}
   */
  async cleanup(streamId) {
    const entry = this.activeStreams.get(streamId);
    if (!entry) return;
    this.activeStreams.delete(streamId);
    try {
      await entry.backend.close();
    } catch (err) {
      console.error(
        `[AgentBackendManager] Error closing stream ${streamId}:`,
        err
      );
    }
  }
}

// Singleton instance — most callers should use this; the class is also
// exported for testing or in case multiple isolated managers are needed.
const agentBackendManager = new AgentBackendManager();

module.exports = {
  AgentBackendManager,
  agentBackendManager,
};
