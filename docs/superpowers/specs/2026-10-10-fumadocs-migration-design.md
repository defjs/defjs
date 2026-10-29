# Fumadocs Documentation Site Development Specification

Date: 2026-10-10. Repository baseline: `feat/up`, `d618396c88bc84645953684c0cb20feaae0f55a8`.

Status: Implementation and local acceptance are complete in an isolated workspace; this replaces the same-day Starlight specification. Verification from the preparation phase is retained as historical evidence. The current implementation and verification results are in the [acceptance record](../verification/2026-10-10-fumadocs-migration.md). Not yet committed, pushed, or deployed.

## 1. Goals and Confirmed Requirements

1. Rebuild the documentation site using Fumadocs' native organization. The existing site is only a content source; do not preserve the old framework's directories, components, theme, syntax, routes, or anchor contracts.
2. Keep knowledge explanations, valid examples, API contracts, assets, and all 11 languages; pages may be reorganized, merged, and split. Acceptance checks content completeness, and does not require page count, directory entries, or layout to match the old site.
3. Drop Twoslash type hover hints from ordinary documentation; concentrate type information in the API module, with a reading experience modeled on the Angular API.
4. Use Bun for type checking across the whole repository, covering libraries, tests, scripts, configuration, site TS/TSX, and compilable documentation TS/TSX examples.
5. Remove the documentation site's explicit TS6/Twoslash dependencies; keep root TS7 so the existing tsdown can generate `.d.ts` for the four libraries.
6. Deploy only at the root path of the official primary domain; do not provide compatibility for old URLs, old anchors, `.html`, or subpath deployment.
7. Keep development, checks, and builds on the Bun runtime flow, and do not introduce Node.js execution steps.
8. The preparation phase writes materials only; later, the user explicitly authorizes formal implementation with TDD. Implementation still does not include commit, push, or deploy.

## 2. Technical Choices Adopted This Time

The following are implementation defaults, and are not passed off as technical details the user specified item by item.

- The host uses React Router + Vite, pages use React/TSX, and content uses Fumadocs MDX. Emit a whole-site statically prerendered artifact, with no dependency on a long-running server.
- Use the stable `fumadocs-ui` package; do not use the `@fumadocs/base-ui` alias that the current scaffold selects automatically. The theme uses Fumadocs native components and Tailwind CSS 4.
- Continue using Oxfmt and Oxlint, and do not add ESLint, Biome, or Prettier. New React rules apply only to files the documentation site needs, and are not expanded into a repository-wide rules cleanup.
- Use Fumadocs' built-in ZBSearch static search, native Tabs, table of contents, navigation, and light/dark mode; do not add paid search, AI chat, dynamic OG images, a blog, a versioned site, or an interactive playground.
- The first API phase uses the existing handwritten explanations, signatures, and native TypeTable; index filtering is implemented with a small React component. `fumadocs-typescript` is not installed for now, and automatic extraction is not a precondition for considering the migration complete.
- LLM output uses the official `llms()` and processed Markdown capabilities, and does not install a separate Starlight/VitePress LLM plugin.

### 2.1 Verified Dependency Combination

| Dependency                                  | Version and purpose                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun                                         | 1.4.3; runtime, install, and type checking                                                                                                    |
| `fumadocs-core` / `fumadocs-ui`             | 16.17.1 / 16.17.1; versions stay aligned                                                                                                      |
| `fumadocs-mdx`                              | 15.4.7; content compilation and Vite integration                                                                                              |
| `react-router` / `@react-router/dev`        | 8.4.0 / 8.4.0; routing, type generation, and prerendering                                                                                     |
| `react` / `react-dom`                       | 19.3.0 / 19.3.0                                                                                                                               |
| `vite`                                      | 8.3.4; continue using the workspace version                                                                                                   |
| `tailwindcss` / `@tailwindcss/vite`         | 4.3.3 / 4.3.3                                                                                                                                 |
| `typescript`                                | Root 7.0.2; declaration generation, not used as the type-check entry                                                                          |
| Type definitions and UI helper dependencies | Add `@types/react-dom`, `@types/mdx`, `lucide-react`, and similar according to actual imports; do not copy every scaffold dependency verbatim |

During development, write into the Bun workspace catalog and lockfile, and do not set up a separate documentation TypeScript version. Install an optional peer only for an integration that is actually referenced. Vue and workspace packages may still be used by examples, and must not be deleted by mistake as old-theme dependencies.

