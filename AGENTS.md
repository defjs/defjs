# AGENTS.md

Project-level guide for AI coding agents in this repository. Read it before changing code. The acceptance gates at the end are not optional.

## What this repository is

Defjs separates the two sides of an SDK:

- **Definition** — SDK authors declare operations with `defineRequest`, `defineEventStream`, and `defineWebSocket` from `@defjs/core`. A definition is data: importing it starts no request and binds no client.
- **Execution** — an application creates its own client (`createClient(withEndpoint(...))`) and runs commands with `client.execute(command, options)`.

Definitions can be published on their own; the consuming application keeps ownership of endpoint, credentials, interceptors, and transports.

| Path                            | Package                       | Owns                                                                    | Boundary                                                                        |
| ------------------------------- | ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/core`                 | `@defjs/core`                 | HTTP / SSE / WebSocket definitions, `struct`, client, interceptors      | No runtime dependencies; platform-neutral ESM                                   |
| `packages/react`                | `@defjs/react`                | `ClientProvider`, `useClient`                                           | Thin plugin; not a query/cache/state library                                    |
| `packages/vue`                  | `@defjs/vue`                  | `HTTP_CLIENT`, `createClientPlugin`, `injectClient`                     | Thin plugin; not a query/cache/state library                                    |
| `packages/opentelemetry-server` | `@defjs/opentelemetry-server` | Server-side outbound OpenTelemetry for core clients                     | Does not initialize the OTel SDK; no bodies or full headers captured by default |
| `doc`                           | private                       | Fumadocs + React Router + Vite documentation site and its E2E suite     | Content and site code only                                                      |
| `test`                          | root                          | Shared test infrastructure: `assert-pack.ts`, test servers, Firefox env | Not a package                                                                   |
| `docs`                          | root                          | Internal audit / design / perf / research records                       | Not published, not user documentation                                           |

Read the reference that matches your change before editing:

- `packages/core/design.md` — current public behavior of core, including body/query rules and non-goals.
- `packages/core/src/struct/README.md` — the structural contract for `struct`.
- `DESIGN-builder.md` — builder placement and encoding rationale.
- `doc/content/en-US/` — user-facing source of truth for guides; the other locales mirror those guides. API entry prose comes from TSDoc.

## Contracts that must not break

1. **Definition and execution stay separate.** Calling an endpoint creates a command; only `client.execute` performs I/O. There is no global client (`createGlobalClient` and friends were removed in 0.4; do not reintroduce them).
2. **`input` declares parameters; `builder` places them.** A definition with `input` must provide an explicit `builder`. Placement is never inferred from field names or the path template.
3. **`builder` is a synchronous pure function.** It returns `{ path?, query?, headers?, body? }`, runs at execution time, and a throw becomes `REQ_BUILD_FAILED`.
4. **Results are error-first tuples.** `execute` returns `[error, ...]`; request, response, and transport failures do not throw at the call site. Preserve the fault codes and causes documented in `design.md`.
5. **`struct` only declares structure.** Instances have no `.parse()`; there is no public `struct.encode`, no `setErrorMap`, and no zero-filling or partial results. Validation DSL and business rules belong to the application.
6. **`@defjs/core` stays dependency-free and platform-neutral.** `packages/core/package.json` has no `dependencies`. Do not import Node-only APIs into shared code paths.
7. **Plugins stay thin.** Two kinds share the rule that they add no caching and no state:
   - _Framework plugins_ (`@defjs/react`, `@defjs/vue`) share a typed client through framework primitives and add no transport behavior.
   - _Middleware plugins_ (`@defjs/opentelemetry-server`) are the plugin form of an interceptor chain: one appends interceptors to the application's client through the documented extension points (interceptors and client options) and never replaces or wraps a transport.
8. **The public surface is the package root.** `src/index.ts` → `src/public_api.ts` → per-module `public_api.ts`. Anything outside that chain is internal.
9. **100% coverage is the floor** in every published package and in the documentation site's unit project (`app/lib`, `app/data`, `scripts`; branches, functions, lines, statements). New behavior arrives with tests in the same change.

Authentication, tracing, and cross-request header changes belong in an interceptor. `builder` only places the current input. Low-cardinality identity belongs in the definition's `operation`.

## Repository map

### `@defjs/core`

| Module         | Contents                                           |
| -------------- | -------------------------------------------------- |
| `client/`      | client creation, command, execute, options         |
| `error/`       | fault types and factory                            |
| `http/`        | request definitions, request building, transports  |
| `sse/`         | event-stream definitions and transports            |
| `web_socket/`  | WebSocket definitions, codec, heartbeat, reconnect |
| `struct/`      | schema constructors, codecs, parsing               |
| `interceptor/` | interceptor types and built-ins                    |
| `internal/`    | shared internals; never exported from the package  |

Specs live beside the source. `packages/core/test/` holds end-to-end specs and fixture servers, included by the `core-server` project.

### `doc`

| Path            | Contents                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `doc/app/`      | site application, components, generated API data, routing, LLM output                                             |
| `doc/content/`  | guides and the 11 API overview pages per locale; entry pages are not stored here                                  |
| `doc/examples/` | complete, typechecked examples embedded by content pages                                                          |
| `doc/e2e/`      | Vitest Browser Mode specs (`*.browser.spec.ts`) driving Chromium through Playwright against the built static site |
| `doc/scripts/`  | API extraction, build, build fingerprint, link check, site URL check                                              |

Documentation unit specs (`*.spec.ts`) sit beside the source in `app/`, `scripts/`, and `examples/`; there is no separate `doc/test/` directory. Specs are excluded from the build fingerprint, so editing one does not stale `doc/build`.

## Code conventions

- One directory per capability, with `index.ts` and `public_api.ts`. Extend the public API chain deliberately; adding a file under `internal/` does not make it public.
- Test file names select the Vitest project. For `@defjs/core`:

  | Pattern             | Runs in                                | Use for                       |
  | ------------------- | -------------------------------------- | ----------------------------- |
  | `*.spec.ts`         | Vitest `core-server` (and Node 24 job) | server / Bun behavior         |
  | `*.browser.spec.ts` | Chromium and Firefox                   | shared browser behavior       |
  | `*.server.spec.ts`  | server only                            | Node-specific server behavior |
  | `*.chrome.spec.ts`  | Chromium only                          | engine-specific behavior      |
  | `*.firefox.spec.ts` | Firefox only                           | engine-specific behavior      |
  | `*.type.test.ts`    | type checking, not runtime             | type-level contracts          |

- Do not skip inside a shared spec with `process.platform`-style checks. Put the test in the runtime-specific file. React and Vue run browser projects only, so their specs use `*.browser.spec.ts`; the OpenTelemetry package runs a server project only.
- TypeScript is strict: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `allowImportingTsExtensions`. Use `import type` for type-only imports. The root catalog pins `typescript` to the exact `7.1.0-beta`; a caret range would resolve to nightly `7.1.0-dev` builds.
- Lint rules that commonly bite: no `any`, no non-null assertions, no namespace imports, `@ts-ignore` banned, `@ts-expect-error` requires a description of at least 10 characters.
- Formatting is Bun's built-in formatter: 2 spaces, LF, UTF-8, final newline. Run `bun fmt`.
- Write a comment only when the reason is non-obvious. Do not restate what the code does.
- Commit messages follow the history: Conventional Commits with a package or area scope (`feat(core):`, `fix(doc):`, `docs:`, `refactor:`, `chore:`). Describe why, not a file tour.

## Working on a change

1. Read the reference document above and the current implementation plus its tests.
2. Find every caller of the function you are about to touch. Fix the shared boundary, not only the path named in the request.
3. Implement the smallest change that satisfies the behavior. No new runtime dependency, no speculative options, no unrelated refactors, no reformatting of untouched files.
4. Add or update tests in the same change. A regression test must fail before the fix and pass after it.
5. If the public API changes, sync these in the same change:
   - `packages/core/design.md` and the package README when behavior is documented there;
   - guide pages in `doc/content/en-US/` and the other 10 locales when the guide narrative changes;
   - TSDoc on the export, then run the extraction and commit its result:

     ```bash
     bun run --cwd doc extract-api
     ```

     That command writes `doc/app/data/api-entries.json`, `api-reference.json`, and `api-summaries.json`. `exports.spec.ts` fails if the catalog and the public exports disagree.
6. Run the gates below and report the exact command, exit code, and failing output for anything that does not pass.

## Verification

Setup, once per checkout:

```bash
bun install
bunx --bun playwright install --with-deps chromium firefox
```

Playwright browsers are only needed by the Core browser projects and the documentation E2E suite.

Run these in order from the repository root and stop at the first failure. This is the same sequence as `.github/workflows/ci.yml`.

| #   | Command             | Covers                                                  |
| --- | ------------------- | ------------------------------------------------------- |
| 1   | `bun run lint`      | oxlint over the whole repository                        |
| 2   | `bun fmt --check`   | formatting for every file                               |
| 3   | `bun run typecheck` | library project, documentation app, TS/TSX examples     |
| 4   | `bun run test:unit` | every workspace plus the root `test/` directory         |
| 5   | `bun run build`     | all workspaces, including the static documentation site |
| 6   | `bun run test:e2e`  | the built documentation site in Chromium                |

A change is verified only when all six pass on the same revision.

`bun fmt` is a Bun built-in, deliberately not wrapped in a script. There is no `fmt` or `fmt:check` script and `bun run fmt` does not exist:

```bash
bun fmt           # write
bun fmt --check   # verify
```

Every other command in the table is a repository script resolved through `bun run`.

### Workspace-local checks

Use these while iterating; the root aggregation runs the same scripts.

```bash
bun run --cwd packages/core test:unit
bun run --cwd doc test:unit
bun run --cwd doc typecheck
```

`bun run typecheck` at the root already includes the documentation type check.

### Node 24

CI runs a second job on Node 24 because Vitest's binary is `#!/usr/bin/env node`. `bun run` from the repository root follows `bunfig.toml` `[run] bun = true` and stays on Bun (Bun reads `bunfig.toml` only from the current directory), so the Node job invokes `bunx --no-install vitest` directly. Reproduce it with:

