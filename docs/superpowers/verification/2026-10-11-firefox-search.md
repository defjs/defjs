# Firefox Search Wait-Condition Fix

Date: 2026-10-11. Workspace: `/Users/munmunmiao/Documents/web/zen-kit`. This change only adjusts the documentation site's hydration marker and browser tests, preserving the workspace's existing Fumadocs migration and OpenTelemetry Logger changes.

## Root Cause and Evidence

### 1. Network idle does not mean the shortcut listener is already installed

The original test sent `Control+k` immediately after `page.goto(..., { waitUntil: 'networkidle' })`. The Firefox reproduction log shows that the page clock received Control and k at 786 ms and 826 ms respectively, when the number of registered `keydown` listeners was 0; listener installation was not complete until 1,080–1,092 ms. The first shortcut was lost and the search-dialog wait timed out. Pressing the keys again later on the same page opened the dialog normally.

This proves the test mistakenly treated network state as a signal that React hydration and passive effects had finished. This behavior also matches the [Playwright official hydration notes](https://playwright.dev/docs/navigations#hydration). The diagnostic listener count was used only for evidence gathering and is not a wait condition in the formal test.

Fix: `doc/app/root.tsx` sets `body[data-hydrated="true"]` in the Layout `useEffect`; site-wide interaction tests wait for that marker first. The current SearchProvider is a synchronous subtree of Layout, and its shortcut effect is installed before the Layout effect. Static HTML and reading without JavaScript are unaffected by this marker.

Original evidence: `.superpowers/sdd/2026-10-11-firefox-search/04-search-keys.log`.

### 2. The search navigation assertion was already satisfied on the original page

The old `waitForURL` only checked the language prefix; for example, `/zh-Hans/docs/start` already matched the condition before the search. After Fumadocs selects a result it closes the dialog immediately, and the target page's loader may still be in flight at that point. Both wait conditions passing does not mean navigation has completed.

The regression test blocks the `.data` request corresponding to the selected result: the browser remains on `/docs/start`, the old helper has already completed, and `expect(finished).toBe(false)` actually received `true`.

Fix: read the exact target URL from the `aria-selected` search result, and after sending Enter wait for that URL. The regression test requires the helper to stay pending while the loader is blocked, and to navigate to the selected target after the loader is released.

Original evidence: `.superpowers/sdd/2026-10-11-firefox-search/06-search-red.log`.

### 3. Old error records lose diagnostic information

After receiving a console event, the original test asynchronously `evaluate`d the arguments. A full-page navigation could destroy those JSHandles first, producing a secondary `Execution context was destroyed`. In addition, Firefox's native `Error.stack` contains only call frames, so selecting the stack alone loses the message; a newly added diagnostic test actually reproduced this difference.

Fix: synchronously convert the Error's name, message, and stack into strings inside the page, then have Playwright collect them and print them immediately to the test log, so a later assertion timeout does not drop this information. A two-browser regression verified that the original error message and named function call frames are still retained after a refresh. The original content of the React Router exception in the first full verify had already been lost, so it cannot be used to infer a specific React/Fumadocs defect, nor can that exception be claimed to have been reconstructed.

Original evidence: `.superpowers/sdd/2026-10-11-firefox-search/08-regressions-green.log` (5 passed, 1 Firefox diagnostic case failed).

## Verification

| Check                                               | Result                                                                                            | Log                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| Firefox search regression before the fix            | 2 failures, hitting the missing hydration signal and premature navigation completion respectively | `06-search-red.log`        |
| Documentation rebuild                               | exit 0; 2,279 page link checks passed                                                             | `07-build.log`             |
| Chromium + Firefox search and diagnostic regression | exit 0; 6 passed, 0 failed, 20 assertions                                                         | `09-regressions-green.log` |
| Full `bun run verify`                               | exit 0; documentation browser tests 21 passed, 0 failed, 2,240 assertions                         | `10-verify.log`            |

The full acceptance also passed lint, format checks, Core 1,780 / OpenTelemetry 274 / React 12 / Vue 14 tests and 100% coverage for each library, 32 documentation unit tests, type checks of 257 root-project files and 160 documentation-project files, 1,062 complete examples (86 distinct contexts), library and documentation builds, and 2,279 page link checks. The original Firefox site-wide case actually completed, taking 36.47 seconds; all documentation browser tests took 122.47 seconds. The final diagnostic test additionally checks named function call frames and was included in this full acceptance.

Independent code review confirmed the effect ordering and the exact URL wait; the discovered request-wait timeout, Firefox message loss, and stack-assertion gaps were all handled. Targeted lint, format checks, and documentation-project type checks of the finally modified files also passed.

Logs are all under the local `.superpowers/sdd/2026-10-11-firefox-search/`. No fixed delay, automatic retry, forced click, error filter, or browser skip was added; the original test timeouts and coverage scope were kept. No dependency was added and the OTel library implementation was not modified.

Remote CI, commit, push, and deployment were not performed.
