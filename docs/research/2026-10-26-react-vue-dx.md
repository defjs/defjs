# @defjs/react and @defjs/vue: DX and completeness under the Client injection responsibility

Research date: 2026-10-26. The evaluation covers only the current project, the current branch `feat/up`, commit `da1a33fa`, and the local working tree. Other branches, other Defjs versions, public release channels, and their documentation are not used as the basis for this report's evaluation.

## 1. Conclusion and evaluation boundary

**Evaluated against the responsibility of "making it convenient to set and get an application-managed Client," the core functionality of both adapters is already complete, the implementation is concise, and it has direct test coverage. There is no evidence that these two packages should be improved by adding a Query layer, business state management, or a dedicated Query bridging API.**

Defjs's primary abstraction is a reusable define contract; the Client is separate from the definition. An application can choose to:

- use a framework adapter to set and get the Client in the component tree;
- directly import a fixed Client it created itself;
- pass the Client through function arguments or some other organization of its own.

These are all application design choices. Using React/Vue does not mean `@defjs/react` / `@defjs/vue` must be used; the adapters are an optional convenience, not a required entry point for SDK execution.

This report evaluates only: whether setting is direct, whether getting is reliable, whether the real Client and its type are preserved, whether scope follows framework conventions, whether errors are clear, and whether unrequested policy and side effects are introduced.

Completeness of these two packages is not measured by the quantity of loading/error state, cache, request deduplication, automatic refresh, retry, mutation, optimistic updates, pagination, offline persistence, Query hydration, or Devtools. These are not missing features, and they are not an implied follow-on roadmap.

### Correction to the previous evaluation

The previous version treated "a complete application data-access experience" as an additional standard and, on that basis, proposed priorities such as official Query recipes and bridging factories, which expanded the adapters' responsibility. Investigation of other Defjs branches and versions also went beyond the scope of this evaluation. Those conclusions and improvement priorities have been withdrawn and are no longer treated as gaps on the current branch.

## 2. Design split: definition, execution, and how the Client is obtained

| Layer                  | Responsibility                                                                 | Who decides                                                       |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| SDK definition         | Define contracts such as input, mapping, output, and errors                    | SDK author                                                        |
| Core Client            | Execute commands according to the application's configuration                  | Creating and configuring the Client is decided by the application |
| React/Vue adapter      | Set an existing Client and get it from the framework context                   | The application decides whether to adopt it and where to set it   |
| How the Client is used | Call it directly, write logic by hand, or plug in any request or state library | Entirely decided by the application                               |

The adapter does not need to unify the application's choice at the last layer. An application that chooses not to use a Query library does not thereby become an incomplete way of using Defjs; choosing to import the Client directly is not bypassing a mandatory official architecture.

Both of the following usages are valid; the only difference is where the Client comes from.

Obtained through the React adapter:

```ts
import { useClient } from "@defjs/react";

const client = useClient();
```

Imported directly by the application:

```ts
import { client } from "./client";
```

`useClient()` must be called from a legal React hook call site; the second approach has no such framework-context requirement. How the Client is used after it is obtained is not decided by the adapter.

If a Client created by the application captures request identity or credentials, the application needs to choose a suitable isolation approach. That does not amount to forbidding a module-level Client, nor does it mean the adapter should automatically create or manage request-scoped instances.

## 3. DX evaluation of the current implementation

### 3.1 React: provide explicitly, read explicitly

The public runtime API is `ClientProvider` and `useClient`, plus the exported `ClientProviderProps` type.

```tsx
<ClientProvider client={client}>
  <App />
</ClientProvider>
```

```ts
const client = useClient();
```

Characteristics of the current implementation:

- `ClientProvider` receives an existing Client; it does not create one, clone one, or replace the application's instance.
- `useClient()` returns the real Client from the nearest provider and does not add another request API layer.
- Override by nested providers is determined by React Context's native rules.
- Changes to the `client` prop follow ordinary Context update semantics and do not additionally introduce a remount or disposal policy.
- When a provider is missing, it throws a clear error with handling guidance and does not silently fall back to a global default Client.
- Unmounting the provider does not actively cancel HTTP or close SSE/WebSocket; it does not own all work started through the Client.

**Judgment: the set and get paths are short, types are transparent, and scope is intuitive, which matches this package's actual goal.**

Evidence: [React implementation](../../packages/react/src/core.ts) lines 11–60, [public exports](../../packages/react/src/public_api.ts), [React README](../../packages/react/README.md).

### 3.2 Vue: native provide/inject semantics

The public API is `createClientPlugin`, `injectClient`, and `HTTP_CLIENT`.

