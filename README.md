<p align="center">
  <a href="https://github.com/defjs/defjs" target="_blank" rel="noopener noreferrer">
    <img width="200" src="logo.jpg" alt="logo">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/v/%40defjs%2Fcore?color=%23000&style=flat-square" alt="npm package"></a>
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/dm/%40defjs%2Fcore?color=%23000&style=flat-square" alt="monthly downloads"></a>
  <a href="https://github.com/defjs/defjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/defjs/defjs/ci.yml?branch=main&color=%23000&style=flat-square" alt="build status"></a>
  <a href="https://github.com/defjs/defjs/blob/main/LICENSE"><img src="https://img.shields.io/github/license/defjs/defjs?color=%23000&style=flat-square" alt="license"></a>
</p>
<br/>

## Introduction

`def` is an abbreviation for `define`, so it can be read as `define js`.

Defjs is a TypeScript library for defining typed HTTP, SSE, and WebSocket APIs over standard Web APIs.

- Typed HTTP, SSE, and WebSocket command definitions.
- Runtime validation and full TypeScript inference.
- Streaming support.
- Interceptor support.
- Works in browser and server applications that provide the required platform transports.
- Bun `1.4.3` drives repository development, testing, and builds; release jobs use `npm publish`.
- ESM. `@defjs/core` declares no runtime dependencies.

## Quick Start

Install the core package in your application:

```sh
bun add @defjs/core
```

Use the documentation and release notes that match the version installed in your project.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))

