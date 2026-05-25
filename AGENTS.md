# AGENTS.md — Sam's OpenWhispr Fork (Orientation)

> Orientation header for any AI agent (Claude Code, Codex, etc.) working in this
> repo. `CLAUDE.md` carries this same header followed by the full upstream
> **technical reference** (architecture, IPC, meeting detection, model registry).
> Read this first to understand *why this fork exists and how we work in it*;
> drop into `CLAUDE.md` for *how the code is built*.

## What this repo is

This is **Sam Barton's fork** of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) —
an Electron dictation + meeting-transcription app — extended to feel like a
native part of **Calyx / the PlatosRaveCave vault** rather than a standalone tool.

- **Fork (origin):** https://github.com/shbarton/openwhispr
- **Upstream:** https://github.com/OpenWhispr/openwhispr
- **This clone:** `~/Documents/GitHub/openwhispr`

## Project tracking lives in the vault — read it before you build

All planning, task specs, progress logs, and design decisions for this fork live
in the **PlatosRaveCave vault**, not in this repo:

- **Project hub:** `~/Desktop/PlatosRaveCave/projects/openwhispr/index.md` → `[[OpenWhispr — Fork + Wrapper]]`
- **Progress log:** `~/Desktop/PlatosRaveCave/projects/openwhispr/progress.md`
- **Task specs:** `~/Desktop/PlatosRaveCave/projects/openwhispr/tasks/<task-slug>/index.md`
- **Architecture contracts:** `~/Desktop/PlatosRaveCave/projects/openwhispr/docs/` (e.g. `vault-meeting-spec.md`, `settings-plan.md`)

Before starting work: open the project hub and the relevant task's `index.md`.
The task files contain scout/Codex review findings, blockers, and resolved
design decisions you should not re-derive.

## The three-layer strategy (how to decide where a change goes)

1. **Stock OpenWhispr behavior** — use as-is. Don't reskin, don't fight it.
2. **Fork-only patches** — features we need that aren't upstream. Each lives on
   its own branch in the fork. **No upstream PRs** (deferred indefinitely as of
   2026-05-13). Stay current by merging `upstream/main` into our branches.
3. **Sam-specific wrapper** — Chiron frontmatter, PlatosRaveCave paths, vault
   autocomplete. Prefer building this **outside** the OpenWhispr tree (a small
   post-processor that watches the output dir) to avoid merge pain.

Order of preference: try stock → missing? fork patch → vault-shaped & idiosyncratic? wrapper.
**Never fork wholesale, never PR upstream.**

## Fork workflow

```sh
git fetch upstream
git checkout main
git merge upstream/main   # stay current
git push origin main
```

Feature work goes on its own branch (e.g. `feat/meeting-byok-deepgram-v2`),
pushed to `origin` (the fork). Current working branch as of this writing:
`feat/meeting-byok-deepgram-v2`.

## Build / dev notes

- `npm run dev` rebuilds native helpers every run (idempotent, fast after first compile).
- First run downloads ~300MB of binaries (qdrant, AEC helper, MiniLM ONNX, etc.)
  into `~/.cache/openwhispr/`; later runs reuse the cache.
- **Use Node 24** for `npm install` (matches CI / `.nvmrc`). A different major
  version produces an incompatible `package-lock.json` that breaks `npm ci`.
- Onboarding has a "Continue without account" button (BYOK / local Whisper, no
  OpenWhispr Cloud account needed); persisted via `localStorage.skipAuth`.

## House rules

- **Don't reskin** OpenWhispr's shadcn UI into Calyx's Liquid Glass — that was a
  Calyx-only investment. Calyx *visual alignment* (tokens, typography) is a
  separate, deliberate track of tasks; cosmetic reskinning is not.
- **Wrapper before fork.** Default to building outside the tree.
- The vault is the source of truth for *planning*; this repo's git log is the
  source of truth for *what changed*. Keep `progress.md` updated with *why*.

## Where to go next

The full architecture map — process model, IPC handlers, meeting detection
engine, model registry, native helpers, semantic search, platform notes — is in
**`CLAUDE.md`** (below this header in that file). Start there for any code-level work.
</content>
</invoke>