```ts
app.use(createClientPlugin(client));
```

```ts
const client = injectClient();
```

Subtree override uses the native Vue API:

```ts
provide(HTTP_CLIENT, childClient);
```

Characteristics of the current implementation:

- The plugin only provides the Client passed in by the application; it does not take over configuration or execution.
- `injectClient()` returns the Client from the nearest scope, preserving instance identity and the Core type.
- `HTTP_CLIENT` is public so users can override a subtree with the native provider without learning an extra configuration system.
- When a legal injection context is missing or the Client has not been set, the error states both conditions.
- The Client is not automatically wrapped in a ref, and no dynamic replacement or resource-release policy is introduced.

**Judgment: this matches Vue's injection conventions. There is no need to rename `injectClient` so that it matches React on the surface, and no need to add a reactive request API in the name of "completeness."**

Evidence: [Vue implementation](../../packages/vue/src/core.ts) lines 10–55, [public exports](../../packages/vue/src/public_api.ts), [Vue README](../../packages/vue/README.md).

### 3.3 Completeness matrix inside the adapters

| Evaluation item                    | Current behavior                                                            | Conclusion                                                   |
| ---------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Set an existing application Client | React provider / Vue plugin                                                 | Implemented                                                  |
| Get the Client that was set        | `useClient` / `injectClient`                                                | Implemented                                                  |
| Instance identity                  | Returns the original instance; no clone, no wrapper                         | Tests exist                                                  |
| Subtree scope                      | The nearest Context/provider takes effect                                   | Tests exist                                                  |
| Feedback when nothing is set       | Throws an Error with usage guidance                                         | Tests exist                                                  |
| Type transparency                  | Returns Core's `Client`                                                     | No separate request-type layer is invented                   |
| Framework idiom                    | React Context/hooks; Vue plugin/provide/inject                              | Consistent with each native model                            |
| Policy restraint                   | Does not create a Client and does not automatically execute or release work | Matches the responsibility, rather than a lack of capability |
| Freedom not to use the adapter     | The application can still import directly or pass the Client itself         | Should continue to be preserved                              |

"Core responsibility is complete" does not prove that every runtime environment, concurrency case, and framework behavior is free of problems; but an unverified scenario cannot be automatically rewritten as a reason to expand the product's responsibility.

## 4. How comparison with TanStack Query, SWR, and similar solutions should be made

Comparison with market solutions is used to separate the problems each one solves, not to require the Defjs adapter to fill in their features.

| Solution                      | Main problem solved                                                     | Meaning for evaluating the current adapters                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@defjs/react` / `@defjs/vue` | Set and get the application's own Core Client through framework context | The object this report evaluates directly                                                                                                         |
| TanStack Query                | Query state, cache, invalidation, and related execution coordination    | Its QueryClient and the Defjs Core Client have different responsibilities; the injection adapter cannot be scored by the number of cache features |
| SWR                           | Key/fetcher-based data reading, refresh, mutation, and so on            | The application can choose whether to combine them; that is no reason to change the Client-getting API                                            |
| RTK Query                     | API endpoints and data fetching plus cache state inside Redux           | Redux/store organization is not an architecture the Defjs adapter should impose on users                                                          |
| Pinia Colada                  | Query state and cache in the Vue/Pinia ecosystem                        | A reactive query key does not mean the injected Core Client must become a reactive query abstraction                                              |
| alova                         | Request Method and a variety of request-interaction strategies          | The request-policy scope it takes on is different, and it cannot be used to infer that the Defjs adapter needs the same kind of hooks             |

What can be learned from these solutions is: whether responsibility names are clear, who creates the configuration object, whether context boundaries are intuitive, and whether errors help the user locate the problem. These still belong to the adapter's own DX.

**This is not a basis for new requirements such as `useRequest/useQuery/useMutation`, a query options factory, or automatic resource cleanup, and the absence of dedicated Query recipes is not treated as incompleteness of these two adapters.** Users who choose to compose things themselves can have their own wrappers; that choice does not automatically become a public-API obligation of this project.

The comparison above continues to use official documentation read earlier and keeps only responsibility-level information. This round did not continue investigating other Defjs branches, other versions, or release status.

## 5. Quality observations that still hold on the current branch

These observations concern only verification of existing examples or existing contracts. They do not change the adapter's responsibility, and this revision does not schedule feature expansion.

### 5.1 One existing documentation example has an inaccurate error state

In [the React basic example](../../doc/examples/react/basic-setup.tsx) lines 23–31, on failure `name` is set to `undefined`, and then `undefined` is rendered as `Loading...`.

```tsx
setName(error ? undefined : user.name);