```bash
cd packages/core && bunx --no-install vitest run --config vitest.config.ts --project core-server --coverage.enabled=false
cd packages/opentelemetry-server && bunx --no-install vitest run --config vitest.config.ts --coverage.enabled=false
```

### Build and E2E freshness

`test:e2e` serves `doc/build/client` and rejects a stale build, so run `bun run build` first. To rebuild only the documentation site:

```bash
bun run --cwd doc build
```

The build stamps its input fingerprint into `doc/build/client/build-stamp.txt` and fails if inputs change during the build.

## Testing rules

- Fix a flaky test at its race. Do not add retries, sleeps, a longer global timeout, `.skip`, or lowered coverage. Do not narrow a test selection to make a gate pass.
- Time-dependent tests follow the clock they actually need:
  - **Unit-level timing** (request timeouts, backoff, heartbeat, dispose grace, reconnect delay) uses fake timers: `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`, or only `'Date'` when a synchronous phase must outlast a real timer. Advance time only after the awaited event has happened (`advanceTimersByTimeAsync`; `vi.waitFor` advances fake timers on its own) and assert the code path that should have run — a call count or a state change — not elapsed wall time. Node's test runner is the same idea: `context.mock.timers.enable` plus `tick`.
  - **Integration over a real socket or server** waits for the concrete event (`socket.closed`, the first frame, `open`) or a condition (`vi.waitFor` on observable state). Never assert on elapsed time. A liveness guard may race a promise that has no observable event, such as an execute expected to fail without a socket ever opening, but it is a safety net, not an assertion: name it in one short comment, use a budget that does not depend on machine speed (10s, not 2s), keep `timeout.unref?.()`, and still prove the behavior with the event wait and the code-path assertions.
  - **Real browser engines** run on real time. Wait for events and give a generous budget. Never use a tight window.
