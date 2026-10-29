# React / Vue Expert Team: Recommendations for Optimizing Client Setup and Retrieval

Evaluation date: 2026-10-26. Project baseline: the current `feat/up` branch, `da1a33fa`, using only the local current implementation as the Defjs basis.

Report status: research by the five expert roles, independent counterarguments, and cross-framework tradeoffs are all complete; the main session has merged evidence from actual runs. Candidate APIs have not been implemented.

## 1. Summary of Conclusions

**The team converged on two feature candidates worth keeping: an explicit Client override parameter for React, and a custom InjectionKey for Vue's strict getter. Both only improve Client selection and retrieval; neither introduces request-state management, and neither is a correctness defect in the current implementation.**

**The maintainer's current decision is not to add a runtime API.** Combinatorial friction that exists technically does not mean demand strength has been proven. Finish the deterministic small optimizations first; if the next round validates only one public extension, prefer React's explicit override candidate.

Compared with adding an API immediately, the optimizations with stronger evidence now are: make it explicit that import, parameters, and DI are all first-class choices, give a small number of legal composition examples, and lock in key regression tests for the existing Client replacement and scope contracts.

| Direction                                                | What the user wants to accomplish                                                                                   | Current judgment                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| React: `useClient(overrideClient?)`                      | One reusable Hook supports both a host Provider and an explicit Client; the explicit path need not mount a Provider | Shipped. An explicit Client wins; Context is still read on every render; neither present throws              |
| Vue: `injectClient(key?)`                                | Retrieve Clients of different roles by an application-owned key, and reuse the strict missing check                 | Shipped. The default key is `HTTP_CLIENT`. A missing custom key errors and does not fall back to that client |
| Access choice and short context examples                 | No need to deduce when to import, pass a parameter, inject, or capture an instance early                            | Recommended; do not expand the runtime API                                                                   |
| Key DI contract regressions                              | Changing an adapter must not break promised behavior such as identity replacement and scope isolation               | Recommended to pick a small number of key scenarios, not to import every experiment                          |
| Context factory, global registry, async implicit context | A broader dependency container or automatic management                                                              | Not recommended at present                                                                                   |

Do not list capabilities such as Query recipes, caching, retry, mutation, automatic cancel/close, or hydration as optimization targets for these packages. Directly importing a fixed Client, explicitly passing a Client, or using one's own organization are all fully legitimate.

## 2. Expert Team and Method

The team is divided as follows: a React usage-experience expert, a Vue usage-experience expert, two independent opposing reviewers for the corresponding frameworks, and one cross-framework API maintainer. The main session is additionally responsible for isolated-scenario verification of the current source and for final integration.

These are engineering assessments by AI expert agents, not interviews with real people; "would like to add" means a design opinion under a concrete scenario, not a measured frequency of user demand.

Every candidate must answer:

1. What actual operation does the current user need to complete?
2. Can it be completed with the current API, a framework-native API, or an explicit Client parameter?
3. Does the comparison library provide convenience for the same responsibility, or a different product capability?
4. What does the new API save compared with a piece of application code, and what long-term contract does it add?
5. Which behaviors already have evidence, and which are still demand hypotheses or unrun API proposals?

Other Defjs branches, other Defjs versions, and public release status were not investigated. Internet retrieval was used only for same-layer comparison against the current official documentation and source of related libraries.

Independent review found no setup/retrieval feature that must be added. The specific tradeoffs are:

| Suggestion ID     | Framework expert opinion                                    | Independent review and final tradeoff                                                                            |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| REACT-01          | Wants one Hook entry to unify an explicit value and Context | Technical friction holds; keep only as a conditional candidate for now, do not implement immediately             |
| REACT-02 / VUE-01 | Make legal ways of organizing a Client easier to discover   | Support a short explanation and necessary comparison examples; do not expand into a full tutorial                |
| REACT-03          | Protect the declared Client prop replacement behavior       | Support one focused regression; this is not a bug in the replacement feature                                     |
| VUE-02            | Protect app, async, and ancestor-injection boundaries       | Select adapter-contract assertions from probes that have already run; do not add a new test framework            |
| VUE-03            | Multiple roles reuse the same strict getter                 | First prove that a single in-app helper is insufficient; do not automatically extend the plugin at the same time |
| REACT-04 / VUE-04 | Evaluate a factory, optional reads, and an extra resolver   | Support keeping the status quo; prefer native Context, a typed key, and explicit parameters                      |