return <span>{name ?? "Loading..."}</span>;
```

This is a display-logic problem in a specific example, not a problem with `ClientProvider/useClient`, and it cannot be used to infer that the adapter should manage loading/error. Another example in the package README already displays `error.message`, so this should not be generalized to every React document.

### 5.2 The check scope of Vue SFC examples is limited

[The example tsconfig](../../doc/examples/tsconfig.json) includes TS/TSX; [the Vue module declaration](../../doc/examples/vue.d.ts) only declares how to import `*.vue` and does not check the contents of an SFC. The root [README](../../README.md) line 193 also states this limitation explicitly.

This means a passing TS/TSX check cannot be written up as if Vue SFCs had also been checked. It is not a missing type capability of the Vue adapter, and it does not mean a Query dependency needs to be introduced for the adapter.

### 5.3 Test conclusions should match actual coverage

Existing tests verify instance identity, nested scope, the error when a provider is missing, and some real HTTP rendering plus interceptor-scope behavior through an injected Client.

Native interactions such as a React provider replacing `client` do not have a dedicated regression case, which does not mean the current behavior is wrong. If the related implementation is changed later, targeted verification can be chosen around that existing contract, rather than expanding the goal into tests of a full business data layer.

## 6. Verification evidence and the scope of this revision

Previously, on the same commit and the same business implementation, the following were executed:

| Verification                       | Actual result                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| React adapter browser tests        | 12 executions passed, including Chromium and Firefox                                      |
| Vue adapter browser tests          | 18 executions passed, including Chromium and Firefox                                      |
| Coverage of both adapters          | All four coverage metrics of each `core.ts` are 100%, not 100% of the entire Core package |
| Core and both adapter builds       | Exit 0 after using the Bun runtime required by the project                                |
| React build entry                  | The actual JS entry keeps `'use client'`                                                  |
| Build type checks of both adapters | 3 files each passed                                                                       |
| Documentation example type check   | 179 included files passed; Vue SFC content is not checked                                 |

The first independent check of the build configuration was missing Core declaration artifacts and passed after the existing build prerequisite was filled in. The first workspace build that did not force Bun failed because the configuration uses `Bun.file`, and passed after the Bun runtime was used. The build retains the TypeScript API experimental warning; the React source-file directive warning did not cause the actual entry to lose `'use client'`.

This scope revision only changes the research report and does not change the business implementation, so the tests and builds above were not rerun, and historical results are not described as having been re-executed this time. They support a limited conclusion in the current dependency environment and are not extrapolated to untested environments.

This round did not read other Git branches, did not query other Defjs versions, did not verify release status, and did not modify source, dependencies, configuration, or existing examples. Nothing was committed, pushed, or published.

## 7. Final judgment

The two current packages are not "request hooks that are not finished yet." They are **an optional framework-injection convenience layer, for the architecture that separates define from Client, whose core responsibility is already complete**.

The complete usage chain is sufficient up to here:

1. The application creates and manages the Client itself.
2. If an adapter is adopted, set that Client in the required scope.
3. Consumers get it through `useClient()` or `injectClient()`.
4. Execution style, choice of state library, and resource ownership after that are designed by the application itself; when injection is not used, the Client can also be imported directly.

Evaluation and follow-up work should stay within this scope: verify the existing set/get semantics, keep types and instances transparent, and keep existing documentation accurate. Do not rewrite design freedom the user retains as a feature the project has not yet filled in.

## Sources

### Local evidence on the current branch

- [React implementation](../../packages/react/src/core.ts)
- [Vue implementation](../../packages/vue/src/core.ts)
- [React README](../../packages/react/README.md)
- [Vue README](../../packages/vue/README.md)
- [React provider tests](../../packages/react/src/core.browser.spec.ts)
- [React HTTP integration tests](../../packages/react/src/e2e.browser.spec.ts)
- [Vue browser tests](../../packages/vue/src/core.browser.spec.ts)
- [Vue injection-context tests](../../packages/vue/test/core.spec.ts)

### Market-solution documentation used only for responsibility comparison

- [TanStack Query: Query Functions](https://tanstack.com/query/latest/docs/framework/react/guides/query-functions)
- [TanStack Query: Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [SWR: Mutation & Revalidation](https://swr.vercel.app/docs/mutation)
- [RTK Query: Queries](https://redux-toolkit.js.org/rtk-query/usage/queries)
- [Pinia Colada: Query Keys](https://pinia-colada.esm.dev/guide/query-keys.html)
- [alova: Watching Request](https://alova.js.org/tutorial/client/strategy/use-watcher/)
