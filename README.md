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
  <a href="https://codecov.io/gh/defjs/defjs"><img src="https://img.shields.io/codecov/c/gh/defjs/defjs?color=%23000&style=flat-square" alt="codecov"/></a>
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
- Bun `1.4.3` is the repository's only development, test, build, packaging, and publishing runtime.
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
- Contributors working from the current checkout can start with `doc/guide/getting-started.md`; these source docs can describe unreleased changes.
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

| Scope                          | Commands                                                                                 | Execution model                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Repository-wide checks         | `bun run verify`, `bun run fmt`, `bun run fmt:check`, `bun run lint`, `bun run lint:fix` | `verify` is the complete CI and local pre-release gate, including packed-consumer verification.      |
| Workspace aggregation          | `bun run test`, `bun run build`                                                          | The root delegates to workspace-owned tasks; `build` first runs the repository-wide type check once. |
| Workspace-local lifecycle      | Package `build`/`test`, documentation `build`                                            | Each workspace handles only its own tests or output.                                                 |
| Explicit, on-demand operations | `bun run test:release`, `bun run test:packed`, documentation `dev`/`preview`             | Focused checks remain available when the full gate is unnecessary.                                   |

Formatting, linting, and TypeScript checking are repository-wide gates. Workspace manifests must not duplicate them, and CI must not invoke them through `bun run --workspaces`, `--filter`, or per-package filters.

`bun run typecheck` uses Bun's built-in checker. TypeScript remains installed for editor and build tooling; documentation keeps its own TypeScript version for Twoslash compatibility.

<!-- shortcut: @types/bun has not published 1.4.3; remove the bun-types override when upgrading the wrapper to a version that depends on bun-types 1.4.3 or later. -->

Tests and builds are intentionally different. Their environments, configurations, and outputs belong to specific workspaces, so the root commands aggregate the relevant workspace lifecycle scripts.

Documentation builds typecheck code fences marked `twoslash`, including the SSE/WebSocket API quick starts and executable recipes, and fail on unexpected TypeScript errors. API signature sketches and incomplete fragments are not standalone programs. The documentation workspace tests execute the ETag and Bearer recipes and assert their actual status transitions. After rendering, its build checks local page links and anchors, including generated navigation and locale links. Missing translations display an explicit notice and include the English source so fixes stay synchronized.

## Release workflow

Package versions live in their own manifests and advance independently. The repository does not use generated changeset files or coordinated workspace version bumps.

Push one package-specific tag on the commit you want to publish. The tag version must match that package's manifest:

- `release-core-vX.Y.Z`
- `release-opentelemetry-server-vX.Y.Z`
- `release-react-vX.Y.Z`
- `release-vue-vX.Y.Z`

CI runs the full Bun verification gate on pull requests and `main`. Pushing a matching tag automatically starts the release workflow: it runs `bun ci`, validates the tag and selected manifest through `release-target.ts`, runs `bun --bun run build` only for that package, and publishes from its `dist` directory using the repository's `NPM_TOKEN` secret. Creating a local tag alone does not publish. The release workflow does not require a `main` commit or wait for CI; run `bun run verify` on the intended release commit before pushing its tag. A Core patch within the adapters' `^0.4.0` peer range, such as `0.4.0` to `0.4.3`, does not require another adapter release; publish an adapter only when its own artifact, implementation, public metadata, or peer range changes.

### Dependency ownership

- The repository root owns repository-wide gates, root-shared test sources, and CI test bootstrap tools.
- Each workspace directly owns its build and test tools and any required peer dependencies.
- The same version declared by multiple workspaces is not incorrect duplication when each owner actually uses it.

## Status and Roadmap

### Implemented in this repository source today

- Typed HTTP, SSE, and WebSocket command definitions in `@defjs/core`.
- Thin framework adapters for React and Vue.
- Server-side outbound OpenTelemetry instrumentation for defjs clients.
- Documentation source and local VitePress tooling in `doc/`.

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