const getUser = defineRequest({
  method: 'GET',
  path: '/v1/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, user] = await client.execute(getUser({ id: 1 }))
if (error) {
  console.error(error.code)
} else {
  console.log(user.name)
}
```

`input` defines the caller's parameters; `builder` explicitly places them on the request. Declaring `input` requires `builder` for HTTP, SSE, and WebSocket endpoints. Only definitions without `input` may omit it.

## Documentation

The full guides live in `doc/` and cover HTTP, SSE, WebSocket, Structs, interceptors, errors, React, Vue, and server-side OpenTelemetry integration.

- Each package tarball keeps its package `README.md` and the repository `LICENSE`; repository-wide guides and examples are not packed.
- Contributors working from the current checkout can start with `doc/content/en-US/docs/start.mdx`; these source docs can describe unreleased changes.
- Choose one of the 11 language tracks from the documentation site.
- Match the documentation to the package version installed in your application.

## Repository packages

| Package                                                        | Purpose                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@defjs/core`](packages/core)                                 | Typed HTTP, SSE, and WebSocket client definitions and execution.                             |
| [`@defjs/react`](packages/react)                               | React thin adapter for sharing a typed core client through `ClientProvider` and `useClient`. |
| [`@defjs/vue`](packages/vue)                                   | Vue thin adapter for providing and injecting a typed core client.                            |
| [`@defjs/opentelemetry-server`](packages/opentelemetry-server) | Server-side outbound OpenTelemetry instrumentation for core clients.                         |

## Repository tasks

Repository commands are classified by scope. A command being exposed at the root does not mean every workspace should implement it.

| Scope                          | Commands                                                                                                      | Execution model                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Repository-wide checks         | `bun run verify`, `bun run typecheck`, `bun run fmt`, `bun run fmt:check`, `bun run lint`, `bun run lint:fix` | `verify` runs lint, formatting, type checks, workspace tests, builds, and documentation browser tests in order. |
| Workspace aggregation          | `bun run test`, `bun run build`                                                                               | The root delegates to workspace-owned tasks; `build` generates artifacts without running the full type check.   |
| Workspace-local lifecycle      | Package `build`/`test`, documentation `build`/`typecheck`                                                     | Each workspace handles its own output, tests, or documentation type-checking configuration.                     |
| Explicit, on-demand operations | Documentation `dev`/`preview`                                                                                 | Start the documentation development or preview server when needed.                                              |

Formatting and linting are repository-wide gates. The root `typecheck` checks the library project and delegates to the documentation workspace for its separate configuration. The Bun CI job uses the root `verify` gate. Separate CI jobs run Core's `core-server` and OpenTelemetry tests on Node 24, and smoke-test the built Core bundle's HTTP, SSE, WebSocket, and Struct APIs on Deno 2.

`bun run typecheck` uses Bun's built-in checker. Documentation `typecheck` generates route types, checks the documentation project, and checks complete code examples. TypeScript remains installed for editor and declaration build tooling.

<!-- shortcut: @types/bun has not published 1.4.3; remove the bun-types override when upgrading the wrapper to a version that depends on bun-types 1.4.3 or later. -->

Tests and builds are intentionally different. Their environments, configurations, and outputs belong to specific workspaces, so the root commands aggregate the relevant workspace lifecycle scripts.

Documentation type checks cover the complete TS/TSX examples in `doc/examples`, which content pages embed with `<include>`; signature sketches and fragments stay plain code blocks. The documentation workspace tests execute the ETag, Bearer, and GraphQL recipes and assert their HTTP statuses and application outcomes. After rendering, its build checks local page links and anchors, including generated navigation and locale links. Every locale carries every page; there is no fallback to English.

### Test conventions

- Run tests the way CI does. The root `bunfig.toml` sets `[run] bun = true`, so `bun run verify` and the root workspace `test` run Vitest and the local test servers on Bun, while `bun run test` inside `packages/core` runs them on Node. A change is accepted only when both pass.
- Deadline and timeout tests never race the wall clock. Fake time explicitly (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`, or only `'Date'` when a synchronous phase must outlast a real timer), advance it only after the awaited event has happened, and assert the code path that was meant to run, such as a builder or interceptor call count, not only the final fault code. A real `timeout` of a few milliseconds combined with an unconditional `await` on something that only happens before the deadline is a flake.
- Fix a flake at its race. Do not add `retry` or longer sleeps.
- Assert the bytes that were sent, not a runtime's re-parse of them. Bun's multipart parser drops a file part's `Content-Type`, so multipart tests compare the raw body (`packages/core/test/multipart-fixture.ts` and the `/e2e/echo-raw` route).
- Browser projects share a fixed Vitest port, so run one browser test process at a time. Every Playwright launch passes `browserLaunchEnv()` from `test/firefox-app-data.ts` so Firefox starts on macOS 27.

## Release workflow

Package versions live in their own manifests and advance independently. The repository does not use generated changeset files or coordinated workspace version bumps.

Run the **Release** workflow manually in GitHub Actions for the intended revision. Select any combination of packages or documentation:

- `core`, `opentelemetry-server`, `react`, or `vue` publishes the selected package to npm.
- `docs` builds and deploys the documentation to GitHub Pages using the configured `SITE_URL`.

Each selected package job runs `bun ci`, typechecks that package's build configuration, builds it, and asserts that `npm pack --dry-run` includes `LICENSE`, `README.md`, `package.json`, and the files referenced by `exports` / `types` before using `npm publish` from its `dist` directory with the repository's `NPM_TOKEN` secret. Packages that depend on Core build Core first. This is a packed-file check, not a gate that installs tarballs into an external consumer and typechecks or runs it. Versions come from the committed package manifests; the workflow does not bump versions or require release tags.

CI runs the Bun verification gate, Node 24 tests, and Deno built-Core smoke test on pull requests and `main`. The manual release workflow does not require a `main` commit or wait for CI; run `bun run verify` on the intended revision before starting it. A Core patch within the adapters' `^0.4.0` peer range, such as `0.4.0` to `0.4.3`, does not require another adapter release; publish an adapter only when its own artifact, implementation, public metadata, or peer range changes.

### Dependency ownership

- The repository root owns repository-wide gates, root-shared test sources, and CI test bootstrap tools.
- Each workspace directly owns its build and test tools and any required peer dependencies.
- The same version declared by multiple workspaces is not incorrect duplication when each owner actually uses it.

## Status and Roadmap

### Implemented in this repository source today

- Typed HTTP, SSE, and WebSocket command definitions in `@defjs/core`.
- Thin framework adapters for React and Vue.
- Server-side outbound OpenTelemetry instrumentation for defjs clients.
- Documentation source and local Fumadocs, React Router, and Vite tooling in `doc/`.

See the package READMEs and the metadata for the published releases you install to confirm exact npm availability and API surface.

### Planned

- CLI tool.
- Generate API definitions from OpenAPI.
- Generate full SDK packages for larger API surfaces.

### Non-goals / boundaries

- Framework adapters are not query/cache/state libraries.
- OpenTelemetry integration does not initialize the OpenTelemetry SDK for you.
- Request/response bodies, full headers, raw query strings, and stream/message payloads are not captured by default.
- CLI and code generation are not delivered packages yet.

## Adoption note

Repository development baseline: Bun `1.4.3`.

These values describe this repository's contributor baseline, not a blanket requirement for every consumer application that installs a published package.

Most defjs packages are still evolving before stable 1.0; overall API may evolve.

## License

[MIT](LICENSE)

## Reference

- [Axios](https://axios-http.com)
- [Zod](https://zod.dev)
- [Deepkit Framework](https://github.com/deepkit/deepkit-framework)
- [tRPC](https://trpc.io)
- [Google API design guide](https://cloud.google.com/apis/design)
- [Tanstack Query](https://tanstack.com/query)
- [Rxjs](https://rxjs.dev)

Documentation uses Fumadocs with React Router and Vite, built entirely with Bun. Run `bun run --cwd doc dev` locally; the static output is `doc/build/client`. `bun run typecheck` checks workspace sources, the documentation application and the complete TS/TSX examples in `doc/examples`, which pages embed with `<include>`. Vue single-file examples are not statically checked. `bun run verify` also builds and tests the actual static site in Chromium and Firefox.

Set the repository variable `SITE_URL` to the confirmed HTTPS origin before deploying docs. Local builds default to localhost; the release job rejects a missing or local origin.