- Assert the bytes that were sent, not a runtime's re-parse of them. Bun's multipart parser drops a file part's `Content-Type`, so multipart tests compare the raw body (`packages/core/test/multipart-fixture.ts` and the `/e2e/echo-raw` route).
- Browser projects share a fixed Vitest port. Run one browser test process at a time. Firefox Vitest instances pass `browserLaunchEnv()` from `test/firefox-app-data.ts` so Firefox starts on macOS 27; the Chromium Vitest provider does not. The documentation E2E project is Chromium only.
- The root `test:unit` runs `bun test ./test` after the workspaces; that is where `test/assert-pack.test.ts` lives.

## Documentation site rules

- There are 11 locales: `en-US`, `zh-Hans`, `zh-Hant-TW`, `zh-Hant-HK`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `ru-RU`, `ar`. Every locale carries every guide; there is no fallback to English for guides. API reference text is English TSDoc in every locale. Each locale keeps only its 11 overview pages: `api/index.mdx`, `client.mdx`, `errors.mdx`, `http.mdx`, `interceptors.md`, `opentelemetry-server.mdx`, `react.mdx`, `sse.mdx`, `struct.md`, `vue.mdx`, and `web-socket.mdx`. The 170 entry URLs come from generated data, so `navigation.spec.ts` still asserts 208 unique URLs per locale.
- Overview pages must not hand-copy a signature of a generated entry. Write `<ApiSignature name="withEndpoint" />`. Several names go in that attribute, comma-separated, in source order: `<ApiSignature name="ERR_ABORTED, ERR_TIMEOUT" />`. The MDX build replaces the tag with the generated signature before highlighting, so search and `llms` see the fence. An unknown or ambiguous name fails the build with the file path. `api-signatures.spec.ts` fails with `hand-copied signature of a generated entry` when a fence declares a catalog name. Example fences whose names are not entries stay hand-written.
- Complete TS/TSX examples live in `doc/examples/` and are embedded with `<include>`. The export scan understands only `export { ... }`, `export type { ... }`, declarations, and `export * from`; a new form such as `export type * as ns from` fails `doc/app/data/exports.spec.ts`.
- Vue single-file examples are not statically checked.
- The documentation unit tests execute the ETag, Bearer, and GraphQL recipes and assert their HTTP statuses and application outcomes.
- After rendering, the build checks local page links and anchors, including generated navigation and locale links.
- Run `bun run --cwd doc extract-api` after changing public exports or their TSDoc, and commit the three files it writes: `api-entries.json`, `api-reference.json`, and `api-summaries.json`. A public export needs an English, neutral TSDoc description. Use `@group` for its overview, `@see` for related exports, and `@exampleFile` for a type-checked example. Do not put site-relative links in comments; comments are the only input to generation. An export with no description fails extraction. Generation also fails when a signature is not syntactically valid TypeScript. `exports.spec.ts` still checks the catalog against the public exports in both directions, including kind.
- Extraction builds the program with `typescript/async` under Bun. Parameter and member tables come from `fumadocs-typescript`, which calls `typescript/sync`. That sync entry crashes under Bun, so `doc/scripts/extract-api.ts` runs those queries in a Node child process.
- Set the repository variable `SITE_URL` to the confirmed HTTPS origin before deploying. Local builds default to localhost; the release job rejects a missing or local origin.

