# Bun-Only Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Changesets with a tested Bun-only, independently versioned package release workflow.

**Architecture:** A small Bun module validates protected package-version tags. A Bun-only packed-consumer test validates the exact tarballs. CI runs one repository verification gate; Release validates, builds, and publishes one selected package in one job.

**Tech Stack:** Bun 1.4.0, TypeScript, Bun test, Vitest, Playwright, GitHub Actions, npm registry.

**Spec:** `docs/superpowers/specs/2026-08-26-bun-release-workflow-design.md`

## Global Constraints

- Use Bun `1.4.0` only; do not add Node.js or Deno runtime commands or matrices.
- Publish packages independently from the selected package's built `dist` directory.
- Target `@defjs/core@0.4.0`; adapter Core peers are exactly `^0.4.0`.
- Preserve existing unrelated and user-authored working-tree changes.
- Do not commit, push, create tags, create a PR, or publish packages.
- Use `apply_patch` for hand-authored file edits.

---

### Task 1: Release target contract

**Files:**

- Create: `scripts/release-target.ts`
- Create: `scripts/release-target.spec.ts`

**Interfaces:**

- Produces: `parseReleaseTag(tag: string): ReleaseTarget`
- Produces: `validateReleaseManifest(target: ReleaseTarget, manifest: unknown): PackageManifest`
- CLI output: `package_key`, `package_name`, `package_dir`, `version`, `tarball_file`, and `core_version` in GitHub output format.

- [ ] Write table-driven Bun tests for all four valid tags, malformed or injectable tags, prerelease tags, wrong manifest names, and wrong manifest versions.
- [ ] Run `bun test scripts/release-target.spec.ts` and verify it fails because the module does not exist.
- [ ] Implement the static package map, stable SemVer parser, manifest validation, Bun manifest loading, and CLI output.
- [ ] Run `bun test scripts/release-target.spec.ts` and verify it passes.

### Task 2: Packed-consumer E2E contract

**Files:**

- Create: `scripts/verify-packed-consumer.ts`

**Interfaces:**

- Consumes: existing built `packages/*/dist` directories.
- Produces: deterministic tarballs in `test-out/packed-packages/` named `defjs-<package>-<version>.tgz`.

- [ ] Write the E2E with a static package table for Core, OpenTelemetry Server, React, and Vue. Use `Bun.file`, `Bun.write`, and `Bun.spawn`; do not import `node:*` modules.
- [ ] Recreate only the repository-owned `test-out/packed-packages` and `test-out/packed-consumer` directories, then run `bun pm pack --cwd <dist> --filename <absolute-deterministic-path>` for each package (`--destination` and `--filename` are mutually exclusive in Bun 1.4.0).
- [ ] Create a clean consumer manifest that installs the four tarballs plus `typescript@7.0.2`, `react@19.2.8`, `@types/react@19.2.17`, `vue@3.5.40`, `@opentelemetry/api@1.9.1`, and `@opentelemetry/core@2.10.0` with `bun install --ignore-scripts`.
- [ ] Assert each installed manifest has the source name/version, `./index.js`, `./index.d.ts`, no `workspace:`/`catalog:`, no `engines.node`, and no source-path exports. Assert all three adapters expose exactly `@defjs/core: ^0.4.0` as a required peer.
- [ ] Write and execute a strict TypeScript consumer that passes one Core client into the React and Vue APIs and resolves OpenTelemetry public declarations.
- [ ] Write and execute a Bun runtime smoke that imports all four packages, asserts their public functions, and completes one Core request through a standard `Request`/`Response` fake fetch.
- [ ] Run `bun run build && bun scripts/verify-packed-consumer.ts` before manifest corrections.
- [ ] Verify the E2E fails because adapters expose the stale `workspace:` Core peer or published packages retain the Node engine contract.

### Task 3: Package manifests and Bun build configuration

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.base.json`
- Modify: `packages/core/package.json`
- Modify: `packages/opentelemetry-server/package.json`
- Modify: `packages/react/package.json`
- Modify: `packages/vue/package.json`
- Modify: `packages/core/tsdown.config.ts`
- Modify: `packages/opentelemetry-server/tsdown.config.ts`
- Modify: `packages/react/tsdown.config.ts`
- Modify: `packages/vue/tsdown.config.ts`
- Modify: `bun.lock`

**Interfaces:**

- Consumes: Task 1 unit-test command and Task 2 failing E2E.
- Produces: `bun run verify`, `bun run test:release`, and `bun run test:packed` scripts.

- [ ] Remove Changesets catalog entries, development dependencies, and scripts; add `@types/bun@1.4.0` and the three verification scripts.
- [ ] Change adapter Core dev ranges to `workspace:^` and peer ranges to `^0.4.0`.
- [ ] Remove published `engines.node` declarations.
- [ ] Replace each `node:fs/promises` manifest writer with `Bun.file(...).json()` and `Bun.write(...)` without adding a shared abstraction.
- [ ] Switch the root TypeScript environment from direct Node types to Bun types.
- [ ] Run `bun install` to update `bun.lock`, then run `bun run typecheck`.
- [ ] Re-run `bun run build && bun scripts/verify-packed-consumer.ts` and verify it passes.

### Task 4: Simplified GitHub Actions and Changesets removal

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Delete: `.github/workflows/_checks.yml`
- Delete: `.changeset/`
- Create: `docs/releases/0.4.0.md`
- Modify: `README.md`
- Modify: `packages/core/README.md`
- Modify: `packages/opentelemetry-server/README.md`
- Modify: `packages/react/README.md`
- Modify: `packages/vue/README.md`

**Interfaces:**

- Consumes: Task 1 CLI outputs and Task 2 `bun run verify`.
- Produces: CI job `checks` and Release job `publish`.

- [ ] Consolidate pending Changesets prose into `docs/releases/0.4.0.md` before deleting `.changeset`.
- [ ] Reduce CI to one Bun verification job for pull requests and pushes to `main`.
- [ ] Implement exact tag triggers and one publish job that runs `bun ci`, validates the tag and manifest through `release-target.ts`, runs `bun --bun run build` for the selected package, and publishes from its `dist` directory.
- [ ] Expose `NPM_CONFIG_TOKEN` only to the `bun publish` step.
- [ ] Use action major-version references and rely on successful `main` CI plus repository release-tag and `npm` environment protection.
- [ ] Remove obsolete Changesets workflows, permissions, commands, and provenance settings.
- [ ] Replace stale Node/Deno matrix, Node engine, bundled-guide, and Changesets instructions in the repository and package READMEs with the Bun 1.4 packed-consumer and independent-tag flow.
- [ ] Run `bun test scripts/release-target.spec.ts`, YAML syntax inspection, and `rg -n -i 'changeset|node |deno |npm publish' .github package.json scripts packages`.

### Task 5: Final verification and review

**Files:**

- Review all files changed by Tasks 1-4.

- [ ] Run `bun ci` and confirm it leaves the tracked and untracked dependency state expected.
- [ ] Run `bun run verify` to completion and record exit status and test totals.
- [ ] Run `bun publish --dry-run --cwd packages/core/dist --access public` and the same command for each adapter.
- [ ] Inspect `git diff --check`, the scoped diff, and `git status --short`.
- [ ] Dispatch a whole-change code review, fix Critical or Important findings, and repeat the covering verification.

No commit step is included because repository commits were not authorized.