## 3. React Expert: What Most Needs Improvement Is the "Dual-Source Hook" Composition

### 3.1 Ordinary current usage is already direct

```tsx
<ClientProvider client={client}>
  <App />
</ClientProvider>
```

```ts
const client = useClient();
```

The current [implementation](../../packages/react/src/core.ts) has a clear responsibility: there is only one private Context, the Provider sets the Client as-is, the hook retrieves the nearest instance, and it throws a strict error when the instance is missing. There is no create, cache, effect, or destroy logic.

The following needs already have adequate solutions and should not be wrapped as new features:

- Fixed instance: import it directly.
- Local explicit dependency: pass it through a parameter or props.
- Default dependency for an entire subtree: use the existing Provider.
- Test or Story: wrap the component with the existing Provider and pass a test Client.
- The same component uses two fixed instances: use two explicit imports/parameters.
- Two independent replaceable dependencies: the application's own combined Context, or two native Contexts.

### 3.2 The real friction: the same Hook accepts both an explicit value and a Provider

Suppose an application author wants a `useUserLoader` that defaults to the Provider in the host app, but can be given an explicit Client in a standalone page, an embedded component, or a test, and does not require mounting another Provider.

The following cannot be used to solve it today:

```ts
const client = explicitClient ?? useClient();
```

This is a conditional call to a React Hook, not a legal composition pattern. Unconditionally calling `useClient()` first and then selecting the explicit value also cannot cover the "no Provider, explicit Client" path, because the getter throws first.

**But the task is not currently impossible.** The legal application-level approach is to split a parameter-core Hook from a Context wrapper entry:

```tsx
function useUserLoaderWithClient(client: Client, id: number) {
  return useCallback(() => client.execute(getUser({ id })), [client, id]);
}

function useUserLoader(id: number) {
  const client = useClient();
  return useUserLoaderWithClient(client, id);
}
```

This only shows how to organize the Client; `getUser` is an SDK definition the application already has. When the two stable entries are already clear, no new adapter API is needed.

### 3.3 Same-layer internet comparison

| Comparison           | Actual contract of the Client retrieval layer                                                                                                                                      | What can be borrowed                                         | What should not be copied                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| TanStack React Query | `useQueryClient(queryClient?)`; the explicit instance wins, otherwise the nearest Context, and it errors if neither exists; internally it calls `useContext` unconditionally first | Legally unify explicit-value and context selection           | QueryClient caching and provider mount/unmount management                                                 |
| Apollo Client        | `useApolloClient(override?)`; read Context first, then select the override or the context client                                                                                   | The same kind of explicit-override convenience               | GraphQL state and lifecycle capabilities                                                                  |
| urql React           | Parameterless `useClient()`; exposes native Context/Provider/Consumer                                                                                                              | Shows that a parameterless getter is also a valid API design | Do not copy the dev-mode sentinel handling for a missing provider, and do not weaken Defjs's strict error |
| Native React         | Nearest Context, identity of the same Context object, reading multiple Contexts                                                                                                    | A ready application-level alternative for multiple Clients   | Do not invent another global service locator                                                              |

Sources: [R1]–[R5]. While reading urql, one official API page was marked deprecated, and its description disagreed with the official source actually read; this report relies on the source and does not adopt that page's description of the default Client.

### 3.4 New API candidate: explicit Client override

**This is the current `useClient`. It is not a proposal.**

```ts
useClient(overrideClient?: Client): Client
```

The contract is:

