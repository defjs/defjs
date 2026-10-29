# Fumadocs Migration Implementation Plan

> **For agentic workers:** Execute task by task with superpowers:executing-plans; use superpowers:subagent-driven-development only when the user separately chooses to implement subtasks. Checkboxes record formal implementation progress; all seven tasks have completed local acceptance in an isolated workspace, see [Acceptance Record](../verification/2026-10-10-fumadocs-migration.md).

**Goal:** Rebuild the docs site the native Fumadocs way, keep all content and languages, and provide an API module that presents types in one place plus repo-wide Bun checks.

**Architecture:** React Router + Vite static prerender, React/TSX site components, Fumadocs MDX content collections, and native UI. Use built-in static search and LLM output; reorganize pages from existing content as the source, and reuse the shared check logic.

**Tech Stack:** Bun 1.4.3, Fumadocs Core/UI 16.17.1, MDX 15.4.7, React Router 8.4.0, React 19.3.0, Vite 8.3.4, Tailwind CSS 4.3.3, root TS7, existing Oxfmt/Oxlint/Playwright.

**Spec:** [Development Spec](../specs/2026-10-10-fumadocs-migration-design.md). This plan replaces the same-day Starlight plan; before executing, read the verified results and open items in the spec.

## Global Constraints

- Rebuild the docs site using Fumadocs native organization. The existing site is only a content source; do not keep the old framework's directories, components, theme, syntax, routes, or anchor contracts.
- Keep knowledge write-ups, valid examples, API contracts, assets, and all 11 languages; reorganizing, merging, and splitting pages is allowed. Accept content completeness; do not require page counts, TOC entries, or layout to match the old site.
- Drop Twoslash type hover hints from ordinary docs; concentrate type information in the API module, with a lookup experience modeled on the Angular API.
- Use Bun for all repo-wide type checking, covering libraries, tests, scripts, config, site TS/TSX, and compilable docs TS/TSX examples.
- Remove explicit docs TS6/Twoslash dependencies; keep root TS7 so the existing tsdown can emit `.d.ts` for the four libraries.
- Deploy only at the root path of the production primary domain; do not keep compatibility for old URLs, old anchors, `.html`, or subpath deployment.
- Keep development, checks, and builds on the Bun run flow; do not introduce Node.js execution steps.
- The production domain and the check boundary for non-TS/TSX docs content follow section 7 of the spec; an unanswered item is not approval. Do not commit, push, or deploy without authorization.

## Review Focus

| High-risk input / condition                                                            | Expected behavior and owning task                                                                                                      |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Page merges, shared API notes, and translation drift                                   | Every piece of knowledge has a destination; page totals or English fallback cannot offset a loss. Tasks 2/4.                           |
| `.md` and `.mdx`, locale directories, nested URLs, direct refresh                      | Every final URL is prerendered and matches the content source; unknown paths are real 404s. Tasks 1/5/7.                               |
| Multi-file examples, hidden declarations, same-named files, and generic angle brackets | Extracted code stays faithful, contexts stay isolated, diagnostics point back to the source page; bad examples fail the check. Task 3. |
| Duplicate API names / slug collisions, empty filters, keyboard, and no JS              | Symbol identity stays stable, combined filters are correct, and the static catalog and details remain readable. Tasks 4/7.             |
| Static-search locale, LLM text of MDX components, generated types not ready            | Do not mix languages in search or emit empty docs; typegen runs before Bun checks, site tests run after the build. Tasks 5/6.          |

## File Responsibilities

| File / directory                                                               | Responsibility                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `doc/vite.config.ts`, `doc/react-router.config.ts`, `doc/tsconfig.json`        | Fumadocs/Vite plugins, static prerender, standalone TSX check config |
| `doc/app/root.tsx`, `doc/app/routes.ts`, `doc/app/app.css`                     | Global layout, routes, native theme                                  |
| `doc/app/lib/{source,i18n,routes,site}.ts`                                     | Content collection, languages, URL rules, production site info       |
| `doc/content/<locale>/{docs,recipes,api}/` and `index.md`                      | New-site source text, translations, navigation, and API content      |
| `doc/app/components/{mdx,api-index,api-reference,search}.tsx`                  | Native MDX components, API interaction, and static search            |
| `doc/app/data/api-catalog.ts`                                                  | Package/symbol identity, kind, slug, and related-type mapping        |
| `doc/app/routes/`, `doc/app/llms/`                                             | Content pages, API index, search assets, LLM assets                  |
| `doc/examples/`, `doc/scripts/{code-examples,check-examples}.ts`               | Example context and Bun checks                                       |
| `doc/scripts/{check-links,preview}.ts`                                         | Link checks for the new output and Bun static preview                |
| `doc/test/`, `doc/e2e/`                                                        | Pre-build unit/recipe tests, post-build browser tests                |
| Root/docs manifests, `bun.lock`, tsconfig, ignore rules, workflows, and README | Workspace integration, declaration build, CI, and delivery notes     |

Create files only for real responsibilities; small files may be merged reasonably. During execution, first protect user changes per the workspace isolation convention; do not copy the `/tmp` verification site straight into the repo.