The direct TypeScript dependency of `fumadocs-typescript@5.5.1` is `~7.0.2`, and the published metadata has been checked. But AutoTypeTable is aimed at object types and has limitations for functions, and the generation quality for this repository's complex generics has not yet been verified; it can be evaluated separately later, when automatic generation is explicitly requested.

## 3. Content Sources and New Site Structure

The preparation-phase baseline is 385 Markdown documents, 35 for each of 11 languages; the original API directory has 162 display entries and 130 content anchors. These numbers are used to discover missing content, and do not limit the new site's page count or API entry count.

Languages retained: `en-US`, `zh-Hans`, `zh-Hant-TW`, `zh-Hant-HK`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `ru-RU`, `ar`.

### 3.1 Content and Routes

- Use native directory-style i18n: `doc/content/<locale>/`, Fumadocs `parser: 'dir'`; the collection root is `content`.
- Default English URLs carry no language prefix; other languages add a prefix. Use `hideLocale: 'default-locale'`, implemented through static routes, without relying on middleware/cookies.
- The default entry is `/`, and the body is divided into `/docs/...`, `/recipes/...`, and `/api/...`; other languages, for example `/zh-Hans/docs/...`.
- Each area is organized through the native page tree and root-folder navigation, and does not replicate the old sidebar. Ordering and labels use `meta.json`, and existing UI translations are reused for the new features.
- Plain body text stays `.md`; use `.mdx` only when a component is actually required. Prerendering, content checks, and search all cover both extensions.
- Arabic pages set `lang` and `dir='rtl'`, and configure RootProvider's direction. Existing translations must not be replaced by an English fallback; during migration reconciliation, turn off missing-translation fallback so omissions are exposed.
- Keep the logo, edit entry, and related copyright information, and remove default content such as the scaffold author, the example repository, the unrelated home page, and external fonts.

For each source document, establish an internal record of where the content goes, which may be one-to-many or many-to-one. Preserve the semantics of the knowledge and the examples; when a stale explanation that conflicts with the public source is found, correct it from the source and record the correction. This record is for acceptance, and does not implement a runtime compatibility layer.

### 3.2 Examples and Components

- Change install commands to use Fumadocs Tabs; code highlighting, copy, and filenames use native capabilities.
- The 704 original Twoslash fences include TS/TSX and 33 Vue examples; 44 `@filename` entries and 11 `---cut---` entries are contextual clues that must be handled during conversion.
- In one pass, organize multi-file relationships and hidden declarations into the new check context; the new site and the long-term checker do not continue to simulate the Twoslash protocol, and do not display hidden declarations.
- The content-check context lives in `doc/examples/`, and stores only auxiliary content and mappings. Visible code on the page remains the sole source; do not save a separate handwritten copy and pass it off as the document being checked.
- Markdown/MDX extraction must preserve fence info, the original code, and line numbers. `meta.language` on the Bun Markdown callback cannot preserve the full info-string; this verified limitation must be handled by the extractor and the regression tests.

## 4. API Reading Experience

- `/api/` shows packages, symbol names, and categories; it supports case-insensitive name queries, combined package/category filtering, result counts, and empty-result feedback.
- An entry's identity is "package + original symbol name"; the route slug is specified explicitly, and conflicts are detected. Public exports and existing API knowledge must all have a destination, and copying the old 162-row directory verbatim is not required.
- Details show the signature, generics, parameters, return value, fields, explanation, examples, related types, and tutorial links. Functions and complex generics keep a readable signature; data suited to a table uses TypeTable.
- Explanations shared by multiple symbols may be kept as a module overview or a reference, so that splitting pages does not drop shared content or produce empty detail pages.
- Keep all existing translations; source code may only be used to verify technical facts, and must not be used to invent parameter explanations or translations.
- The static HTML already contains the directory and the details; JS only enhances filtering. Keyboard use, the no-results state, mobile, and basic reading with JS disabled all require acceptance.

## 5. Checks, Build, and Deployment

### 5.1 Repository-wide Bun Checks

The root `bun run typecheck` is the only repository-wide entry, and runs in order:

1. `bun run --cwd doc typegen`: use `bun --bun react-router typegen` to generate the types required by routes and content.
2. `bun check --project tsconfig.json`: check libraries, root scripts, tests, and configuration.
3. `bun check --project doc/tsconfig.json`: check documentation-app TS/TSX, configuration, scripts, and tests.
4. `bun run --cwd doc check:examples`: extract and check compilable TS/TSX examples in every language.

