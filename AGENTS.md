# Repository Instructions

This repository contains `obsidian-getnote-importer`, a TypeScript Obsidian plugin that syncs GetNote notes into a local Obsidian vault.

## Mandatory GitHub Workflow

- Never push directly to `main`.
- All code, workflow, documentation, release, and automation changes must go through a pull request targeting `main`.
- Work on branches prefixed with `codex/` unless the user explicitly asks for a different branch name.
- After pushing a branch, create a pull request and share the PR URL.
- Merge only after required checks pass and the user explicitly approves the merge.
- If the user says "提交", interpret it as commit and push the current feature branch, not direct push to `main`.
- If the user says "merge", confirm whether they mean merging an existing PR unless they explicitly say to bypass PR.

## Project Shape

- `src/main.tsx` wires the plugin lifecycle, commands, settings, and sync history.
- `src/sync.ts` owns GetNote-to-vault sync behavior and must be treated as high risk.
- `src/api.ts`, `src/note-parser.ts`, and `src/types.ts` contain API parsing and shared contracts.
- `src/ui/` and `src/settings/` contain Obsidian modal and settings UI implemented with Preact-compatible React APIs.
- Tests live in `tests/` and adjacent `src/*.test.ts` files.

## Required Checks

Run these before proposing a pull request or claiming a fix is complete:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run this after editing GitHub Actions workflows:

```bash
actionlint
```

## Engineering Rules

- Keep changes small and scoped to the issue or review comment.
- Preserve existing Obsidian vault data. Do not overwrite user notes unless the existing sync contract explicitly allows it.
- Be careful with GetNote IDs and timestamps. Large numeric IDs may exceed JavaScript safe integer precision, so prefer string-preserving parsing and comparisons.
- Add or update focused tests for sync, parser, settings, modal, or i18n behavior changes.
- Do not bump `package.json` or `manifest.json` versions unless the task is explicitly about releasing.
- Release artifacts are `main.js`, `manifest.json`, and `styles.css`.

## Local Memory

- Keep claude-mem or other dynamic session memory out of tracked repository files.
- Local claude-mem context for this workspace should be written to `.claude-mem-context.md`, which is ignored by Git.

## Project Handover (fork-specific, read before any non-trivial task)

This fork's full working context — current progress, deadly gotchas, API data shapes, architecture, and the prioritized task list — lives in **`HANDOVER/README.md`** (start there, then `HANDOVER/GOTCHAS.md`, `HANDOVER/PENDING.md`, `HANDOVER/API_NOTES.md`, `HANDOVER/ARCHITECTURE.md`). It is the source of truth for project state as of 2026-08-11.

Key fork facts not in the original author's docs above:
- Plugin renamed to `dedao-kb-sync`; builds with **Node 22** (`node esbuild.config.mjs`), not Bun.
- Repo: `https://github.com/leschamy4-del/obsidian-dedao-kb-sync.git` (git-initialized, MIT fork of AndyZhengyan/obsidian-dedao-brain-sync).
- Never commit `data.json` (holds the owner's API token) — add it to `.gitignore`.
- The owner's outstanding request is transcript backfill: verify the "按知识库同步" ribbon button backfills `### 原始录音转写` into ~625 existing `recorder_audio` notes (currently only 3).
