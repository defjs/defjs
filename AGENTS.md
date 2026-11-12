# AGENTS.md

Project-level guide for AI coding agents in this repository. Read it before changing code. The acceptance gates at the end are not optional.

## What this repository is

Defjs separates the two sides of an SDK:

- **Definition** — SDK authors declare operations with `defineRequest`, `defineEventStream`, and `defineWebSocket` from `@defjs/core`. A definition is data: importing it starts no request and binds no client.
- **Execution** — an application creates its own client (`createClient(withEndpoint(...))`) and calls an operation: `getOrder(client, input)` or `getOrder(client(options), input)`. Calling the operation performs I/O.

Definitions can be published on their own; the consuming application keeps ownership of endpoint, credentials, interceptors, and transports.

| Path                            | Package                       | Owns                                                                                                                                                                               | Boundary                                                                        |
| ------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/core`                 | `@defjs/core`                 | HTTP / SSE / WebSocket definitions, `struct`, client, interceptors                                                                                                                 | No runtime dependencies; platform-neutral ESM                                   |
| `packages/react`                | `@defjs/react`                | `ClientProvider`, `useClient`                                                                                                                                                      | Thin plugin; not a query/cache/state library                                    |
| `packages/vue`                  | `@defjs/vue`                  | `HTTP_CLIENT`, `createClientPlugin`, `injectClient`                                                                                                                                | Thin plugin; not a query/cache/state library                                    |
| `packages/opentelemetry-server` | `@defjs/opentelemetry-server` | Server-side outbound OpenTelemetry for core clients                                                                                                                                | Does not initialize the OTel SDK; no bodies or full headers captured by default |
| `doc`                           | private                       | Fumadocs + React Router + Vite documentation site                                                                                                                                  | Content and site code only                                                      |
| `test`                          | root                          | Root test infrastructure: `spec-matrix.ts`, `vitest-shared.ts`, `runtime-guard.ts`, `no-skip-reporter.ts`, `unit-node.ts`, `assert-pack.ts`, Firefox env, and the `root-bun` specs | Not a package                                                                   |

Read the reference that matches your change before editing:

- `packages/core/src/struct/README.md` — the structural contract for `struct`.
- `doc/content/en-US/` — user-facing source of truth for guides; the other locales mirror those guides. API entry prose comes from TSDoc.

## Contracts that must not break

1. **Definition and execution stay separate.** Calling an operation performs I/O. A definition does not capture a client. There is no global client (`createGlobalClient` and friends were removed in 0.4; do not reintroduce them).
2. **`input` declares parameters; `builder` places them.** A definition with `input` must provide an explicit `builder`. Placement is never inferred from field names or the path template.
3. **`builder` is a synchronous pure function.** It returns `{ path?, query?, headers?, body? }`, runs at execution time, and a throw becomes `REQ_BUILD_FAILED`.
4. **Results are error-first tuples.** An operation returns `[error, ...]`; request, response, and transport failures do not throw at the call site. Programming misuse is the exception and typically rejects with `TypeError`: a `signal` option that is not an `AbortSignal`, an HTTP `output` or `error` that is not a struct, and calling an operation without a client. Preserve the fault codes and causes documented in `doc/content/en-US/docs/errors.mdx` and the TSDoc of the `error/` exports.
5. **`struct` only declares structure.** Instances have no `.parse()`; there is no public `struct.encode`, no `setErrorMap`, and no zero-filling or partial results. Validation DSL and business rules belong to the application.
6. **`@defjs/core` stays dependency-free and platform-neutral.** `packages/core/package.json` has no `dependencies`. Do not import Node-only APIs into `packages/*/src`. Test code (`packages/*/test`, root `test/`) may use them where the runtime layer needs them, but the runtime-neutral fixture modules may not (see Testing rules).
7. **Plugins stay thin.** Two kinds share the rule that they add no caching and no state:
   - _Framework plugins_ (`@defjs/react`, `@defjs/vue`) share a typed client through framework primitives and add no transport behavior.
   - _Middleware plugins_ (`@defjs/opentelemetry-server`) are the plugin form of an interceptor chain: one appends interceptors to the application's client through the documented extension points (interceptors and client options) and never replaces or wraps a transport.
8. **The public surface is the package root, plus the browser-only `@defjs/core/xsrf` entry.** `src/index.ts` → `src/public_api.ts` → per-module `public_api.ts`, and `src/xsrf/index.ts` → `src/xsrf/public_api.ts`. Anything outside those chains is internal.
9. **100% coverage is the floor** in every published package and in the documentation site's unit project (`app/lib`, `app/data`, `scripts`; branches, functions, lines, statements). Each runtime project (`core-chrome`, `core-node`, ...) checks the floor on its own against the files its specs load and writes `coverage/<runtime>/`; reports are not merged. New behavior arrives with tests in the same change.

Authentication, tracing, and cross-request header changes belong in an interceptor. `builder` only places the current input. Low-cardinality identity belongs in the definition's `operation`.

## Example best practice

Examples, READMEs, and guides follow the minimal example in `doc/examples/http/basic-setup.ts`. LLM resources use Fumadocs output directly; keep guidance in the documentation source, without handwritten preambles, duplicated examples, or post-generation Markdown rewriting. A definition does not capture a client. Calling an operation runs it; do not bind that call to a command name. `client(options)` returns a client value for one call and does not perform I/O; the value is not callable. `input` declares the value and a synchronous pure `builder` places it. The application owns the endpoint, credentials, and client. Read the error-first tuple and return from the surrounding function before using a success value. Complete scripts wrap that call in a function so the return stays legal in ESM, and leave definitions and exports outside it. Ordinary Defjs faults stay on the tuple; exception-based adapters must be explicitly identified as integration-specific policies, not the default calling style. Preserve cancellation, retries, ETag handling, SSE/WebSocket runtime errors, and close or dispose ownership.

## Repository map

### `@defjs/core`

| Module         | Contents                                          |
| -------------- | ------------------------------------------------- |
| `client/`      | client creation, derivation, request options      |
| `error/`       | fault types and factory                           |
| `http/`        | request definitions, request building, transports |
| `xsrf/`        | browser-only `withXSRF` for `@defjs/core/xsrf`    |
| `sse/`         | event-stream definitions and transports           |
| `web_socket/`  | WebSocket definitions, codec, heartbeat           |
| `struct/`      | schema constructors, codecs, parsing              |
| `interceptor/` | interceptor types and built-ins                   |
| `internal/`    | shared internals; never exported from the package |

Specs live beside the source. `packages/core/test/` holds end-to-end specs and the shared fixture server (`packages/core/test/fixture/`); the naming table below decides which `core-<runtime>` projects run them.

### `doc`

| Path            | Contents                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| `doc/app/`      | site application, components, generated API data, routing, LLM output            |
| `doc/content/`  | guides and the 11 API overview pages per locale; entry pages are not stored here |
| `doc/examples/` | complete, typechecked examples embedded by content pages                         |
| `doc/scripts/`  | API extraction, build, build fingerprint, link check, site URL check             |

Documentation unit specs (`*.spec.ts`, run by the `doc-bun` project) sit beside the source in `app/`, `scripts/`, and `examples/`; there is no separate `doc/test/` directory. Specs are excluded from the build fingerprint, so editing one does not stale `doc/build`.

## Code conventions

- One directory per capability, with `index.ts` and `public_api.ts`. Extend the public API chain deliberately; adding a file under `internal/` does not make it public.
- Test file names select the runtime projects. The suffix before `.spec.ts` (or `.spec.tsx`) is the only selector:

  | Pattern             | Runs in                                            | Use for                         |
  | ------------------- | -------------------------------------------------- | ------------------------------- |
  | `*.spec.ts`         | every runtime project of the package               | behavior shared by all runtimes |
  | `*.chrome.spec.ts`  | Chrome (Playwright Chromium) only                  | engine-specific behavior        |
  | `*.firefox.spec.ts` | Firefox only                                       | engine-specific behavior        |
  | `*.node.spec.ts`    | Node.js only                                       | Node-specific behavior          |
  | `*.bun.spec.ts`     | Bun only                                           | Bun APIs                        |
  | `*.type.spec.ts`    | no runtime project; checked by `bun run typecheck` | type-level contracts            |

  Runtime sets per package: `packages/core` runs chrome, firefox, node and bun; `packages/react` and `packages/vue` run chrome and firefox; `packages/opentelemetry-server` runs node and bun; `doc` unit specs and the root `test/` run on bun.

- The part of the name before the suffix is free (`balancer.end.spec.ts`, `http.upload_progress.worker.chrome.spec.ts`), but its last segment must not be a reserved word: `browser`, `server`, `chromium`, `webkit`, `safari`, `deno`, `edge`, `workerd`, `chrome`, `firefox`, `node`, `bun`, `type`, `test`, `spec`. `x.node.spec.ts` is valid; `x.browser.spec.ts`, `x.chrome.node.spec.ts` and `x.type.node.spec.ts` are not. `.test.` test files do not exist, and file names use only lowercase letters, digits, `_`, `-` and `.`. `test/spec-naming.bun.spec.ts` enforces this and compares `vitest list` output of every project with the expected table.
- Do not skip inside a shared spec with `process.platform`-style checks. Put the test in the runtime-specific file. A package runs only the runtimes of its own `unit:<runtime>` scripts (React and Vue: chrome and firefox; OpenTelemetry: node and bun), so a runtime suffix that the package does not run fails the naming check instead of being ignored.
- TypeScript is strict: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `allowImportingTsExtensions`. Use `import type` for type-only imports. The root catalog pins `typescript` to the exact `7.1.0-beta`; a caret range would resolve to nightly `7.1.0-dev` builds.
- Type assertions are banned by lint: `x as T`, `<T>x`, and `as unknown as T` all fail (`@typescript-eslint/consistent-type-assertions` with `assertionStyle = "never"`). `as const`, `satisfies`, and import/export aliases are allowed. Fix the type at its source with annotations, generics, `satisfies`, or real narrowing; an overload whose implementation is wider than its signature without a real check is an assertion in disguise. A test that passes invalid input on purpose uses `@ts-expect-error` with a description. Keep an assertion only in a test that must violate types, where removing it measurably costs performance, or where the typed alternative would change runtime behaviour or what users can compile. Put `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PERF: <numbers>` or `-- INTENT: <the behaviour that would change>` on the line above. Do not hide an assertion behind a helper that casts.
- Lint rules that commonly bite: no `any`, and no `any` flowing in unnarrowed from an external API (bind `JSON.parse` and `.json()` results to `unknown` and narrow), no non-null assertions, no namespace imports, `@ts-ignore` banned, `@ts-expect-error` requires a description of at least 10 characters.
- Lint is oxlint, configured in `oxlint.config.ts`: every rule is spelled out, the project rules above plus a fixed set of ESLint and typescript-eslint rules, and `categories.correctness` is off so oxlint's own default set does not run on top. Type-aware rules run through `oxlint-tsgolint` (`options.typeAware`). `oxlint` and `oxlint-tsgolint` are exact pins in the root catalog and move together. Every enabled rule is an error; there is no warning level. An unused `eslint-disable` comment is an error as well, so a suppression that stops matching must be deleted. oxlint honors `eslint-disable-next-line @typescript-eslint/<rule>` comments and maps the names to its `typescript/` rules.
- `oxlint-tsgolint` 7.0.2006 does not apply `typescript/no-misused-promises` to a Promise-returning method shorthand that reaches a void callback through a union or optional type, so write such a callback as an arrow property.
- Project-specific lint rules live in `lint/plugin.ts` and load through `jsPlugins` in `oxlint.config.ts` (an ESLint-compatible rule; oxlint JS plugins are alpha, so `test/lint-plugin.bun.spec.ts` runs the real CLI). `defjs/prefer-typeof-switch` reports a rejecting chain of `typeof x !== "…" && …` comparisons on one plain identifier or `this` and asks for a `switch`; it does not report positive `||` / `===` chains or subjects that contain a call or property read, because a `switch` would change how often those run. The repository contains no JavaScript files; plugins and scripts are TypeScript.
- Formatting is Bun's built-in formatter: 2 spaces, LF, UTF-8, final newline. Run `bun fmt`.
- Write a comment only when the reason is non-obvious. Do not restate what the code does.
- Capture fixed configuration records by assigning each field, including nested owned records, and copy array containers. Preserve functions, signals, schemas, SDK handles, and other identity-bearing values. Keep absent optional configuration blocks `undefined` rather than creating empty placeholders. Do not add runtime field registries or per-field missing-versus-undefined handling. Keep dynamic dictionaries, wire serialization, security checks, and allowlists where the keys are not fixed.
- Commit messages follow the history: Conventional Commits with a package or area scope (`feat(core):`, `fix(doc):`, `docs:`, `refactor:`, `chore:`). Describe why, not a file tour.

## Working on a change

1. Read the reference document above and the current implementation plus its tests.
2. Find every caller of the function you are about to touch. Fix the shared boundary, not only the path named in the request.
3. Implement the smallest change that satisfies the behavior. No new runtime dependency, no speculative options, no unrelated refactors, no reformatting of untouched files.
4. Add or update tests in the same change. A regression test must fail before the fix and pass after it.
5. If the public API changes, sync these in the same change:
   - the package README when behavior is documented there;
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
git config core.hooksPath .githooks
```