The documentation site has its own JSX, route-generation directory, and path-alias configuration, so the root tsconfig may hand `doc` to the documentation project for checking; this is not a missed check, and acceptance must verify the union of the two projects' inputs. The root configuration must include `.tsx`, and must not hide errors by excluding real source, `any`, `noCheck`, or `@ts-ignore`.

The temporary example project points `paths` at each library's source, and does not depend on `dist`. Code that differs across translations is checked separately; identical code is deduplicated only when the auxiliary files and the compilation context are also the same. Complete examples, signature sketches, and context fragments must have an explicit classification, and empty input and unclassified input cannot pass silently.

TSX type errors must have a probe that fails on purpose. MDX compiling successfully does not mean its component props have gone through static type checking; Vue code fences are not checked by Bun automatically either. See section 7.

### 5.2 Command Order

- The root `build` keeps "repository-wide typecheck → workspace build". `doc build` only runs `bun --bun react-router build` and the static-artifact checks, and does not call the root typecheck in reverse.
- Documentation `test` only runs `bun test ./test`, and does not require an existing build artifact.
- Documentation `test:site` runs `bun test ./e2e`, using the static artifact that was just built.
- Root `verify`: `lint → fmt:check → workspace test → build → doc test:site`. A missing build artifact from this run must fail; do not test old output.
- Continue using tsdown to generate JS/`.d.ts` for the four libraries; do not replace the library builder.
- Bun unit tests read ordinary TS data and content files; the Fumadocs macro module is loaded only through Vite, and cannot be treated as an ordinary module that can be evaluated directly in Bun.

### 5.3 Static Delivery

- Output is `doc/build/client/`. Every page, API detail, search asset, and LLM asset for every language must be prerendered; do not rely on an SPA rewrite to repair missing pages.
- Prerender enumeration uses the native `getSlugs` / `createGetUrl` and the shared i18n configuration; it must match the URLs generated by the Fumadocs content source. Verify direct access to nested paths and refresh of those paths.
- Search uses the `staticGET` export and a static client; the default built-in engine is ZBSearch. Filter results by locale, and accept Chinese, Japanese, and Arabic; do not copy the Orama plugin configuration from the old tutorial. API data must produce readable index text, and TypeTable's raw JSX properties must not become the search summary.
- Keep the English `llms.txt`, `llms-full.txt`, and per-page Markdown, and do not mix other languages into the English full text. Tabs, TypeTable, and the API index must have readable text output, and must not leave only JSX calls.
- Move the generic file/anchor logic of the existing HTML link check to `doc/scripts/check-links.ts`, and check the new output; do not keep the old theme selectors. Also check search, LLM, and asset links.
- Static preview uses Bun and serves only the output directory; when a file is absent, return a real 404. The build provides a usable 404 page.
- The documentation release job first runs `bun run typecheck` at the repository root, then builds the documentation, and uploads `doc/build/client`. Do not add release permissions or perform a deployment.

## 6. Pre-development Verification Evidence

Isolation directory: `/tmp/defjs-fumadocs-preflight.R5c6h5`. It is not the implementation directory, and the sample site is not copied in as the final product.

| Verification                          | Result and boundary                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official CLI                          | `create-fumadocs-app@16.2.18` fails under Bun 1.4.3. The root cause is that `fuma-cli@0.3.2` statically imports `node:module.findPackageJSON`, which Bun does not provide yet; it is not included in the formal workflow                                                                                                                                          |
| Manually configured static site       | The official React Router SPA template uses the stable packages from section 2. After removing OG/tooling dependencies that are not needed, `bun --bun react-router build` exits 0; it outputs HTML, search, and LLM static assets                                                                                                                                |
| Bun type check                        | `bun --bun react-router typegen && bun check --project tsconfig.json` exits 0, checking 26 files                                                                                                                                                                                                                                                                  |
| TSX negative case                     | A number calling `toUpperCase()` and an incorrect JSX `disabled` attribute report TS2339 and TS2322 respectively, and the process exits 1 overall; the probe has been removed                                                                                                                                                                                     |
| Native i18n routes                    | `parser:'dir'` + `hideLocale:'default-locale'` generate the expected URLs for English, Chinese, and Arabic, and the content source matches the explicit route enumeration                                                                                                                                                                                         |
| Search engine                         | English, Chinese, and Arabic retrieval and locale filtering all pass; the static index export passes. This is a small-data probe, and does not mean relevance and performance for all content have already been accepted                                                                                                                                          |
| Chromium static pages                 | Bun serves the build directory: direct access to nested pages, refresh, TypeTable, Tabs, static search, body text and the type table without JS, and 404 for unknown paths all pass; no page exception or failed request was captured. The template's external font request was blocked. The formal appearance and the UI for every language were not accepted    |
| Static assets and conversion boundary | `llms.txt`, `llms-full.txt`, single-page Markdown, and search assets are all HTTP 200 and non-empty; default processed Markdown keeps the JSX of TypeTable/Tabs, and search summaries also expose TypeTable properties. Formal implementation must therefore add a readable-text conversion, and the existence of an asset cannot stand in for content acceptance |
| TS dependency                         | The base isolation site's lockfile resolves only to TypeScript 7.0.2; this does not guarantee that every transitive dependency of the formal whole repository is also only this version, and it must be rechecked after implementation                                                                                                                            |
| Independent specification review      | A new read-only builder-check review found no important planning gaps other than the items already listed in section 7; it does not replace code review and tests after implementation                                                                                                                                                                            |