1. Read Context unconditionally on every render, preserving Hook call order.
2. When an explicit Client is present, return that original instance; it affects only this read, does not modify Context, and does not change the default instance of other consumers or descendants.
3. When there is no explicit value, read the nearest Provider.
4. When neither exists, continue to throw a clear error.
5. Do not create, clone, cache, or close the Client, and do not handle work it has started.

A consumer can express the choice in one stable Hook entry:

```ts
function useApplicationFeature(explicitClient?: Client) {
  const client = useClient(explicitClient);
  // The application's own consumption logic
}
```

**Benefit**: fewer wrapper entries for a dual-source reusable Hook, matching the composition used by the TanStack/Apollo source actually read this round. The Defjs parameter is the current `useClient`. This round did not run those competitors.

**Cost and limits**: adds a public priority contract and tests; even when an explicit value is passed, the implementation still reads and subscribes to Context, so it must not be advertised as reducing renders; it is still a Hook and cannot be called from an event or an ordinary function just because it has an explicit parameter; it does not solve named Client lookup, and it does not clean up work of the old Client.

**Adoption condition**: a real consumer wants the same reusable Hook to support hosts both with and without a Provider. If the only uses are a fixed import, a required parameter, or pure Context, this parameter is not needed at all. Examples in the current repository have not shown this dual-source demand recurring, so it cannot be listed as a defect that must be fixed.

If it is decided to land, at least verify: an explicit value with no Provider, Provider A plus explicit B, Provider A plus undefined, neither present, and Hook order plus exact returned identity when switching between an explicit value and undefined while a Provider is present. An explicit read in the same tree should also coexist with the default read, proving the override parameter does not write to Context.

## 4. Vue Expert: Prefer Clearer Reuse of the Client, Not More Context Magic

### 4.1 Paths already covered today

```ts
// Set during application initialization
app.use(createClientPlugin(client));
```

```ts
// Retrieve inside a component's synchronous setup, or a composable it calls
const client = injectClient();
```

A subtree uses native `provide(HTTP_CLIENT, childClient)`. Multiple apps isolate themselves by each setting its own; that is not a reason to add a named key.

Vue and React differ in composition rules. An application can write directly:

```ts
// The application's own function, not a new @defjs/vue API
function useUserLoader(explicitClient?: Client) {
  const client = explicitClient ?? injectClient();
  return (id: number) => client.execute(getUser({ id }));
}
```

The function here only wraps Client retrieval and returns an ordinary function; when an explicit Client is present it does not touch the injection context, and an ordinary module or a test can call it too. If the actual composable also uses Vue APIs such as lifecycle hooks, it must still satisfy those APIs' own scope conditions; an explicit Client does not lift those requirements along with it. Therefore, there is no need to add an explicit Client override parameter to Vue just to stay symmetric with the React API.

### 4.2 A more useful optimization is to state context boundaries accurately

- `injectClient()` should retrieve the instance in a valid context; that object can then be reused in an event or in async work.
- `app.runWithContext(injectClient)` can read an app-level provided value and requires Vue 3.3+; it does not carry a subtree override from a particular component.
- `app.runWithContext(async () => { await work(); injectClient(); })` does not automatically preserve context across an await.
- Top-level await in compiled `<script setup>` has special framework handling that restores context; the rule for an ordinary async callback must not be generalized into "inject is impossible after any await." This round did not run that SFC compilation scenario.
- After the same component `provide`s and then calls `injectClient()`, it still reads the ancestor/app value; only descendants read the override this component provided. When the current component already holds `childClient`, use it directly.

The existing README already explains synchronous injection and compiler-restored context, so it cannot be said that "documentation is entirely missing." The suggestion is only to add a small number of positive/negative comparisons and access choices, not to rewrite it into a long tutorial.

### 4.3 Same-layer internet comparison