## Task 1: Stand Up the Native Site and Static Routes

**Files:** Docs framework config, `app/root.tsx`, `app/routes.ts`, `app/lib/{source,i18n,routes,site}.ts`, baseline content, and workspace dependencies.

**Interfaces:** `ContentRoute` contains `locale`, `slugs`, and `url`; `getContentRoute(relativePath: string): ContentRoute` parses `content/<locale>/...` using native `getSlugs` / `createGetUrl`. `collectPrerenderPaths(): Promise<string[]>` enumerates body and asset routes. `doc typegen/build/dev` all run React Router explicitly through Bun.

- [x] Check the current branch and diff, and record a content-destination list for source text/sections, code, and assets. The list is for checking knowledge, not for constraining the new site layout.
- [x] Manually configure the stable dependencies from the spec; do not run scaffolding known to fail under Bun, and do not install `@fumadocs/base-ui`, OG, cloud search, or the devtools default packages.
- [x] Write assertions for the route map: English home `/`, Chinese `/zh-Hans/docs/start`, Arabic `/ar/docs/start`; both `.md` and `.mdx` are enumerated, and unknown languages and duplicate URLs fail.
- [x] Configure `parser:'dir'`, unprefixed default English, 11 languages, and disabled missing-translation fallback; the native page tree is split into Docs, Recipes, and API.
- [x] Add representative English/Chinese/Arabic pages, Tabs, and TypeTable; prerender every page plus the static-search and LLM routes.
- [x] Run `bun run --cwd doc typegen`, `bun check --project doc/tsconfig.json`, and `bun run --cwd doc build`; assert nested HTML and data assets exist, and that direct access does not depend on SPA fallback.

## Task 2: Keep All Content, Organized for the New Site

**Files:** `doc/content/`, `doc/app/lib/i18n.ts`, native navigation/theme; keep `doc/public/logo.jpg`.

**Interfaces:** The content-destination list is keyed by source-text/section identifiers and allows multiple targets; every new reference uses the route rules from Task 1.

- [x] First settle one complete set of English and Chinese tutorial/recipe/API pages in Fumadocs style, and confirm titles, code, Tabs, and links are correct.
- [x] Bring in every language, splitting and merging pages for the new information organization; convert framework-specific syntax, multi-file examples, and hidden context, and do not create an old-framework compatibility layer.
- [x] Check body text, examples, and shared notes against the content-destination list; every existing translation has a target, and hard-to-convert content must not be deleted without authorization.
- [x] Fill in UI translations, RTL, edit links, and brand info; remove template authors, test domains, and default demo content.
- [x] Build all content and check, per language, the section entry, language switch, and assets; the target page count is not a retention criterion.

## Task 3: Bring Docs Examples Under Bun Checks

**Files:** `doc/scripts/{code-examples,check-examples}.ts`, `doc/examples/`, `doc/test/code-examples.test.ts`, `doc/test/recipes.test.ts`.

**Interfaces:** `readCodeBlocks(source: string): CodeBlock[]` returns `language/code/info/line`; `collectExampleProjects(path: string, source: string): ExampleProject[]` returns page location, relative filename, code, and auxiliary files. The CLI exits non-zero for errors, empty input, and unclassified examples.

- [x] Write failing tests: three/four backticks and tilde fences, code inside MDX Tabs, fidelity of generics and `<>&`, and original info not dropped.
- [x] Write failing tests: same-named files in two independent examples do not contaminate each other; multi-file relative imports are correct; hidden declarations participate in checks but do not enter display/LLM output.
- [x] Implement extracting code from body text, resolving the new context map, and invoking Bun through source paths; stop keeping Twoslash control directives interpreted on an ongoing basis.
- [x] Correct TS/TSX exits 0; assigning a number to a string / a bad JSX attribute exits non-zero and points at the source page; errors unique to a translation and empty collections must also fail.
- [x] Explicitly classify signature sketches and incomplete fragments; dedupe only when code, auxiliary files, and compile context are all the same.
- [x] Migrate two real recipe runtime tests, still extracting and executing from the docs, and verify ETag `[200,304]` and Bearer `[401,200]`.
- [x] Handle non-TS Vue/MDX content only within the boundary confirmed in section 7 of the spec; until confirmed, mark it uncovered, and do not pretend templates are checked with a broad `.vue` declaration.
- [x] Run `bun test doc/test/code-examples.test.ts doc/test/recipes.test.ts` and the docs example check; expect every positive case to pass and every negative case to actually fail.

## Task 4: API Index, Details, and Type Display

**Files:** `doc/app/data/api-catalog.ts`, API components/routes, per-language API content, `doc/test/api-catalog.test.ts`.

**Interfaces:** `ApiEntry` contains `package/name/kind/slug/related`; `filterApiEntries(entries: readonly ApiEntry[], query: string, packageName: string, kind: string): ApiEntry[]`, where an empty string means no filter. Symbol identity does not depend on old anchors.

