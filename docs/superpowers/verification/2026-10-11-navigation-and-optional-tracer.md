# Menu Hierarchy and Optional Tracer Verification Record

Date: 2026-10-11. Workspace: `/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`, branch `codex/fumadocs-migration`. Kept the previously uncommitted Fumadocs migration and grouped-navigation changes.

**Implementation and this round's related checks are complete; the full `bun run verify` still does not pass.** This round's full command timed out during the Core Firefox session connection phase; the detailed boundary is below. Nothing was committed, pushed, or deployed.

## Actual Changes

- Kept the selected section grouping: group titles use bold text and a light background, and child items add logical indentation and a thin guide line; design decisions keep an independent position, and API symbols keep the native directory depth. Desktop, the mobile drawer, and the no-JavaScript table of contents use the same hierarchy rules, and RTL uses logical direction properties.
- `OpenTelemetryServerOptions.tracer` is now optional. When omitted, no local span is created, the global tracer is not obtained implicitly, and span hooks are not called; passing `meter` alone still records HTTP, SSE, and WebSocket metrics.
- When there is no local span, the extracted parent context continues to be propagated, and the parent span is neither modified nor ended. WebSocket query propagation still must be enabled explicitly.
- When a tracer is provided explicitly, the original `requireParentSpan` behavior is kept: if there is no active parent span, the entire instrumentation is skipped. When the tracer is omitted, that option does not prevent metric recording.
- The object argument of `withOpenTelemetryServer(options)` is still required; `withOpenTelemetryServer({ meter })` or `{}` may be used. Initialization and lifecycle of the SDK, provider, and exporter remain the application's responsibility.
- The README and 77 guide/API pages in 11 languages were updated in sync, including an example that passes only the meter. The generated library declarations confirm they contain `tracer?: Tracer`.

This round added no dependencies, did not modify production code of other libraries, and did not lower coverage requirements. The navigation implementation touches only existing components and CSS; OpenTelemetry production changes are concentrated in options and three transport interceptors.

## TDD and Content Retention

Navigation first reproduced, in Chromium and Firefox, parent and child text starting at the same position: at least 12px of logical indentation was required, the actual value was 0px, and four regressions failed; after implementation, four items and 50 assertions passed.

The OpenTelemetry runtime RED was 23 failed / 102 passed, showing that reading `startSpan` threw when the tracer was absent, or that metrics were incorrectly skipped; the type RED was 13 errors that the tracer was required. After implementation, the full package's 204 tests passed, and all four coverage measures were 100%. The regression uses a real W3C propagator and covers parent context, baggage, empty context, startup-failure and termination branches of each transport, metric counts, and retention of the original errors/results.

Added `approvedProseRevision` to record the 22 primary bodies authorized for modification this time; tests continue to compare the current body with the approved hash. An independent check confirmed: every field of the 385 original migration records is fully retained, and only these 22 revision entries were appended; these pages were not excluded from the content-protection tests. Both the original migration hashes and the hashes approved this time are traceable.

## Final Checks This Round

| Check                                           | Exit status and result                                                                                                                                                                                       | Log                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `bun run typecheck`                             | 0; root project 250 files, docs project 65 files; 1056 complete examples, 83 distinct contexts, 2442 explicitly classified snippets/signatures; the input union covers the whole repository's TS/TSX/MTS/CTS | `optional-tracer/typecheck-final.log`                   |
| `bun run lint`, `bun run fmt:check`             | both 0                                                                                                                                                                                                       | `optional-tracer/lint-final.log`, `fmt-final.log`       |
| `bun run --filter '@defjs/*' build`             | 0; JS and declaration builds for four libraries passed                                                                                                                                                       | `optional-tracer/libraries-build.log`                   |
| OpenTelemetry full package tests                | 0; 10 files, 204 tests; Statements 277/277, Branches 219/219, Functions 55/55, Lines 252/252                                                                                                                 | `optional-tracer/package-green.log`                     |
| Docs unit tests                                 | 0; 12 files, 30 tests, 17072 assertions                                                                                                                                                                      | `navigation-hierarchy/unit-final.log`                   |
| Docs static build and link check                | 0; link check passed for 2279 generated pages                                                                                                                                                                | `navigation-hierarchy/build.log`                        |
| Docs full browser verification                  | 0; Chromium/Firefox together 13 tests, 2176 assertions, 5 files                                                                                                                                              | `navigation-hierarchy/site-final.log`                   |
| Content history, build, and preview consistency | 0; 385 original records were not rewritten, 22 revision hashes match; both target preview pages returned HTTP 200                                                                                            | `optional-tracer/final-integrity.log`                   |
| This round's full `bun run verify`              | **1**; Core finished 94/99 files and 1715 tests, and another 5 Firefox files had not started; session connection timed out                                                                                   | `optional-tracer/verify-final.log`, `verify-final.exit` |

The short log names in the table correspond to `.superpowers/sdd/2026-10-11-optional-tracer/` and `.superpowers/sdd/2026-10-11-navigation-hierarchy/`. After this verification record was written to disk, a format check and a final diff check were run separately; they do not change product inputs.

## Limits of the Full Verify

Before execution, a check found no process listening on TCP 63315, so one unmodified full `bun run verify` was run again. During the run, two listeners appeared on that port: this workspace's Core tests listened on IPv6, and another workspace, `/Users/munmunmiao/.cache/lyz-plan/p5b-sim/web`, listened on IPv4. The full command finally reported a `core-browser (firefox)` session connection timeout, lasting about 120 seconds, then exited 1.

This round confirmed the timeout and the concurrent listeners, but did not capture that session's protocol response, so port contention is not treated as the proven sole cause of this failure. The earlier independent port investigation is recorded in [grouped navigation verification](2026-10-11-grouped-navigation.md). Other workspaces' processes were not terminated and the test configuration was not changed, and passing individual checks was not presented as success of the full command. This round's full command exited during the Core phase; the other checks in the table come from final commands run separately this round.

Evidence: [port check before the run](../../../.superpowers/sdd/2026-10-11-optional-tracer/port-final.log), [listeners and working directories during the run](../../../.superpowers/sdd/2026-10-11-optional-tracer/port-during-verify.log).

## Independent Review and Preview

The final read-only review found no blocking defects. It checked the no-tracer lifecycle, parent context propagation, metric independence, compatibility behavior, public documentation, menu keyboard behavior and RTL, and retention of the original content hashes. See [review report](../../../.superpowers/sdd/2026-10-11-optional-tracer/final-review.md).

Both the implementer and the main thread actually viewed the five final screenshots: [835px Chinese](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/desktop.png), [390px phone drawer](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/mobile.png), [RTL](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/rtl.png), [768px German long labels](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/german.png), [API directory depth](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/api.png). These scenes showed no horizontal overflow, occlusion, or drawer overflow.

Source, static artifacts, and the resident preview share the same fingerprint: `4ba1e5a1d5a3a0c5d1788b22c3b9c9b5ba2d9f220da10f865e88274fed784e53`.

Local preview: [menu](http://localhost:64246/zh-Hans/docs/design-decisions), [OpenTelemetry guide](http://localhost:64246/zh-Hans/docs/integrations/opentelemetry-server). The original checkout still has only the original four untracked migration-preparation documents; this round did not change them.

A real SDK/exporter/collector, production deployment, Safari, a real phone, or a screen reader was not verified. A whole-repository Bun type check is not the same as static type checking of Vue templates or complete MDX templates; the completed docs build and browser verification scope is as above. The build keeps the existing TS7 API experimental hints, React directives, and docs build warnings, and was not described as a warning-free build.