| Comparison                        | Actual contract of the Client retrieval layer                                                                                            | Meaning for Defjs                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TanStack Vue Query                | `useQueryClient(id?)` together with the plugin's `queryClientKey`; related hooks can accept an explicit QueryClient                      | Named selection is a convenience that actually exists, but it is not grounds for introducing the Query lifecycle        |
| Vue Apollo composables            | Default Client, a named Client map, `useApolloClient(clientId)` and `resolveClient`; there is also an out-of-component callback provider | Multi-role selection is worth evaluating; Defjs can already hold a Client directly and may not need a callback provider |
| VueUse `createInjectionState`     | Returns provide/read functions, and can use a custom key and defaultValue                                                                | A typed key and optional reads are worth consulting, but native Vue already covers ordinary scenarios                   |
| VueUse `provideLocal/injectLocal` | Additionally supports a component reading the value it itself provided                                                                   | This is intentionally added semantics, not a defect in current native provide/inject behavior                           |
| Native Vue                        | typed InjectionKey, app/component provide, nearest-ancestor inject, synchronous runWithContext                                           | Already provides most application-layer composition capability                                                          |

Sources: [V1]–[V8]. Do not splice Vue Apollo documentation and source from different entry points into a guarantee for some released version, and do not treat the comparison here as a security or runtime audit of other libraries.

### 4.4 New API candidate: the strict getter accepts an application-owned key

Multiple Client roles in the same app can use the native API directly today:

```ts
// The application's shared module exports the same key; provide the instance at initialization
const billingKey: InjectionKey<Client> = Symbol("billing");
app.provide(billingKey, billingClient);
```

```ts
// In a consuming component's valid injection context, use the same key imported from the shared module
const billing = inject(billingKey);
if (!billing) throw new Error("Billing client not provided");
```

First concentrate the read in one application-level `useBillingClient()` and judge whether the duplication is already gone; a large number of consumers does not mean every site must hand-write the check. The package now provides that getter:

```ts
injectClient(key?: InjectionKey<Client>): Client
```

The default is `HTTP_CLIENT`. A missing custom key errors and does not fall back to the default Client. The missing-key message names the key that was requested and does not reuse the configuration guidance for `HTTP_CLIENT`.

The Vue expert originally also proposed `createClientPlugin(client, key?)`. Independent review pointed out: **repeated strict checks on the retrieval side do not automatically prove that the setup side also needs an extension.** `app.provide(key, client)` is already one line. Evaluate them separately, and do not enlarge both signatures at once for the sake of symmetry.

**Benefit**: unify strict reads and diagnostics for multi-role Clients, continue to reuse Vue's native token, and do not introduce a named registry.

**Cost and limits**: adds contracts for the default key, a custom key, nearest override by key, a missing key, and so on; the provider and the reader must share the same Symbol instance, and two `Symbol("billing")` values are not equal; a typed key does not guarantee that business roles of the same type will not be confused; it does not introduce ref unwrapping, implicit Client replacement, or async context.

**Adoption condition**: after an application-level single helper has already centralized the checks, multiple shared modules still have a confirmed integration cost for strict typed-key reads. An application that has one default Client, several independent apps, a few special dependencies, or an existing local `requireBillingClient()` that already solves the problem has no need to add this API.

## 5. Features Not Recommended Just to Be "More Complete"

| Candidate                                              | Why it is not recommended now                                                                                                                                       | Sufficient existing alternative                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| React `createClientContext()` factory                  | There is not yet a repeated need for independent SDK UI scopes; it would introduce a public maintenance surface for module identity, isolation, and error semantics | Application-native Context, a combined Context, props/import                |
| Vue `provideClient(client)`                            | It only wraps one already-clear native call, and no sufficient extra benefit is visible now                                                                         | `provide(HTTP_CLIENT, client)`                                              |
| Vue `tryInjectClient()`                                | Adds a nullable/silent-missing contract, and easily conflates "provider missing inside a legal context" with "no context"                                           | `inject(HTTP_CLIENT, undefined)` inside a valid setup                       |
| Same-component self-injection special case             | Changes Vue's native semantics and adds surprising behavior                                                                                                         | This component uses the existing `childClient` directly; descendants inject |
| Global `setClient/getClient` or an implicit default    | Interferes with how the user organizes things, and can hide configuration errors and scope problems                                                                 | The application's own fixed import or an explicit parameter                 |
| Async `withClient` / a global active Client            | Would have to take on nesting, exception recovery, concurrency, and cross-request isolation                                                                         | Obtain the object first in a valid context, then pass it into async logic   |
| Auto-create, auto-destroy, auto-remount on replacement | Changes ownership or framework-native state semantics                                                                                                               | The application decides creation, state, key, and work cleanup              |
| Query cache, state, mutation, retry, and so on         | Not part of the Client setup/retrieval responsibility                                                                                                               | Entirely the application's choice of its own approach                       |

