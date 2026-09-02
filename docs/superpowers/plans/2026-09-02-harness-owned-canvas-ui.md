# Harness-Owned Canvas UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Canvas chat message and composer visual come from the current DeepSeek Harness UI implementation, leaving this plugin responsible only for Canvas orchestration, session binding, and Loom-specific actions.

**Architecture:** Keep the multi-session Canvas shell and its session-addressed adapters, because Harness's public UI is registered through scoped slots for the active session. Replace the vendored chat/input implementation with the latest Harness source and preserve only the adapter code required to mount that official implementation against each Canvas session. Remove standalone plugin-owned message rendering from the Canvas message path.

**Tech Stack:** React 18, TypeScript, Cordis, DSH alpha.4 client UI packages, Vitest, tsdown.

---

### Task 1: Synchronize the Canvas UI implementation with Harness

**Files:**
- Modify: `src/vendor/dsh-harness-chat/**`
- Modify: `src/vendor/dsh-harness-conversation/**`
- Modify: `src/vendor/dsh-harness-attachment/**`
- Modify: `src/vendor/dsh-input-trigger/**`
- Test: `tests/markdown-compat.spec.tsx`

- [x] Sync the vendored message, attachment, and composer source from the checked-out latest Harness packages.
- [x] Preserve no plugin-owned visual substitutions in assistant, user, tool, compaction, Markdown, or input rendering.
- [x] Update compatibility tests for the latest Harness props.

### Task 2: Keep Canvas-specific behavior in adapters only

**Files:**
- Modify: `src/client/NativeSessionSurface.tsx`
- Modify: `src/client/NativeComposer.tsx`
- Modify: `src/client/CanvasSessionWindow.tsx`
- Modify: `src/client/CanvasBranchAction.tsx`

- [x] Pass the latest Harness ChatView and InputBar standard/injected props through the Canvas session binding.
- [x] Keep Loom branch actions and Canvas layout outside the Harness message/composer components.
- [x] Remove any Canvas-owned component that renders a complete message or composer surface.

### Task 3: Prove the ownership boundary

**Files:**
- Modify: `tests/canvas-session-window.spec.tsx`
- Modify: `tests/canvas-overlay.spec.tsx`
- Create: `tests/harness-ui-ownership.spec.ts`

- [x] Assert Canvas mounts the Harness-owned ChatView/InputBar path and does not use the standalone CanvasMessage/InputBar implementations.
- [x] Run typecheck, focused tests, full tests, build, and pack verification.
