# Grouped documentation navigation

> Approved direction: the user selected "grouped areas" on 2026-10-11. Continue the previously authorized Linus / TDD implementation in the existing worktree. This is an implementation checklist, not a new approval gate.

**Goal:** Make the complete documentation easy to scan through three reading areas with visible topic groups, clear localized labels, and reliable navigation.

**Architecture:** Adapt the existing Fumadocs page tree and native layout extension points. Keep current URLs and content bodies. Use one navigation definition for ordering, short labels, and overview links where practical. Preserve page references, API detail reachability, the top-tab grid correction, and all eleven locales.

**Tech stack:** Bun, React Router, Fumadocs 16.17.1, Tailwind, existing Bun tests and Playwright. No new dependencies or runtime changes.

**Spec:** User-approved first direction in `/Users/munmunmiao/.codex/visualizations/2026/10/10/01a125f7-91f5-76f0-adc1-e1c0ef170b9a/navigation-research-2026-10-11/recommendation.md`. Supporting content and framework audits are in that directory.

**Constraints:** Work only in `/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`; preserve all existing uncommitted migration work. No commit, push, deployment, dependency upgrades, library changes, or broad technical-content rewrite. Do not constrain the design to a particular reader persona.

## Selected structure

- Reading areas: Guide / Operation examples / API reference. Their targets are the existing `/docs`, `/recipes`, and `/api` indexes, with locale prefixes.
- Guide groups: Getting started (Project overview, Quick start); Calls and contracts (Data contract / Struct, Definition and execution / Command, Client configuration / Client); Requests and realtime communication (HTTP requests, SSE event streams, WebSocket sessions); Errors and interception (Error handling, Interceptors); Frameworks and observability (React, Vue, OpenTelemetry). Design decisions is a standalone final link, with no redundant parent folder.
- Examples: HTTP (Send JSON, Handle a declared 404, Cancellation and timeouts, ETag conditional requests, GraphQL requests); Authentication (Refresh the token after a 401); Realtime communication (Consume an SSE event stream, Manage a WebSocket session); Testing and wrapping (Local HTTP tests, Wrap an HTTP SDK).
- API: API index, core modules, integration packages. Keep all 170 symbol detail pages reachable through the existing module/index structure; do not flatten symbols into the guide sidebar.
- Replace the permanent generic chapter-contents sibling with the complete guide overview reached through the reading-area entry. Include all integrations in the overview. Keep the homepage as project introduction.
- Ordinary labels are localized; technical identifiers remain accurate. Use OpenTelemetry, with outbound-observation wording where a summary is needed. Unify example terminology. Preserve guide/example/API crosslinks, ensuring related API links are not truncated away.

## Implementation tasks

- [x] **1. Navigation contract, red then green.** Extend focused navigation tests to cover actual content-tree completeness across all locales, group order, unique current items, explicit references that resolve, unchanged URL sets, and explicit area-index destinations. Observe the expected failure before production changes. Implement the smallest shared tree adaptation, metadata changes, and localized labels.
- [x] **2. Complete overview and related navigation.** Make guide and example indexes reflect the approved structure and include every existing relevant article. Reuse the same model where practical. Preserve useful guide/example/API paths and precise API identifiers. Check breadcrumb and previous/next ordering against the grouped tree.
- [x] **3. Semantics and mobile interaction, red then green.** Add named navigation regions, heading semantics for visible groups, and `aria-current` for current location. Use existing native primitives and minimal extension points for mobile Escape, initial focus, containment, and focus restoration. Provide basic same-source mobile navigation when JavaScript is disabled. Preserve the top-tab grid fix and real content hit targets.
- [x] **4. Integrate and verify.** Run relevant unit, type, lint, formatting, build, link, and browser checks; then the repository verification command required for the completed change. Verify desktop, 835px, 390px, the 767/768 breakpoint, RTL, long labels, deep links, refresh/back, reading-area switching, search, API details, keyboard interactions, and no-JS navigation. Independently inspect the actual page the user reviewed. The complete command was executed but failed at the Core browser session entry; all constituent checks passed separately. See the explicit environment limitation below.
- [x] **5. Review and hand over.** Review the incremental change, fix material findings with focused regression evidence, record exact commands/results and limits, and refresh the existing preview. Verify the original checkout remains unchanged. Leave changes uncommitted.

**Final verification status:** The navigation implementation and its reviews are complete. Three complete `bun run verify` attempts exited 1 before Core Chromium tests started. Protocol and listener evidence show Chromium reached another workspace's IPv6 listener on the same localhost port and received HTTP 404. Core passed separately (99 files / 1780 tests), and all remaining workspace tests, root build/type checks, final documentation browser tests, and independent visual checks passed without configuration changes. This does not constitute a successful complete `verify` run; see [the verification record](../verification/2026-10-11-grouped-navigation.md).

**Review focus:** No lost or duplicate routes; no stale build accepted as fresh evidence; translated labels consistent with article meaning; visible short groups; API symbol details still reachable; no overlay hiding content; no keyboard trap or inaccessible mobile drawer; no unrelated migration rewrites.

**Evidence:** Store raw red/green and browser results in `.superpowers/sdd/2026-10-11-grouped-navigation/`, with a concise final record in `docs/superpowers/verification/2026-10-11-grouped-navigation.md`. Previous migration evidence remains separate.