"Not recommended to add now" is not a claim that these designs will never be useful. It means current evidence is not enough to cover their public-API cost.

## 6. Usage-Scenario Verification Run by the Main Session

The two framework experts and the opposing reviewers did read-only research and did not treat test source as a passing test. The main session used the current source, the existing dependencies, and the project's original package-level Vitest configuration, and ran the following temporary probes separately.

| Framework | Scenario                                                                                        | Result                                                                       | Worth becoming a long-term regression directly                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| React     | Under the same type, same tree position, and same key, change the Provider's Client from A to B | Exactly reads B; the consuming component's state identity is preserved       | Priority; corresponds to an already-declared contract                                                                  |
| React     | Two independent roots each set a Client                                                         | The instances do not override each other                                     | May be chosen according to later change risk                                                                           |
| React     | Read and unmount under StrictMode                                                               | Always reads the original instance; execute is not called automatically      | May be chosen according to later change risk                                                                           |
| React     | Capture the Client during render, then use it in an event callback                              | What is used is the instance that was provided                               | Already a documented pattern; no need to mechanically add a duplicate test                                             |
| Vue       | Two apps and nested runWithContext                                                              | Each reads its own value; leaving the inner layer restores the outer         | Prefer the scope boundary                                                                                              |
| Vue       | Two actually mounted apps                                                                       | Each obtains its own instance                                                | Avoid stacking duplicates with other isolation cases                                                                   |
| Vue       | An ordinary runWithContext async callback across await                                          | Injecting again fails; the Client captured in advance can still be used      | A valuable concrete boundary counterexample                                                                            |
| Vue       | Self-read after provide in the same component, then read by a descendant                        | Self-read sees the ancestor; the descendant reads the override               | Lock in native semantics so they are not changed by mistake later                                                      |
| Vue       | An application helper prefers the explicit parameter                                            | Does not need an injection context and does not trigger an injection warning | Only application-pattern verification; do not add a helper to the package out of nowhere just to test JS short-circuit |
| Vue       | An application-owned InjectionKey used together with the default Client                         | Can obtain the corresponding instances separately                            | `injectClient(key)` reads that key. A missing custom key does not fall back to `HTTP_CLIENT`                           |

Actual results: React, 4 logical scenarios × Chromium/Firefox = **8 passes**; Vue, 6 logical scenarios × two browsers = **12 passes**. Both test commands finished, and the whole serial command exited with code 0. The framework dependencies resolved at the time were React `19.3.0` and Vue `3.5.43`; Vitest was `5.0.3`.

The probe cases do not send business HTTP requests; the reused existing package-level configuration still starts the browser test facility and a local test server, and the two must not be conflated.

Verification limits:

- Only the currently installed dependencies and the scenarios above were verified; do not extrapolate to the entire framework support range.
- `useClient(overrideClient?)` and `injectClient(key?)` are the current package APIs. This research session did not execute them; the contracts above are what the source does now.
- The full-repo tests, a full build, a real Next/Nuxt application, and the SFC top-level await compilation scenario were not rerun.
- The first two attempts to initialize a test environment in independent temporary directories did not succeed: first Vitest dependencies could not be resolved, then there was a suite registration context problem, and no product tests were collected in either case. After switching to the project's existing package-level configuration, the same set of behavior probes above passed. These initialization failures are not counted as adapter defects, and success was not obtained by weakening behavior assertions.
- The temporary probes were for research and do not mean these scenarios have become the project's long-term regression suite. The two temporary in-package specs were checked by content hash, archived to a local isolated directory, and then removed; the original source and the official tests were not changed. When formally adopting them, keep only adapter-contract assertions, and confine handling of expected warnings to the corresponding scenarios.

