# Grouped Section Navigation Acceptance Record

Date: 2026-10-11. Plan: [Grouped Navigation Implementation Plan](../plans/2026-10-11-grouped-navigation.md). Workspace: `/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`, branch `codex/fumadocs-migration`. This increment uses the pre-implementation `before-navigation.tar.gz` as the baseline and keeps the previously uncommitted Fumadocs migration work.

**Delivery status: navigation implementation, content, and engineering review are complete, and every sub-check passed; the full `bun run verify` command did not pass as a whole.** The full command hit a local localhost port conflict before the Core browser tests started; the specific evidence and scope are below. Failures were not bypassed by changing configuration, closing the browser, or lowering the coverage threshold.

## Actual Behavior

- The three reading areas are fixed as "Guide / Operation Examples / API Reference", and enter the existing guide, examples, and API index respectively.
- The guide uses five visible groups: "Getting Started, Calls and Contracts, Requests and Real-time Communication, Errors and Interception, Frameworks and Observability"; "Design Decisions" is the last independent entry. Chinese short labels keep accurate technical names such as Struct, Command, and Client.
- Examples are organized by HTTP, authentication, real-time communication, and testing and wrappers; the API keeps module and integration-package categories, and the 170 symbol detail pages remain reachable.
- The static directories for the guide and examples include every article; related topics provide entries among the guide, examples, and module APIs, and do not truncate API links. The duplicate persistent "chapter contents" item was removed.
- The current reading area and article have explicit semantics; the mobile menu uses the existing Fumadocs/Radix components to complete initial focus, Tab containment, Escape, and focus return. Without JavaScript, a native directory and ordinary links are provided.
- All 11 languages were adjusted in sync; native breadcrumbs, previous/next pages, and API-symbol related links continue to use the existing tree. No group-level breadcrumb behavior was added.

No dependencies were added, no library source was modified, and the runtime was not replaced in this change. The implementation is concentrated in `doc/app/lib/navigation.ts`, `navigation-copy.ts`, `doc/app/components/navigation.tsx`, the shared page entry, and the corresponding content metadata and regression tests.

## Content Preservation and Review

An independent comparison of the pre-implementation snapshot and the final content: Markdown/MDX files are **2277** in both, with no additions or deletions; 275 files differ, of which body changes are limited to the **22 authorized rewritten guide/example directory pages**. After removing frontmatter, the remaining body text is byte-for-byte identical. The all-language real content-tree test also checks the URL set, page references, uniqueness, and that the source tree does not mutate.

Content review fixed the directory issue where "Design Decisions" was incorrectly placed in the framework list, and the French SDK label's over-commitment about release behavior. Engineering review fixed the missing API entry on the HTTP topic and the ancestor relationship of the native separator; in the end neither had remaining blocking findings.

Evidence: [content comparison](../../../.superpowers/sdd/2026-10-11-grouped-navigation/content-preservation.json), [engineering review](../../../.superpowers/sdd/2026-10-11-grouped-navigation/engineering-review.md), [process ledger](../../../.superpowers/sdd/2026-10-11-grouped-navigation/progress.md).

## Check Results

All of the following are local results on this final implementation; earlier migration acceptance was not used in place of this verification.

| Command or check                                                        | Exit status and result                                                                                                                             | Raw record                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `bun run lint`, `bun run fmt:check`                                     | both 0; the full verify also passed these two stages                                                                                               | `lint-green.log`, `fmt-final.log`, `verify-final.log`                                                       |
| `bun run --cwd packages/core test` (Playwright diagnostic logs enabled) | 0; 99 files, 1780 tests; all four coverage figures are 100%                                                                                        | `core-protocol-diagnostic.log` / `.exit`                                                                    |
| `bun run --cwd packages/opentelemetry-server test`                      | 0; 10 files, 180 tests; all four coverage figures are 100%                                                                                         | `remaining-opentelemetry-server.log` / `.exit`                                                              |
| `bun run --cwd packages/react test`                                     | 0; 4 files, 12 tests; all four coverage figures are 100%                                                                                           | `remaining-react.log` / `.exit`                                                                             |
| `bun run --cwd packages/vue test`                                       | 0; 4 files, 14 tests; all four coverage figures are 100%                                                                                           | `remaining-vue.log` / `.exit`                                                                               |
| `bun run --cwd doc test`                                                | 0; 12 files, 30 tests, 17072 assertions                                                                                                            | `remaining-doc.log` / `.exit`                                                                               |
| `bun run build`                                                         | 0; whole-repo type check, JS/declarations for four libraries, and the docs static build completed; link checks on 2279 generated HTML files passed | `final-build.log` / `.exit`                                                                                 |
| `bun run --cwd doc test:site`                                           | 0; Chromium/Firefox together: 9 tests, 2126 assertions, 4 files                                                                                    | `final-site.log` / `.exit`                                                                                  |
| Independent browser script                                              | 0; 8 page/size scenarios, no page or console errors, no full-page horizontal overflow                                                              | `independent-browser.ts`, `.log`, `.json`                                                                   |
| `git diff --check`                                                      | 0                                                                                                                                                  | local final diff check                                                                                      |
| Full `bun run verify` and two diagnostic re-runs                        | **all 1**; Core finished 94/99 files and 1715 tests, and another 5 Chromium files did not start; cannot be counted as complete success             | `verify-final.log`, `verify-final-diagnostic.log`, `verify-final-protocol.log` and their respective `.exit` |