Playwright browsers are needed by the Core, React, and Vue browser projects. Bun runs everything except the Node projects: `node --run unit:node` is the only command that needs Node.js, 24.2 or newer (native type stripping plus `import.meta.main`: the root `test/unit-node.ts` runs as TypeScript, and on older Node it would silently do nothing and exit 0). Local Node runs must use the package's own binary through `node --run`. Locally Node uses the packages Bun already installed; `npm ci` is for CI only, because it would replace the Bun-managed `node_modules` of `packages/core` and `packages/opentelemetry-server`. CI installs with `npm ci --ignore-scripts --workspaces=false` in `packages/core` and `packages/opentelemetry-server`. The packaging check (`test/assert-pack.ts`) runs in the release workflow, not in the unit gate. The pre-commit hook fixes the fully staged files and stages them again, only checks a file that also has unstaged changes (so it never stages them), formats the staged files and runs the type check. Type-aware lint reads the route types that `react-router typegen` writes to the ignored `doc/.react-router/` directory, so on a fresh checkout run `bun run --cwd doc typegen` before `bun run lint` (the hook and CI do).

Run these in order from the repository root and stop at the first failure. CI runs `checks` (gates 1, 2, 3) first. Once it passes, `build` (gate 5) and `unit-chrome`, `unit-firefox`, `unit-bun`, `unit-node` (gate 4 split by runtime) run in parallel.

