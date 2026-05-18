/**
 * binaryResolver - Resolve the full path to the `claude` CLI binary.
 *
 * Electron's main process may not have ~/.npm-global/bin on PATH when launched
 * from Finder/Spotlight, so we probe common locations and fall back to a
 * login shell. Result is memoized; the cache invalidates when the
 * user-configured override path changes.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let resolvedClaudePath = null;
/** Tracks the configured override so we can invalidate the memo if it changes. */
let resolvedFromConfiguredPath = null;

const COMMON_LOCATIONS = [
  `${process.env.HOME}/.npm-global/bin/claude`,
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  `${process.env.HOME}/.local/bin/claude`,
  `${process.env.HOME}/.bun/bin/claude`,
];

function isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    // Single syscall: check that it's a regular file with any execute bit set.
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to the `claude` CLI executable.
 *
 * @param {object} [opts]
 * @param {string} [opts.configuredPath] - User-configured path from settings.
 * @returns {string|null} Absolute path, or null if we couldn't find it.
 */
function getClaudePath(opts = {}) {
  const configured = (opts.configuredPath || "").trim() || null;

  // Memoization: invalidate if the configured path changes.
  if (resolvedClaudePath && configured === resolvedFromConfiguredPath) {
    return resolvedClaudePath;
  }
  resolvedFromConfiguredPath = configured;

  // 1. Honor configured path
  if (configured && isExecutableFile(configured)) {
    resolvedClaudePath = path.resolve(configured);
    console.log(`[ClaudeCLI] Using configured path: ${resolvedClaudePath}`);
    return resolvedClaudePath;
  }

  // 2. Probe common locations directly (no shell)
  for (const candidate of COMMON_LOCATIONS) {
    if (isExecutableFile(candidate)) {
      resolvedClaudePath = candidate;
      console.log(`[ClaudeCLI] Found at common location: ${resolvedClaudePath}`);
      return resolvedClaudePath;
    }
  }

  // 3. Last resort: ask a login shell. Wrapped in try/catch since the shell
  //    or `which` may not exist on every system.
  try {
    const out = execSync("which claude", {
      shell: "/bin/zsh",
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ""}:${process.env.HOME}/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin`,
      },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    })
      .toString()
      .trim();
    if (out && isExecutableFile(out)) {
      resolvedClaudePath = out;
      console.log(`[ClaudeCLI] Resolved via login shell: ${resolvedClaudePath}`);
      return resolvedClaudePath;
    }
  } catch {
    // ignore
  }

  resolvedClaudePath = null;
  console.warn("[ClaudeCLI] Could not resolve `claude` binary path");
  return null;
}

/**
 * Reset the memoized path. Useful for tests or if the user updates settings.
 */
function resetCache() {
  resolvedClaudePath = null;
  resolvedFromConfiguredPath = null;
}

/**
 * Best-effort check of the CLI version. Returns null if anything fails.
 *
 * @param {string} binaryPath
 * @returns {string|null} Semver-ish version string, or null.
 */
function getClaudeVersion(binaryPath) {
  if (!binaryPath) return null;
  try {
    const out = execSync(`"${binaryPath}" --version`, {
      env: {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME,
      },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })
      .toString()
      .trim();
    // Output typically looks like: "1.2.3 (Claude Code)"
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : out;
  } catch {
    return null;
  }
}

module.exports = { getClaudePath, getClaudeVersion, resetCache };
