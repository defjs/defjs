# Starlight Documentation Migration Development Specification

> Superseded by the [Fumadocs development specification](2026-10-10-fumadocs-migration-design.md). This document is retained only as research history and is not the basis for the current implementation.

Date: 2026-10-10. Repository baseline: `feat/up`, `d618396c88bc84645953684c0cb20feaae0f55a8`.

Status: pre-development preparation. This file distinguishes requirements the user has confirmed, implementation defaults, and items still awaiting answers; the framework migration has not started.

## 1. Goals and Confirmed Requirements

1. Switch the documentation framework from VitePress to Astro Starlight, preserving the existing body text, explanations, examples, assets, and all language versions.
2. Moving directories, adjusting page organization, converting framework syntax, and changing Markdown that needs components into MDX are allowed.
3. Adjusting the appearance is allowed. Ordinary documents drop Twoslash type hover hints; type information is concentrated in the API reference module.
4. The API browsing experience follows the Angular API: package categories, name search, category filters, and details that include signatures, parameters, return values, types, and examples.
5. **Repository-wide type checking uses Bun exclusively**, covering each package, tests, scripts, configuration, and compilable documentation TS/TSX examples.
6. Remove the documentation Twoslash setup and its TS6 dependency. The current library build still depends on TS7 to generate `.d.ts`; this round does not change the declaration generation approach.
7. Deploy only at the production primary-domain root path. Old URLs, `.html` paths, old anchors, and subpath deployment have no compatibility requirements; internal links on the new site must be valid.
8. This round only writes development preparation materials; installing dependencies, application code changes, commits, pushes, and deployment have not been executed.

## 2. Two Inputs Still to Confirm

| ID  | Input                                | Current status and impact                                                                                                                                                                                                              |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Production primary domain            | Asked, not yet provided. Used for the Astro `site`, canonical URLs, the sitemap, and LLM output. An example domain or the GitHub project path must not be treated as the production domain.                                            |
| Q2  | Vue/Astro template checking boundary | The user followed up asking whether Oxc can support it; it is confirmed that current Oxlint also does not cover template errors. There is not yet agreement to replace complete static template checking with build and browser tests. |

Q1 does not block content organization and local development, but the production build configuration must use the actual domain. Q2 must be resolved before the template acceptance plan is settled; uncovered templates must not be labeled "repository-wide type check passed".

## 3. Current Inventory and Retention Boundary

| Item                           | Measured current result                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Documentation source files     | 385 Markdown articles; 11 language versions, 35 articles each                                                           |
| Default language               | English at the root path, `lang: en-US`                                                                                 |
| Other languages                | `zh-Hans`, `zh-Hant-TW`, `zh-Hant-HK`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `ru-RU`, `ar`                       |
| API source content             | 11 handwritten pages per language; the existing catalog has 162 display entries and 130 distinct content anchors        |
| Originally checked code blocks | 704: `typescript` 484, `ts` 132, `tsx` 55, `vue` 33; the counts include duplicate examples in translations              |
| Special code organization      | 44 `@filename` entries, 11 `---cut---` entries; multi-file relationships and hidden checking context must be preserved  |
| Install-command tabs           | 22 groups; including Bun, npm, pnpm, and Yarn                                                                           |
| Existing documentation tests   | Two real example execution tests: ETag 200→304 and Bearer 401→200                                                       |
| Existing link checking         | `doc/.vitepress/check-links.ts` checks internal files, anchors, navigation, and language-switch links in the built HTML |
| Existing assets                | `doc/public/logo.jpg`; GitHub edit and repository links; license and footer                                             |
| LLM content                    | Currently outputs English only; keep the ability to produce `llms.txt`, the full text, and per-page Markdown            |

"Preserve the documentation" is accepted by content, not by requiring exactly 385 pages after migration. API pages may be split into details, but every original document and its meaningful content must have a clear destination. Build a one-time source-file/section → target-file map and check it item by item; total page count cannot offset lost content.

Remove duplicate body H1s; keep frontmatter titles and descriptions; convert Tabs, code filenames, relative links, and heading anchors. New anchors may be generated, but every reference must be updated in sync. When clearing displayed Twoslash directives, do not concatenate multi-file examples into one file with different semantics, or show hidden declarations to readers.

## 4. Implementation Defaults