| #   | Command                                                                                   | Covers                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `bun run lint`                                                                            | oxlint (type-aware) over the whole repository                                                                                        |
| 2   | `bun fmt --check`                                                                         | formatting for every file                                                                                                            |
| 3   | `bun run typecheck`                                                                       | library project, documentation app, TS/TSX examples                                                                                  |
| 4   | `bun run unit:chrome`, `bun run unit:firefox`, `bun run unit:bun`, `node --run unit:node` | one command per runtime: the chrome, firefox, bun and node projects; `unit:bun` includes the root `test/` specs and the naming check |
| 5   | `bun run build`                                                                           | all workspaces, including the static documentation site                                                                              |

A change is verified only when all five pass on the same revision. Gate 4 is one command per runtime, the same four that CI runs as separate jobs. `node --run unit:node` is the only one that needs Node.js: the runtime guard fails the Node projects when it detects Bun, and inside `bun run` a `node` command is Bun.

`bun fmt` is a Bun built-in, deliberately not wrapped in a script: there is no `fmt` script and `bun run fmt` does not exist. Linting is the `lint` script, which runs `oxlint`:

```bash
bun run lint       # verify
bun run lint:fix   # write fixes
bun fmt            # write
bun fmt --check    # verify
```

Every other command in the table is a repository script; gates 1, 3, 4 and 5 are resolved through `bun run`, and the Node projects of gate 4 through `node --run`.