- [x] Check public exports against existing API knowledge and settle the new catalog; merging duplicate display items is allowed, but shared notes and already-public contracts must not be lost.
- [x] Write failing tests: case-insensitive query, package/kind intersection, no results, same-named symbols in different packages, slug collisions, and missing related types.
- [x] Implement details with the native TypeTable and signature code blocks, keeping complex generics, parameters/return values, descriptions, and examples; do not replace semantic review with an automatic generator.
- [x] Implement a statically readable catalog and React filtering, with accessible names and result feedback on inputs; do not concatenate input into `innerHTML`.
- [x] Test that the catalog matches content: every entry has real content in every language, and related types are navigable; do not bind a count assertion to the old 162 rows.
- [x] Run the catalog tests and the build, and accept one case each of `createClient`, `ClientOption`, `struct.parse`, and the React/Vue integrations.

## Task 5: Static Search, LLM, and Link Integrity

**Files:** `doc/app/components/search.tsx`, search/LLM asset routes, `doc/scripts/check-links.ts`, related unit tests, and the prerender enumeration.

**Interfaces:** Search uses the official `staticGET` and a static client; English `/llms.txt`, `/llms-full.txt`, and `/llms.mdx/<slugs>/content.md`. `checkLinks(directory: string): Promise<void>` fails on empty output, missing pages, and missing anchors.

- [x] Assert positive and negative search cases: English/Chinese/Japanese/Arabic can find representative content, and locale filtering does not mix in other languages; TypeTable data becomes readable index text, and result summaries do not expose raw JSX attributes.
- [x] Export the index and assets at build time and enumerate every asset path; the browser does not request a backend service that does not exist at deploy time.
- [x] Emit the English index, full text, and single pages from processed Markdown; provide meaningful text transforms for Tabs, TypeTable, and the API index.
- [x] Write export tests: visible code and signatures are kept, hidden declarations do not leak, the English full text does not mix in other languages, and internal asset links exist.
- [x] Reuse the shared HTML-file and anchor checks and drop old-theme coupling; test encoded paths, static assets, missing pages/anchors, and empty output.
- [x] Run this task's tests, the docs build, and the link check; check that direct HTTP reads of search, Markdown, and LLM assets succeed.

## Task 6: Repo-Wide Checks, Build, and Deploy Config

**Files:** Root/docs manifests, `bun.lock`, root/docs tsconfig, ignore rules, workflows, README; delete old-framework config that has been emptied by the migration.

**Interfaces:** Root `typecheck` order is `doc typegen → root bun check → doc bun check → check:examples`. Root `verify` is `lint → fmt:check → workspace test → build → doc test:site`; `build` still runs repo-wide typecheck first.

- [x] Configure input boundaries and JSX/aliases for the root project and the docs project; generated types come before checks, and examples reference library source rather than build output.
- [x] Compare Git-tracked TS/TSX/MTS/CTS with the union of the two Bun project inputs, and fail on omissions; exclude dependency/build/temp artifacts rather than dropping source.
- [x] Docs `test` is `bun test ./test`, and `test:site` is `bun test ./e2e`; the docs build does not call back into root typecheck, to avoid a cycle.
- [x] Remove docs TS6, Twoslash, and old-framework plugins; recheck remaining TypeScript sources in the lockfile, and keep TS7 declaration emit plus real example dependencies.
- [x] Change the release docs job to build the docs after root typecheck and upload `doc/build/client`; CI keeps the Chromium/Firefox install, and update ignore rules and the README.
- [x] Run repo-wide typecheck and the build, and check JS/`.d.ts` for the four libraries plus the new site output; do not change package publish targets or permissions.

## Task 7: Real Static-Site Acceptance and Handoff

**Files:** `doc/scripts/preview.ts`, `doc/e2e/site.test.ts`; fix real issues found in the earlier tasks.

**Interfaces:** The Bun preview serves only `doc/build/client` and returns 404 when a file is missing; browser tests close the server and the browser in `finally`, and fail when this build's output is missing.

- [x] Use Chromium/Firefox to verify opening and refreshing nested pages directly, unknown paths return 404, and assets do not depend on SPA fallback.
- [x] Verify the three reading sections, switching every language, RTL, the mobile menu, theme, search and API filtering, keyboard operation, and detail and type links.
- [x] With JS disabled, verify that body text and basic navigation stay readable; accept the real impact of console errors and build warnings.
- [x] Finish checks of content destinations, API contracts, type-check coverage, static assets, and links, and report non-TS format check results against the confirmed boundary.
- [x] Run the full `bun run verify` and wait for exit 0; if the existing Firefox timeout reproduces, locate and handle it, and do not skip that browser to fake a pass.
- [x] Check the final diff and deliver only this goal plus actual verification evidence; if the domain is missing or the check boundary is unconfirmed, keep that explicit, and do not claim production acceptance is complete.

## Implementation Handoff

The preparation phase delivers only the spec, the plan, and isolated verification; the user later explicitly asked for TDD development, and all seven tasks are done in the `codex/fumadocs-migration` isolated workspace. The original checkout stays unchanged. Full local verification and process deviations are in the acceptance record; the production domain is still not provided, and nothing has been committed, pushed, or deployed.
