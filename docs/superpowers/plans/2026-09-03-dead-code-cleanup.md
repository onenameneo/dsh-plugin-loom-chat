# Dead Code Cleanup and npm Release Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unreachable vendored implementation code and keep generated type declarations limited to production entrypoints before releasing the next npm prerelease.

**Architecture:** Treat `src/client/index.ts`, `src/index.ts`, and `src/invariant.ts` as the package's production roots. Keep the vendored Harness modules required by the Canvas adapters, make the type-only Chat node registration reachable explicitly, and delete copied modules that have no production import path. Narrow the declaration build to the same roots so internal orphan declarations cannot enter the tarball.

**Tech Stack:** TypeScript, React, Vitest, tsdown, pnpm, npm.

---

### Task 1: Add source reachability regression coverage

**Files:**
- Create: `tests/source-hygiene.spec.ts`

- [ ] Write a test that walks `src/**/*.ts` and `src/**/*.tsx`, follows relative static imports from the three package roots, and fails when a production source file is unreachable.
- [ ] Run `pnpm test -- tests/source-hygiene.spec.ts`; expected: FAIL and list the currently orphaned vendored files.

### Task 2: Remove unreachable vendored implementation

**Files:**
- Modify: `src/vendor/dsh-harness-chat/contract/chat-nodes.ts`
- Delete: `src/vendor/dsh-harness-chat/chat-settings.ts`
- Delete: `src/vendor/dsh-harness-chat/chat/TurnProcessNodeView.tsx`
- Delete: `src/vendor/dsh-harness-chat/chat/TurnProcessNodeView.module.css`
- Delete: `src/vendor/dsh-harness-chat/contract/node-kinds.ts` only if its type augmentation is replaced; otherwise keep and explicitly import it.
- Delete: `src/vendor/dsh-harness-conversation/contract/composer-submission.ts`
- Delete: `src/vendor/dsh-harness-conversation/input/decorations.ts`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/ReferenceChip.module.css`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/ReferenceChip.tsx`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/chip-node.tsx`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/claim-decor.ts`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/composer-editor.module.css`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/projection.ts`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/span-map.ts`
- Delete: `src/vendor/dsh-harness-conversation/input/editor/text-ref.ts`
- Delete: `src/vendor/dsh-harness-conversation/stores.ts`
- Delete: `src/vendor/dsh-harness-conversation/submission-settings.ts`
- Delete: `src/vendor/dsh-harness-optional-modules.d.ts`
- Delete: `src/vendor/dsh-input-trigger/locales.ts`
- Delete: `src/vendor/submission-settings.ts`

- [ ] Import the retained `node-kinds.ts` module for type augmentation from `chat-nodes.ts` if needed by the compiler.
- [ ] Delete only files proven unreachable and leave all current behavior unchanged.
- [ ] Run the source hygiene test; expected: PASS.

### Task 3: Limit declarations to package roots

**Files:**
- Modify: `tsconfig.build.json`
- Modify: `tests/package-manifest.spec.ts` if needed to assert internal orphan declarations are absent.

- [ ] Change the build include list to the package roots while preserving transitive declarations required by public exports.
- [ ] Run typecheck and build; expected: exit 0.
- [ ] Run pack verification and inspect the tarball; expected: required public files present and deleted orphan declarations absent.

### Task 4: Commit and publish

- [ ] Review the diff and preserve unrelated pre-existing worktree changes.
- [ ] Bump `package.json` and lockfile to the next available prerelease version using the repository's release convention.
- [ ] Run full tests, typecheck, build, and pack verification after the version bump.
- [ ] Commit with a Conventional Commit message describing the cleanup.
- [ ] Publish the committed version with the configured public npm access and verify it from the registry.