The following are implementation choices selected for the current requirements. They are not passed off as a design the user specified item by item.

### 4.1 Pages, Languages, and Navigation

- Move the docs to `doc/src/content/docs/`; put English in the root directory and keep the other languages in their corresponding directories, avoiding pointless language-path renames.
- Use Starlight's native theme, light/dark mode, mobile navigation, Pagefind search, table of contents, and accessible interactions.
- Keep the three reading areas "Docs / Recipes / API", and switch areas and sidebars through Sidebar Topics.
- Set Arabic to `dir: rtl`. Keep Hong Kong and Taiwan Traditional Chinese as independent versions with their own language labels.
- Migrate existing translations in full; do not replace existing translations with an English fallback. Future untranslated pages use Starlight's built-in notice and fallback.
- Install commands use Starlight Tabs with a shared `syncKey`; only pages that use components are converted to MDX.
- Static output at the root path, `base: '/'`, `trailingSlash: 'always'`, output directory `doc/dist/`.

### 4.2 API Reference Module

- Reuse the package and symbol inventory in `doc/.vitepress/api-catalog.ts`, remove the VitePress type coupling, and move it to `doc/src/data/api-catalog.ts`.
- Place the new API index at `/api/` and the corresponding path for each language; support case-insensitive name search, package filtering, category filtering, result counts, and an empty-result state.
- Categories are determined from the actual export declarations, including function, interface, type, constant, class, and members that need to be shown; do not guess the category from name casing alone.
- Provide directly reachable details for catalog entries, for example `/api/core/create-client/` and `/api/core/client-option/`. Symbol identity uses "package name + original symbol name"; route slugs are recorded explicitly and checked for conflicts.
- Cases where several entries originally shared an anchor need to be split explicitly or to reference a shared explanation. All 162 entries must be able to find an explanation; do not create empty detail pages that have only a title.
- Details keep the original signature, generics, parameters, return values, fields, explanations, examples, and related tutorials. Type references provide clickable links and may appear in a related-types area under the signature; not every token in a code block has to become a link.
- Package-level and module-level shared explanations are kept as overviews or referenced from details, and are not lost when pages are split. All languages are organized in sync; do not invent parameter explanations or translations that are not in the original text.
- API content remains handwritten Markdown/MDX. This round does not introduce TypeDoc, the TypeScript Compiler API, a homegrown type extractor, or a system that auto-generates documentation from source.
- Use Astro components and a small amount of browser TS for index interaction; do not add a React/Vue page runtime just for API search. Documentation example dependencies are kept separately.
- Do not copy Angular-specific decorator/directive categories, version switching, or experimental-status filters; show only information the project actually has.

### 4.3 Plugins and Dependencies

Versions are values measured against the npm registry on 2026-10-10. At implementation time, pin the compatible combination below and write it into `bun.lock`; if versions change, recheck the peer ranges.

| Dependency                                                                                | Version / handling                                         | Purpose                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `astro`                                                                                   | 7.3.8                                                      | Static builds, content collections, and page components                          |
| `@astrojs/starlight`                                                                      | 0.42.6                                                     | Documentation theme, i18n, Pagefind, Expressive Code, and MDX support            |
| `starlight-sidebar-topics`                                                                | 0.9.0                                                      | Three reading areas and their sidebars                                           |
| `starlight-llms-txt`                                                                      | 0.12.0                                                     | English LLM index and full text                                                  |
| `typescript`                                                                              | Keep 7.0.2, which the root / library build actually needs  | `.d.ts` generation and tooling support; not the repository-wide type-check entry |
| Documentation `typescript@6.0.3` and `@shikijs/vitepress-twoslash`                        | Delete after the migration is complete                     | Twoslash is no longer run                                                        |
| `vitepress`, `vitepress-plugin-tabs`, `vitepress-plugin-llms`                             | Delete after the corresponding features have been migrated | Clean up the old framework                                                       |
| `@astrojs/check`                                                                          | Not included in the current baseline plan                  | Current 0.9.10 peers are TS5/TS6; TS6 must not be silently reintroduced          |
| Link-checking plugin                                                                      | Do not add                                                 | Adapt the existing Bun HTML link checker                                         |
| Standalone search / highlight / Tabs plugins, TypeDoc, a blog, and versioned-site plugins | Do not add                                                 | Current needs are met by existing or native capabilities                         |