The isolation commands were `bun run build`, `bun run typecheck` (in `site/`), and `bun browser-probe.mjs` (in the isolation root), and all finally exited 0; the deliberately failing TSX probe exited 1 on its own. The browser used the repository's existing Playwright Chromium, and Firefox was not run.

The preparation phase did not rerun the original repository's full tests: in the earlier same-day baseline, the root build and the 386-page link check passed; the full `verify` once timed out at the Core Firefox connection, a targeted recheck of 65 tests passed, and the root cause was not confirmed. This historical state is not a basis for current acceptance; the current complete verification results are in the acceptance record.

## 7. Inputs Still Needed and Known Boundaries

- **The official primary domain is still not provided.** Local and isolation verification use localhost; the actual domain is concentrated in `SITE_URL`, and canonical, sitemap, and absolute LLM links all read that configuration. The release gate rejects a missing value and localhost/loopback, and does not treat the sample domain as the official domain.
- **Non-TS template check boundary.** The 33 existing Vue fences are kept as teaching content; after their typed setup scripts are extracted, Bun checks them. Vue templates have no complete static type check, and no Vue application or vue-tsc was added. This scope is handled through communication during the implementation phase, and it is not claimed that the user approved a downgrade of complete template static checking.
- Site-component TSX and compilable TS/TSX fences are included in Bun; MDX goes through the actual content build and browser acceptance, and its complete template static type checking is still not covered. Do not equate a passing compile or a passing browser check with template static checking, and do not introduce Node, TS6, or broad declarations to conceal errors.
- The static build still has a CSS `::highlight` optimization warning and a `node:fs/promises` browser-module externalization warning. The current full Chromium/Firefox acceptance found no search, theme, or navigation interaction anomalies and no console/pageerror; the item-by-item visual effect of search highlighting has no separate assertion.

## 8. Completion Criteria

1. Existing knowledge, valid examples, API explanations, assets, and content in all 11 languages all have a destination; the old page count is not a target.
2. The three reading areas, language switching, RTL, search, the mobile menu, light/dark mode, edit links, and basic reading without JS all work.
3. API categories, combined filtering, direct access to details, type links, and shared explanations are complete and consistent with the public source contract.
4. The repository-wide Bun check covers the union of project inputs and compilable examples, and the error probes are effective; uncovered non-TS formats are listed explicitly.
5. New HTML/anchors, search data, LLM, Markdown, and assets have no internal broken links, and every path can be accessed directly as static content.
6. JS/`.d.ts` for the four libraries and the existing recipe runtime tests stay passing, the full `bun run verify` exits 0, and Chromium/Firefox accept the real build artifact.
7. Old-framework dependencies and unused directories are removed after the new content, checks, and build are ready; the final diff contains only this goal.

## 9. Sources

- [React Router integration](https://www.fumadocs.dev/docs/manual-installation/react-router), [Vite content integration](https://www.fumadocs.dev/docs/mdx/vite), [static build](https://www.fumadocs.dev/docs/deploying/static).
- [i18n configuration](https://www.fumadocs.dev/docs/headless/internationalization/config), [RTL and theme](https://www.fumadocs.dev/docs/ui/theme).
- [TypeTable](https://www.fumadocs.dev/docs/ui/components/type-table), [AutoTypeTable limitations](https://www.fumadocs.dev/docs/ui/components/auto-type-table), [LLM output](https://www.fumadocs.dev/docs/integrations/llms).
- [Built-in static search and multiple languages](https://www.fumadocs.dev/docs/headless/search/orama), [Bun type checking](https://bun.com/docs/runtime/check). Versions and dependencies are also checked against this round's npm registry and the isolation lockfile.