### Workspace-local checks

Use these while iterating; the root `unit:<runtime>` scripts run the same ones.

```bash
bun run --cwd packages/core unit:bun
bun run --cwd packages/core unit:chrome
(cd packages/core && node --run unit:node)
bun run --cwd doc unit:bun
bun run --cwd doc typecheck
```

Pass a file to run one spec in its project, for example `bun run --cwd packages/core unit:bun -- src/client/client.spec.ts --coverage.enabled=false`. Each `unit:<runtime>` script runs its whole project with coverage and the 100% threshold, so a single-file run reports threshold failures for files it did not load; `--coverage.enabled=false` is what makes a single-file run useful. Use it to debug, and use the full script for the gate.

`bun run typecheck` at the root already includes the documentation type check.

### Runtimes

Most gates run on Bun. `bun run` follows `bunfig.toml` `[run] bun = true`; the root and each workspace have one, so scripts such as `vitest run` execute with Bun rather than the Node shebang in Vitest's binary. The browser projects (chrome, firefox) also have their main Vitest process on Bun; the browser only hosts the tests.

Node.js is a supported, tested runtime for the packages that define a `unit:node` script (`packages/core`, `packages/opentelemetry-server`). Run it with Node itself:

```bash
node --run unit:node                       # all Node projects from the root (test/unit-node.ts)
(cd packages/core && node --run unit:node) # one package
```

