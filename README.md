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

**Designed for better SDKs.**

Defjs helps teams design, build, and publish TypeScript SDKs. `def` stands for `define`: define your service's API once, export it from your SDK, and let each application choose how to execute it.

SDK authors describe operations, inputs, request mapping, responses, and errors. SDK consumers create their own Defjs client with the service address, credentials, interceptors, and transport their application needs. An API definition does not bind a particular client instance or start a request when it is imported.

This separation lets a company publish its API definitions to npm and reuse them across applications with different runtime configurations. Both sides use the Defjs execution contract; SDK authors can also provide optional client factories or convenience methods while keeping the definitions available.

- Reusable HTTP, SSE, and WebSocket API definitions.
- Runtime validation and TypeScript inference for SDK inputs and results.
- Streaming contracts with caller-owned cancellation and cleanup.
- Application-configured clients and interceptors.
- Works in browser and server applications that provide the required platform transports.
- Bun `1.4.4` drives repository development, testing, and builds; release jobs use `npm publish`.
- ESM. `@defjs/core` declares no runtime dependencies.

## Quick Start

Install Core to define an SDK or execute its API definitions:

```sh
bun add @defjs/core
```

Use the documentation and release notes that match the version installed in your project.

```ts
// users-sdk.ts — exported by the SDK
import { defineRequest, struct } from "@defjs/core";

export const getUser = defineRequest({
  method: "GET",
  path: "/v1/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});
```

The consuming application owns the client and the call:

```ts
// app.ts
import { createClient, withEndpoint } from "@defjs/core";
import { getUser } from "./users-sdk.ts";

const client = createClient(withEndpoint("https://api.example.com"));
const [error, user] = await client.execute(getUser({ id: 1 }));
if (error) {
  console.error(error.code);
} else {
  console.log(user.name);
}
```

`input` defines the caller's parameters; `builder` explicitly places them on the request. Declaring `input` requires `builder` for HTTP, SSE, and WebSocket endpoints. Only definitions without `input` may omit it.

Calling `getUser(...)` creates a command; `client.execute(...)` performs the work. Publish `getUser` from a package such as `@company/users-sdk`, and consumers replace the local import with that package name. They can configure another client without rewriting the API definition.

Follow the [quick start](doc/content/en-US/docs/start.mdx), then [build and publish an SDK](doc/content/en-US/recipes/publish-http-sdk.mdx). The [design decisions](doc/content/en-US/docs/design-decisions.mdx) explain how contracts, execution, and ownership support that separation.

## Documentation

The full guides live in `doc/` and follow the SDK lifecycle: define contracts and operations, test and package them, then configure execution in the consuming application. HTTP, SSE, WebSocket, React, Vue, and server-side OpenTelemetry share that division of responsibility.

- Each package tarball keeps its package `README.md` and the repository `LICENSE`; repository-wide guides and examples are not packed.
- Contributors working from the current checkout can start with `doc/content/en-US/docs/start.mdx`; these source docs can describe unreleased changes.
- Choose one of the 11 language tracks from the documentation site.
- Match the documentation to the package version installed in your application.

## Repository packages

| Package                                                        | Purpose                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`@defjs/core`](packages/core)                                 | Define typed SDK operations for HTTP, SSE, and WebSocket; execute them with application-owned clients.         |
| [`@defjs/react`](packages/react)                               | React plugin for sharing a typed core client through `ClientProvider` and `useClient`.                         |
| [`@defjs/vue`](packages/vue)                                   | Vue plugin for providing and injecting a typed core client.                                                    |
| [`@defjs/opentelemetry-server`](packages/opentelemetry-server) | Middleware plugin that appends server-side outbound OpenTelemetry interceptors to an application-owned client. |

## Repository tasks

Repository commands are classified by scope. A command being exposed at the root does not mean every workspace should implement it.

| Scope                          | Commands                                                                   | Execution model                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Repository-wide checks         | `bun run typecheck`, `bun fmt --check`, `bun run lint`, `bun run lint:fix` | Each command runs exactly one repository-wide gate.                                                       |
| Workspace aggregation          | `bun run test:unit`, `bun run test:e2e`, `bun run build`                   | The root delegates to workspace-owned tasks; `test:e2e` drives the built documentation site in a browser. |
| Workspace-local lifecycle      | Package `build`/`test:unit`, documentation `build`/`typecheck`             | Each workspace handles its own output, tests, or documentation type-checking configuration.               |
| Explicit, on-demand operations | Documentation `dev`                                                        | Start the development server when needed.                                                                 |

Formatting and linting are repository-wide gates. Formatting uses Bun's built-in `bun fmt`, which is not wrapped in a script: run `bun fmt` to write and `bun fmt --check` to verify. The root `typecheck` checks the library project and delegates to the documentation workspace for its separate configuration. The Bun CI job runs `lint`, `bun fmt --check`, `typecheck`, `test:unit`, `build` and `test:e2e` as separate steps, so a failure names the gate that broke. A separate CI job runs Core's `core-server` and OpenTelemetry tests on Node 24.

`bun run typecheck` uses Bun's built-in checker. Documentation `typecheck` generates route types, checks the documentation project, and checks complete code examples. TypeScript remains installed for editor and declaration build tooling.