## 7. Minimal Order When Adopting Optimizations

### Group one: deterministic optimizations that do not expand the API

- Each side adds a short access-choice note: a fixed import, an explicit parameter, and framework injection are all legal; give applicable situations rather than prescribing a single architecture.
- React explains the legal parameter-core Hook plus Context wrapper, and avoids calling a Hook conditionally.
- Vue gives short examples of "retrieve first, await later," explicit parameters in an ordinary module, and that app-level context does not represent a component subtree's context.
- From this round's probes, pick regression scenarios that truly protect the adapter's public contract, prioritizing identity replacement and scope boundaries; do not copy all of them.

### Group two: add one narrow interface when there is real reuse demand

- React's `useClient(overrideClient?)` is shipped. What it handles is a real limit imposed by React Hook composition rules.
- Vue's `injectClient(key?)` is shipped. The setup side still does not need a key parameter; `app.provide(key, client)` remains the way to register a custom key.
- Do not require the two sides to align mechanically in parameter and function count; a one-line legal composition Vue already has does not need an extra API just because of React's limit.

### Group three: keep the status quo

Do not build a global Client container, do not introduce Query state management, do not take over resource lifecycles, and do not keep adding exports that wrap a small amount of native API.

The final acceptance criterion should be: **setting and retrieving a Client is clearer and composes better, while the user can still freely choose not to use the adapter at all.**

## Sources

### Current branch

- [React core implementation and strict getter](../../packages/react/src/core.ts)
- [React public exports](../../packages/react/src/public_api.ts)
- [React current documentation](../../packages/react/README.md)
- [Vue core implementation and default InjectionKey](../../packages/vue/src/core.ts)
- [Vue public exports](../../packages/vue/src/public_api.ts)
- [Vue current documentation](../../packages/vue/README.md)

### React comparison

- [R1 — TanStack useQueryClient](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useQueryClient)
- [R2 — TanStack QueryClientProvider / useQueryClient source](https://github.com/TanStack/query/blob/main/packages/react-query/src/QueryClientProvider.tsx)
- [R3 — Apollo useApolloClient source](https://github.com/apollographql/apollo-client/blob/main/src/react/hooks/useApolloClient.ts)
- [R4 — urql React Context source](https://github.com/urql-graphql/urql/blob/main/packages/react-urql/src/context.ts)
- [R5 — React useContext](https://react.dev/reference/react/useContext)
- [R6 — React Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
- [R7 — React preserving and resetting component state](https://react.dev/learn/preserving-and-resetting-state)

### Vue comparison

- [V1 — Vue Application API / runWithContext](https://vuejs.org/api/application.html#app-runwithcontext)
- [V2 — Vue dependency injection API](https://vuejs.org/api/composition-api-dependency-injection)
- [V3 — Vue script setup top-level await](https://vuejs.org/api/sfc-script-setup.html#top-level-await)
- [V4 — TanStack Vue useQueryClient](https://tanstack.com/query/latest/docs/framework/vue/reference/functions/useQueryClient)
- [V5 — TanStack VueQueryPlugin](https://tanstack.com/query/latest/docs/framework/vue/reference/variables/VueQueryPlugin)
- [V6 — Vue Apollo composable setup](https://apollo.vuejs.org/guide-composable/setup)
- [V7 — VueUse createInjectionState](https://vueuse.org/shared/createinjectionstate/)
- [V8 — VueUse provideLocal](https://vueuse.org/shared/providelocal/)
- [V9 — Vue Apollo useApolloClient](https://apollo.vuejs.org/api/use-apollo-client)