Each project's globalSetup calls the runtime guard (`test/runtime-guard.ts`): the `*-node` projects fail when Bun is detected (`This project must run on Node.js; use "node --run unit:node".`), and the `*-bun`, chrome and firefox projects fail when it is missing. `bun run unit:node` therefore fails by design.

### Documentation build

To rebuild only the documentation site:

```bash
bun run --cwd doc build
```

The build fails if its inputs change while it runs.

## Testing rules

- Fix a flaky test at its race. Do not add retries, sleeps, a longer global timeout, `.skip`, `.todo`, `skipIf`, `runIf`, or lowered coverage. Do not narrow a test selection to make a gate pass.
- Time-dependent tests follow the clock they actually need:
  - **Unit-level timing** (request timeouts, backoff, heartbeat, dispose grace, reconnect delay) uses fake timers: `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`, or only `'Date'` when a synchronous phase must outlast a real timer. Advance time only after the awaited event has happened (`advanceTimersByTimeAsync`; `vi.waitFor` advances fake timers on its own) and assert the code path that should have run — a call count or a state change — not elapsed wall time.
  - **Integration over a real socket or server** waits for the concrete event (`socket.closed`, the first frame, `open`) or a condition (`vi.waitFor` on observable state). Never assert on elapsed time. A liveness guard may race a promise that has no observable event, such as an execute expected to fail without a socket ever opening, but it is a safety net, not an assertion: name it in one short comment, use a budget that does not depend on machine speed (10s, not 2s), keep `timeout.unref?.()`, and still prove the behavior with the event wait and the code-path assertions.
  - **Real browser engines** run on real time. Wait for events and give a generous budget. Never use a tight window.