Logs are in the locally ignored `.superpowers/sdd/2026-10-11-grouped-navigation/`. After the acceptance record and the plan were written to disk, those two files received a targeted format and a final format check, without changing product inputs.

The Bun check inside `bun run build` covers 250 TS files in the root project and 64 in the docs project; 1056 complete documentation examples were checked across 83 distinct contexts, and 2442 signatures/snippets were explicitly classified. The input-union check covers workspace TS/TSX/MTS/CTS. Static type checking of Vue templates and complete MDX templates is still not part of these results.

## Boundary of the Full Verification Failure

The first two full runs both exited after waiting 120 seconds at the Core Chromium session connection stage. After a standalone full-package Core run passed, the third full run enabled protocol logging and captured that **all 5 Chromium session entries returned HTTP 404 from `[::1]:63315`**, before any test script was loaded.

The successful Core sub-command was `DEBUG=pw:protocol,pw:api VITEST_PW_DEBUG=1 bun run --cwd packages/core test`; the final failing full command was `DEBUG=pw:protocol,pw:api VITEST_PW_DEBUG=1 bun run verify`. The intermediate full diagnostic used `DEBUG=vitest:browser:playwright,vitest:browser:pool VITEST_PW_DEBUG=1`, and the first run added no diagnostic variables. Diagnostic variables only add logs; they do not change test selection or coverage requirements.

A listener check at the same moment showed this test process listening on `127.0.0.1:63315` and a test process from another workspace listening on `[::1]:63315`. Requests to the same session URL with an explicit address returned 200 on IPv4 and 404 on IPv6. That evidence shows Chromium reached the other listening process; the underlying cause of address selection was not pursued further, and no external process was terminated and no test configuration was changed.

This leaves the final overall `verify` still in a failed state. The remaining workspace tests, the root build, and the docs browser tests were then run separately with the original commands and passed; sub-item results are not presented as success of the full command.

Evidence: [port investigation summary](../../../.superpowers/sdd/2026-10-11-grouped-navigation/port-conflict-evidence.md), [protocol responses for the 5 sessions](../../../.superpowers/sdd/2026-10-11-grouped-navigation/chromium-session-404.json).

## TDD and Final Browser Evidence

| Regression behavior                            | Failure observed first                                                                           | Result after implementation                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Real content-tree grouping and section entries | `tree-red.log`: expected five guide groups, actually zero                                        | `tree-green.log`; the final real content-tree contract passed for all languages                           |
| Static directory completeness                  | `overview-red.log`: expected five Markdown groups, actually zero                                 | `overview-green.log`; all integration and example entries retained                                        |
| Group semantics and mobile focus               | `semantics-red.log`, `mobile-red.log`: missing named navigation, focus stayed outside the drawer | `semantics-green-final.log`; the final dual-browser run passed again                                      |
| Directory without JavaScript                   | `ssr-directory-red.log`: a server-side trailing slash left the current-area directory empty      | `ssr-directory-green.log`; link navigation after actually disabling scripts passed                        |
| Independent placement of Design Decisions      | `standalone-red.log`: inherited the framework-group ancestor                                     | `standalone-green.log`; both renderers skip untitled separator marks                                      |
| Cross-links among guide, examples, and API     | `related-red.log`: the HTTP page lacked related API navigation                                   | `related-unit-green.log`, `final-site.log`; all-language target checks and dual-browser navigation passed |

The nested section menu has a close animation; the keyboard test waits until the actual option is hidden before verifying the outer Escape; the browser back test waits until the current item on the target page is committed before Back. There are no fixed delays, forced clicks, error filtering, or deleted failure assertions. The initial browser RED was explicitly against the old artifact; the final acceptance checked build freshness at both the start and the end.

Final build fingerprint: `66327e36c876bda89452ce6292f310d786dc6fd376a374a50c6635aefaae4984`.

The final dual-browser test covers switching among 11 languages, search, API filtering/details, theme, resources, direct/refresh/back, section switching, mobile forward and reverse Tab, Escape, focus return, closing the menu after selecting an article, the no-JavaScript directory, and related links.

The independent script additionally covers Design Decisions at 835px, the guide overview at 1440px, example/API details at 835px, Arabic at 1280px, German at 768px, and the 767/390px mobile breakpoints. The final screenshots at 835px, 390px, Arabic, and German were actually inspected, and no occlusion or label-layout issues were seen; the mobile screenshot waits for the drawer animation to finish and checks that its bounds are inside the viewport.

Screenshots: [835px menu](../../../.superpowers/sdd/2026-10-11-grouped-navigation/design-835-dark.png), [390px menu](../../../.superpowers/sdd/2026-10-11-grouped-navigation/mobile-390.png), [RTL](../../../.superpowers/sdd/2026-10-11-grouped-navigation/rtl-1280.png), [German long labels](../../../.superpowers/sdd/2026-10-11-grouped-navigation/long-labels-768.png).

## Delivery Scope

Local preview continues to use `http://localhost:64246/zh-Hans/docs/design-decisions` and reads the final static artifact. The original checkout `/Users/munmunmiao/Documents/web/zen-kit` still has only the original four untracked migration-preparation documents and was not changed in this work.

Nothing was committed, pushed, deployed, or run on remote CI. Safari, a real phone, and a real screen reader were not verified; the no-JavaScript acceptance is limited to reading and basic navigation and does not claim that search interaction works. The build keeps the existing `::highlight` optimization and the browser-module externalization warning, and the final dual-browser run had no runtime errors.