## Release and packaging

- The **Release** workflow is manual and pick-what-you-want. Versions come from the committed package manifests; nothing bumps them and no changesets or tags are required.
- Each package builds with `tsdown`, publishes from `dist`, and uses `publishConfig.directory`. The build writes `dist/package.json`, copies `LICENSE` and the package `README.md`. The `build` scripts call `bun --bun tsdown`, so they run on Bun from any directory, not only the repository root.
- The root `overrides` pins `rolldown-plugin-dts` to a 0.29 beta because 0.28 reads `ts.sys`, which TypeScript 7.1 does not expose. Drop the override once `tsdown` depends on a `rolldown-plugin-dts` release that supports TypeScript 7.1.
- `bun test/assert-pack.ts <publish-dir>` must pass before publishing: it checks that `npm pack --dry-run` includes `LICENSE`, `README.md`, `package.json`, and every file referenced by the entry fields.
- Packages that depend on Core build Core first. A Core patch within the plugins' `^0.4.0` peer range does not require a plugin release.
- CI runs the six gates on pull requests and `main`. The release workflow does not wait for CI; verify the intended revision first.

## Do not

- Run `bun run fmt`; the formatter is `bun fmt`.
- Edit generated output: `dist/`, `coverage/`, `doc/build/`, `doc/.react-router/`, `test-out/`.
- Reintroduce removed APIs: global client, `executeRaw`, `responseType`, `struct.request` / `struct.json` / `struct.text`, WebSocket custom handshake headers, OpenAPI generation.
- Put authentication or tracing into `builder`, or infer request placement from `input` field names.
- Add a runtime dependency to `@defjs/core`, or import Node-only modules into shared code.
- Leave a new public export without TSDoc, or skip regenerating the API data.
- Add retries, sleeps, platform skips in shared specs, or lowered coverage to make a gate pass.

## Definition of done

All six gates pass on the same revision. New behavior has an accompanying test, public API changes have TSDoc and regenerated API data, guide changes are reflected in every locale, and no unrelated file was reformatted or refactored.