- Assert the bytes that were sent, not a runtime's re-parse of them. Bun's multipart parser drops a file part's `Content-Type`, so multipart tests compare the raw body (`packages/core/test/multipart-fixture.ts` and the `/e2e/echo-raw` route).
- Browser projects share a fixed Vitest port. Run one browser test process at a time. Firefox Vitest instances pass `browserLaunchEnv()` from `test/firefox-app-data.ts` so Firefox starts on macOS 27; the Chromium Vitest provider does not.
- The root `test/` specs (`*.bun.spec.ts`) run in the `root-bun` project as part of `unit:bun`. That is where the naming and selection check, the config check, the CI workflow check, the runtime guard checks, the catalog-sync check, the unit-node check, the no-skip reporter check, the spec-matrix check, the shared Vitest settings check, the XSRF runtime guard check, and the skill and lint-plugin specs live. Do not use `bun test` or `bun:test` imports; all specs use Vitest.
- A test observes behavior, or an independent public contract or generated artifact. Do not read an implementation file, a function's source text, or the layout of its dependencies as a stand-in for that observation. Text a transformer is specified to accept, and a check that authored documents meet a content rule, are contracts about that text; they are not covered by this prohibition.
- **No skipped tests.** Every runtime config registers `NoSkipReporter` (`test/no-skip-reporter.ts`); a test in the skipped or todo state fails the run, and no unit script or job uses `--passWithNoTests`. A test that does not apply to a runtime belongs in a file for the runtime that runs it. `test/vitest-configs.bun.spec.ts` checks that every runtime config, including the React and Vue base configs and all six browser configs, registers the reporter, enables istanbul coverage with 100% thresholds, and carries its project name `<package>-<runtime>` and browser instance; `test/ci-workflow.bun.spec.ts` pins the commands of every job and rejects `continue-on-error`, `if` on a job or on a step that runs a command, and any `shell` other than `bash` or `sh`.
- **Naming and selection check.** `test/spec-naming.bun.spec.ts` lists files with `git ls-files --cached --others --exclude-standard` (so unstaged new files count) and checks names against the naming table and the reserved words. It also runs `vitest list --filesOnly --json` for every project and compares the result with an independent expected table: plain specs in each runtime of their package, `.<runtime>.spec` in that runtime only, `*.type.spec.*` nowhere. The same table pins the `unit:*` scripts of every `package.json`. When you add a package or a runtime, update the expected table in that file as well as the configs.
- **Fixture server.** Shared HTTP, SSE and WebSocket endpoints for tests live in `packages/core/test/fixture/`. A test registers its own endpoints through `fixture(host, token)` on the data plane (`endpoint(name, scenario, params)`, then requests to the returned URL) and steers or inspects them on the control plane (`act`, `log`). Ids are random per test and `onTestFinished` deletes the state, so tests do not share endpoints or add a route to the shared app for one test. Control calls need the `x-fixture-token` header; data-plane calls do not. The business modules (`app.ts`, `data-plane.ts`, `control-plane.ts`, `raw-scenarios.ts`, `state.ts`) never import a runtime adapter (`@hono/bun`, `@hono/node-server`, `hono/bun`) and never touch `Bun`; only `startup-bun.ts` and `startup-node.ts` do. Modules under the root `test/` that Vite loads while bundling a config use only `node:` built-ins and `import type` from external packages, except `test/firefox-app-data.ts`, which uses `Bun` and is loaded only by the Firefox configs that run on Bun.

## Documentation site rules

- There are 11 locales: `en-US`, `zh-Hans`, `zh-Hant-TW`, `zh-Hant-HK`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `ru-RU`, `ar`. Every locale carries every guide; there is no fallback to English for guides. API reference text is English TSDoc in every locale. Each locale keeps only its 11 overview pages: `api/index.mdx`, `client.mdx`, `errors.mdx`, `http.mdx`, `interceptors.md`, `opentelemetry-server.mdx`, `react.mdx`, `sse.mdx`, `struct.md`, `vue.mdx`, and `web-socket.mdx`. The 194 entry URLs come from generated data, so `navigation.spec.ts` asserts 235 unique URLs per locale.
- Overview pages must not hand-copy a signature of a generated entry. Write `<ApiSignature name="withEndpoint" />`. Several names go in that attribute, comma-separated, in source order: `<ApiSignature name="ERR_ABORTED, ERR_TIMEOUT" />`. The MDX build replaces the tag with the generated signature before highlighting, so search and `llms` see the fence. An unknown or ambiguous name fails the build with the file path. `api-signatures.spec.ts` fails with `hand-copied signature of a generated entry` when a fence declares a catalog name. Example fences whose names are not entries stay hand-written.
- Complete TS/TSX examples live in `doc/examples/` and are embedded with `<include>`. The export scan understands only `export { ... }`, `export type { ... }`, declarations, and `export * from`; a new form such as `export type * as ns from` fails `doc/app/data/exports.spec.ts`.
- Vue single-file examples are not statically checked.
- The documentation unit tests execute the ETag, Bearer, and GraphQL recipes and assert their HTTP statuses and application outcomes.
- After rendering, the build checks local page links and anchors, including generated navigation and locale links.
- Run `bun run --cwd doc extract-api` after changing public exports or their TSDoc, and commit the three files it writes: `api-entries.json`, `api-reference.json`, and `api-summaries.json`. A public export needs an English, neutral TSDoc description. Use `@group` for its overview, `@see` for related exports, and `@exampleFile` for a type-checked example. Do not put site-relative links in comments; comments are the only input to generation. An export with no description fails extraction. Generation also fails when a signature is not syntactically valid TypeScript. `exports.spec.ts` still checks the catalog against the public exports in both directions, including kind.
- Extraction builds the program with `typescript/async` under Bun. Parameter and member tables come from `doc/scripts/type-tables.ts`, a Bun-native port of `fumadocs-typescript`'s entry generation. `fumadocs-typescript` is not a dependency, and no Node process is started.
- Set the repository variable `SITE_URL` to the confirmed HTTPS origin before deploying. Local builds default to localhost; the release job rejects a missing or local origin.