<!-- shortcut: @types/bun has not published 1.4.3; remove the bun-types override when upgrading the wrapper to a version that depends on bun-types 1.4.3 or later. -->

Tests and builds are intentionally different. Their environments, configurations, and outputs belong to specific workspaces, so the root commands aggregate the relevant workspace lifecycle scripts.

Documentation type checks cover the complete TS/TSX examples in `doc/examples`, which content pages embed with `<include>`; signature sketches and fragments stay plain code blocks. The documentation workspace tests execute the ETag, Bearer, and GraphQL recipes and assert their HTTP statuses and application outcomes. After rendering, its build checks local page links and anchors, including generated navigation and locale links. Every locale carries every page; there is no fallback to English.

### Test conventions

- Run tests the way CI does. The root `bunfig.toml` sets `[run] bun = true`, so `bun run test:unit` at the root and inside `packages/core` stay on Bun. The Node 24 job does not run that script. It runs `bunx --no-install vitest` for `packages/core`'s `core-server` project and for `packages/opentelemetry-server`, as in `.github/workflows/ci.yml`. A change is accepted only when both jobs pass.
- Deadline and timeout tests never race the wall clock. Fake time explicitly (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })`, or only `'Date'` when a synchronous phase must outlast a real timer), advance it only after the awaited event has happened, and assert the code path that was meant to run, such as a builder or interceptor call count, not only the final fault code. A real `timeout` of a few milliseconds combined with an unconditional `await` on something that only happens before the deadline is a flake.
- Fix a flake at its race. Do not add `retry` or longer sleeps.
- Assert the bytes that were sent, not a runtime's re-parse of them. Bun's multipart parser drops a file part's `Content-Type`, so multipart tests compare the raw body (`packages/core/test/multipart-fixture.ts` and the `/e2e/echo-raw` route).
- Browser projects share a fixed Vitest port, so run one browser test process at a time. Firefox Vitest instances pass `browserLaunchEnv()` from `test/firefox-app-data.ts` so Firefox starts on macOS 27. The Chromium Vitest provider does not.

## Release workflow

Package versions live in their own manifests and advance independently. The repository does not use generated changeset files or coordinated workspace version bumps.

Run the **Release** workflow manually in GitHub Actions for the intended revision. Select any combination of packages or documentation:

- `core`, `opentelemetry-server`, `react`, or `vue` publishes the selected package to npm.
- `docs` builds and deploys the documentation to GitHub Pages using the configured `SITE_URL`.

Each selected package job runs `bun ci`, typechecks that package's build configuration, builds it, and asserts that `npm pack --dry-run` includes `LICENSE`, `README.md`, `package.json`, and the files referenced by `exports` / `types` before using `npm publish` from its `dist` directory with the repository's `NPM_TOKEN` secret. Packages that depend on Core build Core first. This is a packed-file check, not a gate that installs tarballs into an external consumer and typechecks or runs it. Versions come from the committed package manifests; the workflow does not bump versions or require release tags.

CI runs the Bun checks and Node 24 tests on pull requests and `main`. The manual release workflow does not require a `main` commit or wait for CI; run the same checks on the intended revision before starting it. A Core patch within the plugins' `^0.4.0` peer range, such as `0.4.0` to `0.4.3`, does not require another plugin release; publish a plugin only when its own artifact, implementation, public metadata, or peer range changes.

### Dependency ownership

- The repository root owns repository-wide gates, root-shared test sources, and CI test bootstrap tools.
- Each workspace directly owns its build and test tools and any required peer dependencies.
- The same version declared by multiple workspaces is not incorrect duplication when each owner actually uses it.

## Status and Roadmap

### Implemented in this repository source today

- Handwritten SDKs built from reusable HTTP, SSE, and WebSocket definitions in `@defjs/core`, independent of a particular client instance.
- Thin framework plugins for React and Vue.
- A middleware plugin for server-side outbound OpenTelemetry on defjs clients.
- Documentation source and local Fumadocs, React Router, and Vite tooling in `doc/`.

See the package READMEs and the metadata for the published releases you install to confirm exact npm availability and API surface.

### Planned

These items would automate SDK authoring; writing and publishing a package of definitions is already supported.

- CLI tool.
- Generate API definitions from OpenAPI.
- Generate full SDK packages for larger API surfaces.

### Non-goals / boundaries

- Framework plugins are not query/cache/state libraries.
- The OpenTelemetry server middleware plugin does not initialize the OpenTelemetry SDK for you.
- Request/response bodies, full headers, raw query strings, and stream/message payloads are not captured by default.
- CLI and code generation are not delivered packages yet.

## Adoption note

Repository development baseline: Bun `1.4.4`.

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

Documentation uses Fumadocs with React Router and Vite, built entirely with Bun. Run `bun run --cwd doc dev` locally; the static output is `doc/build/client`. `bun run typecheck` checks workspace sources, the documentation application and the complete TS/TSX examples in `doc/examples`, which pages embed with `<include>`. Vue single-file examples are not statically checked. `bun run build` then `bun run test:e2e` tests the actual static site in Chromium.

Set the repository variable `SITE_URL` to the confirmed HTTPS origin before deploying docs. Local builds default to localhost; the release job rejects a missing or local origin.
