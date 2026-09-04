# Publishing Quality Adjustments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the DSH Web plugin package, pack verification, CI, and bilingual documentation with a publishable and auditable npm distribution.

**Architecture:** Keep the existing Web-only DSH plugin structure and prebuilt `lib/` package boundary. Make pack verification derive publishability from every leaf target in `package.json.exports`, while preserving the existing required/forbidden tarball checks. Add metadata, a minimal Node 22/pnpm 11 CI workflow, and matching English/Chinese documentation.

**Tech Stack:** Node.js ESM scripts, pnpm 11.7.0, TypeScript, Vitest, GitHub Actions, npm package metadata, Markdown.

---

## Chunk 1: Package manifest and export verification

### Task 1: Add regression coverage for published export targets and metadata

**Files:**
- Modify: `tests/package-manifest.spec.ts`
- Modify: `tests/plugin-architecture.spec.ts`

- [x] Add a generic test helper that recursively collects string-valued export targets from the manifest, including conditional exports.
- [x] Add a test asserting every collected target is a publishable relative path and is not under `src`, `openspec`, or `node_modules`; avoid asserting only the current `./src/*` key.
- [x] Add metadata assertions for the required keywords and optional author.
- [x] Run `pnpm vitest run tests/package-manifest.spec.ts` and confirm the export test fails against the current `./src/*` manifest.
- [x] Narrow the architecture boundary assertion so the required `deepseek-harness` keyword is not treated as an unpublished API dependency.

### Task 2: Fix the manifest and strengthen pack verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-pack.mjs`

- [x] Remove only the invalid `./src/*` export.
- [x] Add the required discovery keywords and `author: "onenameneo"`; preserve name, version, peer dependencies, DSH manifest, and package files.
- [x] Add a generic export-target verifier to `scripts/verify-pack.mjs` that checks every exact target exists in `package/package.json` tarball entries and every wildcard target matches at least one tarball entry.
- [x] Keep the existing required entries, forbidden development paths, manifest identity, and public `./client` checks.
- [x] Re-run the focused manifest test and `pnpm run pack:verify`.

## Chunk 2: CI and bilingual publishing documentation

### Task 3: Add continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] Configure pushes and pull requests to run on Ubuntu with Node 22.19.x.
- [x] Enable Corepack and pin pnpm 11.7.0 from `packageManager`.
- [x] Run frozen install, typecheck, test, build, and pack verification in that order.
- [x] Do not add release, tag, publish, or version-bump steps.

### Task 4: Document permissions and add restrained badges

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [x] Add CI, license, and static DSH Web Plugin badges beside the npm badge in both language versions.
- [x] Add matching Privacy & Permissions / 隐私与权限 sections based on the actual runtime boundary: no third-party data transmission, no API key/environment-variable reads, no shell execution, public DSH session/workspace/UI APIs, browser localStorage presentation metadata, and user-requested session operations.
- [x] Leave release/version state unchanged and keep publishing instructions consistent with the current package.

## Chunk 3: Verification and handoff

### Task 5: Run the full release-quality checks

**Files:**
- Verify: `package.json`, `scripts/verify-pack.mjs`, `tests/package-manifest.spec.ts`, `.github/workflows/ci.yml`, `README.md`, `README.zh.md`

- [x] Run `pnpm test` (18 files, 117 tests passed).
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Run `pnpm run pack:verify`.
- [x] Inspect `git diff` and `git status --short`; confirm no commit, tag, release, version bump, or unrelated source changes were made.