## Release and packaging

- The **Release** workflow is manual and pick-what-you-want. Versions come from the committed package manifests; nothing bumps them and no changesets are involved. Publishing invokes npm because it is the registry's OIDC trusted-publishing CLI; `bun publish` does not support npm trusted publishing (oven-sh/bun#22423). The packaging check (`bun test/assert-pack.ts <publish-dir>`) runs in the release workflow, where Node and Bun are both installed; it is not part of the unit gate.
- **Release tags are mandatory.** After confirming that a package was published successfully, create its own lightweight Git tag on the exact commit used for publication. A package release is not complete until its tag has been pushed and verified on the remote to point to that commit.
- Tag names are the package name without its `@defjs/` scope, `@`, then the published version: `core@0.6.0`, `react@0.0.3`, `vue@0.0.3`, `opentelemetry-server@0.0.3`. One tag per package, not one per release, because the packages version independently. Push explicit refs (`git push origin refs/tags/core@0.6.0`). The workflow neither reads nor creates tags, so a tag records a release and never drives one. `0.1.0`–`0.3.3` are the pre-convention core-only series; leave them in place.
- Each package builds with `tsdown` and publishes from `dist`. The build writes `dist/package.json`, copies `LICENSE` and the package `README.md`. The `build` scripts call `bun --bun tsdown`, so they run on Bun from any directory, not only the repository root.
- `bun test/assert-pack.ts <publish-dir>` must pass before publishing: it checks that `npm pack --dry-run` includes `LICENSE`, `README.md`, `package.json`, and every file referenced by the entry fields.
- Packages that depend on Core build Core first. A Core patch within the plugins' `^0.7.0` peer range does not require a plugin release.
- CI runs the five gates on pull requests and `main`, with gate 4 split into the jobs `unit-chrome`, `unit-firefox`, `unit-bun` and `unit-node`; the required checks are those four plus `checks` and `build`. The release workflow does not wait for CI; verify the intended revision first.

## Do not

- Run `bun run fmt`; the formatter is `bun fmt`.
- Edit generated output: `dist/`, `coverage/`, `doc/build/`, `doc/.react-router/`, `test-out/`.
- Reintroduce removed APIs: global client, `client.execute`, command objects, `executeHttpCommand` and the other `execute*Command` exports, `withTimeout`, the `timeout` and `abort` request options, `executeRaw`, `responseType`, `struct.request` / `struct.json` / `struct.text`, WebSocket custom handshake headers, OpenAPI generation.
- Add a `.js`, `.mjs`, or `.cjs` file anywhere in the repository.
- Put authentication or tracing into `builder`, or infer request placement from `input` field names.
- Add a runtime dependency to `@defjs/core`, or import Node-only modules into `packages/*/src`.
- Leave a new public export without TSDoc, or skip regenerating the API data.
- Add retries, sleeps, skips (`.skip`, `.todo`, conditional skips), platform checks in shared specs, or lowered coverage to make a gate pass.
- Add a `.test.` test file, a `.browser.spec` or `.server.spec` file, or name a spec with a reserved word as its last segment.
- Run the Node project under Bun (`bun run unit:node`) or the Bun project under Node.

## Definition of done

All five gates pass on the same revision. New behavior has an accompanying test, public API changes have TSDoc and regenerated API data, guide changes are reflected in every locale, and no unrelated file was reformatted or refactored. Every runtime project that the change touches passes with its own 100% coverage report.