`@astrojs/markdown-remark` is an optional peer of Astro/Starlight. This round prefers the default Markdown engine and does not install it unconditionally just to satisfy an optional peer. Whether React/Vue and workspace packages stay is decided by the real imports in documentation examples; do not mistake example dependencies for old theme dependencies and delete them.

The peer versions of the four target packages are compatible, but that does not prove Astro 7 builds successfully under Bun. The first development task must verify actual startup, MDX, and the static build with `bun --bun astro`; do not introduce a Node.js runtime flow just to get the build to pass.

### 4.4 Repository-wide Checking and Declaration Generation

- Minimum Bun 1.4.3 for the development, checking, and build runtime; continue using the existing Bun lockfile and CI.
- The root `bun run typecheck` is the only repository-wide type-check entry: first sync Astro content types, then check repository TS/TSX/MTS/CTS, and finally check documentation examples.
- Example checking references each library's source through TypeScript `paths` and does not depend on generating `dist` first. `doc build` does not call the root `typecheck` in reverse, avoiding a check-and-build cycle.
- Explicitly exclude dependencies, build outputs, coverage, and temporary check directories; do not buy a pass by excluding source directories, using `any`, or adding `@ts-ignore`.
- Extract Markdown/MDX code blocks into separate temporary TS/TSX files first, preserving imports, generics, and multi-file relative dependencies, then hand them to `bun check`. Diagnostics must be able to point back to the original page and code block.
- Identical examples may be deduplicated by "code + language + auxiliary files + compilation context"; do not check only English and miss different examples in translations.
- Complete examples must be checked. API declaration sketches and fragments that depend on context need an explicit classification: supply a real checking context, or record why they are only a signature or fragment display; do not exclude every ordinary TS code block by default.
- Keep the two real recipe runtime tests, and cover negative cases for the documentation extractor: intentionally wrong TS/TSX must fail the check, and empty input must fail.
- Bun's native Markdown callback can extract the code body, but this round's measurement shows `meta.language` does not preserve the whole fence info-string. Do not use it to read `twoslash`, titles, or combined metadata; the implementation should keep the raw fence information separately and prove it correct with tests.
- `tsdown` continues to generate `.d.ts` for the four libraries. Handing repository-wide checking to Bun does not mean the declaration-generation dependency can be deleted, and this round does not enable `isolatedDeclarations` or rewrite library exports in order to drop TS7.

The final template-checking plan is constrained by Q2. The candidate plan is: put business and browser TS that can be checked independently into `.ts` files and hand them to Bun; verify Vue/Astro templates through real compilation and browser tests. This plan is not complete static template type checking and must be confirmed by the user for that boundary.

The verification order is fixed as: `bun run lint && bun run fmt:check && bun run test && bun run build && bun run --cwd doc test:site`. The documentation `test` only runs `bun test ./test`, covering the extractor, catalog data, and recipes; the actual site tests live separately in `doc/e2e/` and are run by `test:site` via `bun test ./e2e`, after this round's build completes. Bun unit tests read ordinary TS data and content files and do not directly import the `astro:content` runtime virtual module that only Astro provides.

### 4.5 LLM Output, Links, and Deployment

- `starlight-llms-txt` keeps the default English output; do not mix all 11 copies of duplicate content into the English full text.
- The plugin does not provide the existing per-page `.md` export, so add a lightweight static export, placed uniformly under `/_markdown/`; old Markdown URLs are not kept compatible.
- Per-page Markdown must include body text, visible code, API signatures, and links, and must not output the original Twoslash hidden declarations or leftover MDX component calls. Index components need an equivalent textual API catalog.
- Move `doc/.vitepress/check-links.ts` to `doc/scripts/check-links.ts`. By default it validates `doc/dist/` and covers new pages and anchors. Internal URLs in the LLM and Markdown exports must also be verified to exist.
- The GitHub Pages documentation job first runs `bun run typecheck` at the repository root, then runs the documentation build; the upload path changes from `doc/.vitepress/dist` to `doc/dist`. Deployment permissions and package publishing behavior are not expanded.
- Update the README, tsconfig, ignore rules, workflows, and documentation commands in sync. Delete the old documentation system only after content, checks, and the new build are all complete.

## 5. Acceptance Criteria

1. All 385 original documents have a migration map; every body, code sample, translation, shared API explanation, and asset has a destination.
2. Each language can enter the three areas from the home page; language switching, search, mobile navigation, light/dark, and RTL work.
3. API index search, package/category filtering, empty results, keyboard operation, and direct detail links work; catalog entries, pages, and type links are consistent.
4. The repository-wide Bun check covers the actual source inventory and compilable documentation examples; newly introduced intentional errors are detected, and uncovered formats are listed separately.
5. The documentation has no Twoslash UI or leaked internal directives; new code blocks support highlighting, copy, filenames, and tabs where needed.
6. New HTML, anchors, LLM output, and per-page Markdown have no broken links; the site domain and root-path configuration are accurate.
7. JS and `.d.ts` builds for the four libraries do not regress; existing runtime tests stay passing.
8. `bun run verify` finishes completely with exit 0, including Chromium/Firefox browser acceptance of this round's build output. Do not describe a partial pass as a repository-wide pass.

## 6. Preparation-stage Evidence and Risks

- When preparation started the working tree was clean, on `feat/up`; all 256 `.ts` files currently tracked by Git appear in the root Bun check inputs.
- This round's `bun run typecheck`: exit 0, 260 files checked.
- This round's documentation recipe tests: 2 passed, 0 failed.
- This round's `bun run verify`: lint and format check passed, then the Core Firefox session did not connect within 120 seconds, exit 1; 1,715 tests had passed, which cannot be called a complete baseline pass. The build stage was not reached.
- The root `bun run build` was then run independently: exit 0; repository-wide type checking, JS/`.d.ts` for the four libraries, and the existing VitePress documentation build passed, and internal link validation passed for 386 generated pages. This result only proves the pre-migration build works; it does not prove the not-yet-installed Starlight combination works.
- Firefox targeted recheck: `bun run test --project 'core-browser (firefox)' --browser.connectTimeout 15000 --coverage.enabled=false`, 5 files, 65 tests passed. Only that diagnostic command shortened the connection wait to 15 seconds; the repository configuration was not changed. The root cause of the first full-run failure has not been located.
- Bun has been verified to report intentional TS/TSX type errors; putting the same error in Markdown, Vue, or Astro and running the Bun check directly does not cover it.
- An isolated probe of Oxlint 1.87.0 + oxlint-tsgolint 7.0.2003 is complete: `--type-aware --type-check` reports TS2339 for `toUpperCase()` on a number in an ordinary `.ts` file and exits 1; the same error placed in a Vue template or an Astro template exits 0 with an empty diagnostic. This matches the official statement that template support is missing, and it cannot replace complete template type checking.
- There is no guarantee the dependency tree contains no transitive TS6 at all; migration acceptance first requires deleting the documentation's explicit TS6/Twoslash and its uses, then checking the actual source of any versions that remain in the lockfile.
- An independent specification review found no substantive gap beyond Q1/Q2. The command order is explicit: build first, then run site tests; checks reference library source directly; the standalone documentation deployment checks first. This avoids a build cycle and misuse of old artifacts.

## 7. Out of Scope for This Round

Auto-generating API docs from source, old URL redirects, subpath deployment, an interactive playground, a versioned documentation site, a blog, rewriting library APIs, replacing the declaration generator, and production release and domain configuration operations.

## 8. Research Basis

- [Angular API index](https://angular.dev/api) and [signal details](https://angular.dev/api/core/signal): reference for how API information is organized.
- [Starlight configuration](https://starlight.astro.build/reference/configuration/), [i18n](https://starlight.astro.build/guides/i18n/), and [Tabs](https://starlight.astro.build/components/tabs/): use native capabilities.
- [Sidebar Topics configuration](https://starlight-sidebar-topics.netlify.app/docs/configuration/) and [LLM plugin](https://delucis.github.io/starlight-llms-txt/getting-started/): selection for navigation and output.
- [Bun type checking](https://bun.com/docs/runtime/check): the built-in checker does not depend on npm `typescript` and does not generate `.d.ts`.
- [tsdown declaration generation](https://tsdown.dev/options/dts): the current build still needs TypeScript.
- [Oxc support scope](https://oxc.rs/compatibility.html) and [Oxlint type checking](https://oxc.rs/docs/guide/usage/linter/type-aware.html): script and template capabilities are accepted separately.
