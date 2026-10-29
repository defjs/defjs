# React/Vue Client Provide-and-Read Implementation Plan

> **For agentic workers:** When implementing, use `superpowers:subagent-driven-development` or `superpowers:executing-plans` according to the working method the user chose, and execute task by task. Track tasks with `- [ ]`. This file does not authorize automatically creating parallel workflows, committing, pushing, or publishing, and it does not automatically pull optional implementation packages into the default scope.

**Goal:** While keeping define separate from Client and letting the application own the Client, improve the React/Vue adapter integration guidance and contract guarantees, and provide independently executable minimal designs for the two candidate read conveniences.

**Architecture:** `@defjs/react` / `@defjs/vue` still only provide and read an existing Client. The default implementation package only adjusts guidance and regression tests and does not change the runtime; the optional packages respectively add a React explicit Client override and Vue custom InjectionKey reads, do not require the two APIs to be symmetric, and do not introduce a new container or request layer.

**Tech Stack:** TypeScript, React, Vue, Vitest, React Testing Library, Playwright Chromium/Firefox, and the project's existing Bun toolchain. Reuse the existing configuration and dependencies; do not add a new test framework.

**Spec:** [Expert-team optimization recommendations](../../research/2026-10-26-react-vue-expert-recommendations.md). The research baseline is this project's current `feat/up`, `da1a33fa`. Read both this plan and that report before implementing.

## Global Constraints

- Use only the current branch and working tree as the source of truth; do not investigate other Defjs branches, historical versions, or npm publish status, and do not switch back to the research commit or overwrite the user's new changes.
- Adapters only make it convenient to provide and read a Client; directly importing a fixed Client, passing it as an explicit parameter, and the application's own organization are all valid.
- Do not create, clone, cache, or automatically dispose of a Client, and do not automatically execute, cancel, or close work started through it.
- Do not add Query state, cache, retry, mutation, hydration, Devtools, or an official Query bridge.
- Keep the current peer declarations: React `>=18.0.0`, Vue `>=3.0.0`; project development tooling requires Bun `>=1.4.4`. Do not raise those floors or replace dependencies for a convenience feature.
- `app.runWithContext()` examples are marked Vue 3.3+; it is a synchronous app-level context, not a saver of arbitrary async or component-subtree context.
- Keep the React `'use client'` build entry and the current public export names on both sides. Optional packages only extend parameters of existing getters.
- When a required Client is missing, keep failing strictly; do not silently create, import, or fall back to another Client.
- Do not change Vue's native semantics that "the current component provides to descendants while itself still reading the ancestor."
- Browser test processes run sequentially; do not start Vitest browser processes for multiple packages in parallel. Cases do not send business requests, which does not mean the existing test configuration will not start local test facilities.
- Task code remains the implementation baseline; actual completion and runtime evidence follow the execution record in section 11. Do not claim an environment or example that was not run as verified.
- By default do not change package versions, dependencies, lockfiles, build configuration, or CI; do not automatically commit, push, create a PR, or publish.

---

## 1. Implementation Packages and Execution Rules

| Implementation package     | Scope                                                                                             | Default status                                                          | Public API after delivery                |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| A: baseline improvement    | Short integration guidance, React identity-replacement regression, selected Vue scope regressions | Recommended default implementation scope                                | Unchanged                                |
| B: React explicit override | `useClient(overrideClient?: Client)`, type/behavior verification, and doc sync                    | Optional; enable when the same Hook clearly needs a dual-source entry   | Extend only the `useClient` parameter    |
| C: Vue custom key          | `injectClient(key?: InjectionKey<Client>)`, type/behavior verification, and doc sync              | Optional; enable when a single application helper is still insufficient | Extend only the `injectClient` parameter |

This plan was first delivered as an implementation document, and the user then explicitly asked to "please implement all of it." In this round A/B/C are all enabled and complete; the original default-scope rules remain as design notes and do not limit the full scope already authorized this time. Actual execution and verification records are in section 11.

The user explicitly choosing B/C counts as those candidates already being approved; the scenarios below are for understanding and acceptance, and no longer require extra interviews, usage proof, or repeated approval. The adoption conditions for B and C are product-scope conditions, not a general approval process:

- **B**: Real call sites simultaneously need the same Hook entry, an explicit Client when there is no Provider, and a Provider read when none is passed; a required-parameter core Hook plus a Context wrapper really does leave unnecessary maintenance burden.
- **C**: First concentrate on a single application-level helper such as `useBillingClient()`; add a library-level key parameter only when repeated cross-module strict-read cost still remains. A large number of consumers is not itself a reason.

A can be delivered on its own once complete. B and C do not depend on each other and do not have to be implemented together; each task lists its own complete dependencies and does not assume A has already run. Specifying only B or C does not automatically also implement A. When shared document data is involved, edit serially so two executors do not write the same file at once.

## 2. Current Facts and File Map

### 2.1 Baseline Capabilities Before Implementation

- React `ClientProvider` directly provides the Client passed in; `useClient()` reads the nearest Context and throws when there is no value.
- The Vue plugin calls `app.provide(HTTP_CLIENT, client)`; `injectClient()` calls native `inject` and strictly checks for a missing value.
- Existing tests already cover exact identity, the nearest provider, and the missing-value error; do not rebuild those basic suites again.
- The previous research round ran 10 logical scenarios on the current implementation, 20 passes across two browsers. Temporary specs have been moved out of the package directories; they are not formal regression tests, and they are not pass evidence for candidates B/C.
- TS/TSX under `doc/examples` already has type checking; Vue SFCs are outside that check. This plan does not add an SFC compile test facility for that.

### 2.2 Runtime and Test Files

| File                                                                 | Responsibility                                                                                            | Implementation package    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `packages/react/src/core.browser.spec.ts`                            | Browser tests for the current Provider/getter; takes the identity-replacement and optional override tests | A, B                      |
| `packages/vue/test/core.spec.ts`                                     | Injection context, app-level reads, and plugin tests                                                      | A, C                      |
| `packages/vue/src/core.browser.spec.ts`                              | Component-tree injection; reuse the existing `mountRuntime` and cleanup logic                             | A, C                      |
| `packages/react/src/core.ts`                                         | React Context and getter; B only modifies the getter                                                      | B only                    |
| `packages/vue/src/core.ts`                                           | Vue key, plugin, and getter; C only modifies the getter                                                   | C only                    |
| `packages/react/src/core.type.test.ts`                               | Add a type-contract check, following the project's `.type.test.ts` convention                             | Created only for B        |
| `packages/vue/src/core.type.test.ts`                                 | Add a type-contract check                                                                                 | Created only for C        |
| `packages/react/src/public_api.ts`, `packages/vue/src/public_api.ts` | Confirm exports stay as they are                                                                          | Read-only; no new exports |

### 2.3 Documentation File Groups

The current locale directories are fixed as:

```text
en-US, zh-Hans, zh-Hant-TW, zh-Hant-HK, ja-JP, ko-KR, de-DE, fr-FR, es-ES, ru-RU, ar
```

The braces below denote that finite file set, not a placeholder still to be decided. Before implementing, check against `doc/app/lib/i18n.ts`; if the current working tree has already changed, use the actual current locale set and do not overwrite new content.

| File group               | Exact path set                                                                                                                                                                                                                  | When to modify                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| R-Guide                  | `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/docs/integrations/react.mdx`                                                                                                          | A; when B is enabled, append parameter semantics                                                    |
| V-Guide                  | `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/docs/integrations/vue.mdx`                                                                                                            | A; when C is enabled, append key semantics                                                          |
| R-API                    | `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/api/react.mdx` and `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/api/react/useclient.mdx` | B only                                                                                              |
| V-API                    | `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/api/vue.mdx` and `doc/content/{en-US,zh-Hans,zh-Hant-TW,zh-Hant-HK,ja-JP,ko-KR,de-DE,fr-FR,es-ES,ru-RU,ar}/api/vue/injectclient.mdx`  | C only                                                                                              |
| In-package notes         | `packages/react/README.md`, `packages/vue/README.md`                                                                                                                                                                            | A; sync when the corresponding B/C is enabled                                                       |
| Parameter metadata       | `doc/app/data/api-parameters.ts`                                                                                                                                                                                                | The corresponding B/C                                                                               |
| Parameter render tests   | `doc/test/api-reference.test.tsx`                                                                                                                                                                                               | The corresponding B/C                                                                               |
| Current source changelog | `docs/releases/unreleased.md`                                                                                                                                                                                                   | Only B/C add an unreleased note for the corresponding package; do not adjust other existing entries |

Keep existing titles, anchors, slugs, example includes, and language style. Sync only the changed semantics; do not overwrite every language page with Chinese directly. `doc/app/data/api-entries.json` records only name, kind, slug, and associations, and does not contain function parameters; this plan does not need to change it.

## 3. Task A1: Clarify How to Obtain a Client, Without Adding a Sample Project

**Files:** Modify both READMEs, R-Guide, and V-Guide; read-only reuse of the existing `doc/examples/react/read-with-use-client.tsx`, `doc/examples/react/own-query-work.tsx`, and `doc/examples/vue/inject-and-override.vue`.

**Interfaces:** Use the existing `ClientProvider`, `useClient(): Client`, `createClientPlugin(client: Client): Plugin`, `injectClient(): Client`, and `HTTP_CLIENT`. Produce no new API and no new helper that later tasks must depend on.

- [x] **Step 1: Add a short integration-choice note.**

Chinese semantic baseline:

> These adapters are only optional conveniences for providing and reading an existing Client. When a fixed Client already exists, it can be imported directly from an application module; reusable logic can accept an explicit Client parameter; use framework injection only when a component tree needs a default or a subtree override. The application may also use its own organization. SDK definitions do not require execution through the adapters.
>
> Whether an instance is shared depends on the state it captures. An instance that contains a request-specific user, tenant, or credentials should be isolated at the corresponding request boundary; this is not a ban on import syntax, and it does not require every browser application to create a request-scoped Client.

English semantic baseline for the README:

> These adapters are optional helpers for providing and reading an existing Client. Applications may import a fixed application-owned client, pass a Client explicitly, use framework injection for tree-level defaults and overrides, or choose their own organization. SDK definitions do not require these adapters. Share an instance only when its captured configuration and state are safe to share; request-specific identity or credentials belong to the appropriate request boundary.

Sync the corresponding semantics near the introductions of R-Guide/V-Guide, reuse the existing SSR notes, and do not open a second duplicate tutorial.

- [x] **Step 2: Add only framework-specific composition reminders.**

React adds:

> A React Hook must be called at the top level of a component or custom Hook; `explicitClient ?? useClient()` is not a valid optional-source implementation. When both sources are needed, the core Hook can accept a required Client, and a Context wrapper entry can call `useClient()` at the top level. An application that always uses one source does not need the extra wrapper.

Vue adds:

> An application function that only wraps Client retrieval may use `explicitClient ?? injectClient()`; the explicit branch does not need an injection context, and the default branch still does. If the composable also uses Vue APIs such as lifecycle hooks, their context requirements do not disappear because of this. Async work should obtain the Client in a valid context first, then reuse that object; Vue 3.3+ `app.runWithContext` only provides a synchronous app-level context, does not carry component-subtree overrides, and does not survive an ordinary await. Keep the existing note about the compile-time exception for top-level await in `<script setup>`.

- [x] **Step 3: Check that each language adds only the necessary notes.**

Do not add a Query recipe, Storybook helper, MockProvider, SFC harness, or shared Client management module. Event callbacks, the nearest provider, resource ownership, and SSR content already shown by existing examples stay in their original paragraphs or links; do not copy them again.

- [x] **Step 4: Review the documentation diff.**

Acceptance: all three approaches are treated as valid choices; nothing implies that a Provider/plugin is required; candidates B/C are not written as the current API; existing page anchors and request-lifecycle examples are unchanged. This task adjusts guidance and does not mechanically add tests that only map wording.

## 4. Task A2: Protect React's Already-Declared Client Replacement Contract

**Files:** `packages/react/src/core.browser.spec.ts`.

**Interfaces:** Consume the current `ClientProviderProps.client: Client` and `useClient(): Client`, without changing the runtime signature; produce one regression test that directly protects the already-declared behavior.

- [x] **Step 1: Add `fireEvent` and `useState` to the existing imports.**

```ts
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
```

Keep the existing `afterEach(cleanup)` and the other imports.

- [x] **Step 2: Add a case inside the existing `ClientProvider` describe.**

```ts
it("updates the client without resetting consumer state", () => {
  const first = createClient();
  const second = createClient();
  let received: Client | undefined;

  function Consumer() {
    const [count, setCount] = useState(0);
    received = useClient();
    return createElement(
      "button",
      { onClick: () => setCount((value) => value + 1) },
      String(count),
    );
  }

  const view = render(
    createElement(ClientProvider, { client: first }, createElement(Consumer)),
  );
  expect(received).toBe(first);
  fireEvent.click(view.getByRole("button"));
  expect(view.getByRole("button").textContent).toBe("1");

  view.rerender(
    createElement(ClientProvider, { client: second }, createElement(Consumer)),
  );
  expect(received).toBe(second);
  expect(view.getByRole("button").textContent).toBe("1");
});
```

The component function, position, key, and ancestor structure stay the same; do not unmount and recreate, do not assert a fixed render count, and do not send business requests.

- [x] **Step 3: Run the focused test.**

Run from the repository root:

```bash
bun packages/react/node_modules/vitest/vitest.mjs run --config packages/react/vitest.config.browser.ts src/core.browser.spec.ts --coverage.enabled=false
```

Expected: both Chromium and Firefox pass. This adds coverage for behavior that is already correct, and it is expected to pass without a runtime change; do not break the source first just to manufacture a red test. If it fails, first confirm the test kept the same component identity, then investigate from the real failure.

## 5. Task A3: Selected Vue Scope-Boundary Regressions

**Files:** `packages/vue/test/core.spec.ts`, `packages/vue/src/core.browser.spec.ts`.

**Interfaces:** Use the current parameterless `injectClient()`, the plugin, the public `HTTP_CLIENT`, and the existing browser-test `mountRuntime(component, configure?)`. Do not create a package-level helper, and do not change Vue's native semantics.

- [x] **Step 1: Add `vi` to the Vitest import in `test/core.spec.ts`, and add two cases inside the existing `injectClient` describe.**

```ts
it("isolates and restores nested application contexts", () => {
  const first = createClient();
  const second = createClient();
  const appA = createApp({});
  const appB = createApp({});
  appA.use(createClientPlugin(first));
  appB.use(createClientPlugin(second));

  appA.runWithContext(() => {
    expect(injectClient()).toBe(first);
    appB.runWithContext(() => expect(injectClient()).toBe(second));
    expect(injectClient()).toBe(first);
  });
  expect(appB.runWithContext(injectClient)).toBe(second);
});

it("keeps a captured client but does not preserve context across await", async () => {
  const client = createClient();
  const app = createApp({});
  app.use(createClientPlugin(client));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  try {
    const captured = await app.runWithContext(async () => {
      const current = injectClient();
      await Promise.resolve();
      expect(() => injectClient()).toThrow(/injection context/);
      return current;
    });

    expect(captured).toBe(client);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/inject\(\).*only be used/);
  } finally {
    warn.mockRestore();
  }
});
```

Handle the Vue warning only in this one known negative case, and assert the count and the message; do not disable warnings globally. The test waits for the whole Promise to finish; do not replace the async assertion with a synchronous try/catch.

- [x] **Step 2: Add a native ancestor-semantics case inside the existing `vue browser runtime` describe in `src/core.browser.spec.ts`.**

The imports used and `mountRuntime` already exist; do not copy in a new mount/cleanup framework.

```ts
test("provides to descendants while reading the ancestor in the provider", () => {
  const outer = createClient();
  const inner = createClient();
  let ownClient: Client | undefined;
  let childClient: Client | undefined;

  const Child = defineComponent({
    setup() {
      childClient = injectClient();
      return () => h("div");
    },
  });
  const Boundary = defineComponent({
    setup() {
      provide(HTTP_CLIENT, inner);
      ownClient = injectClient();
      return () => h(Child);
    },
  });

  mountRuntime(Boundary, (app) => {
    app.use(createClientPlugin(outer));
  });

  expect(ownClient).toBe(outer);
  expect(childClient).toBe(inner);
});
```

- [x] **Step 3: Run the Vue focused tests sequentially.**

Make sure the previous React browser command has finished, then run:

```bash
bun packages/vue/node_modules/vitest/vitest.mjs run --config packages/vue/vitest.config.browser.ts test/core.spec.ts src/core.browser.spec.ts --coverage.enabled=false
```

Expected: both browsers pass; there is no new runtime behavior. These cases should already pass on the current implementation.

Do not move every research probe into the formal suite: ordinary JavaScript nullish coalescing does not need a package-level helper invented just to test it; the compile behavior of SFC top-level await also does not get a new test facility for this.

**Completion condition for A:** A1–A3 and the section 8 gate are done, and the public API, runtime implementation, dependencies, and configuration are unchanged. If this round's scope is only A, stop here and do not automatically enter B/C.

## 6. Task B1: Optional React Explicit Client Override

**Enable condition:** The user explicitly includes B in the implementation scope and accepts the dual-source usage scenario in section 1. B is not a fix for an existing correctness problem.

**Files:** Modify `packages/react/src/core.ts`, `packages/react/src/core.browser.spec.ts`, the React README, R-Guide, R-API, `doc/app/data/api-parameters.ts`, `doc/test/api-reference.test.tsx`, and `docs/releases/unreleased.md`; create `packages/react/src/core.type.test.ts`. Do not modify `ClientProvider`, the public export list, or Core.

**Interfaces:** Extend `useClient(): Client` to `useClient(overrideClient?: Client): Client`. Calls with no argument, or with undefined, keep the original semantics.

### Fixed Contract for B

| Input                                        | Return / behavior                                                    |
| -------------------------------------------- | -------------------------------------------------------------------- |
| No Provider, with an explicit Client         | Return the explicit original instance                                |
| Provider A, no explicit value or undefined   | Return A                                                             |
| Provider A, explicit B                       | Return B, but do not modify Context; other default reads are still A |
| Neither is present                           | The original error message and strict behavior stay unchanged        |
| The explicit argument changes across renders | Hook order stays stable, and the selection follows the current input |

- [x] **Step 1: Add tests for the new behavior, and first confirm the old implementation cannot satisfy them.**

In the React spec, complete the corresponding import lines as follows; if A2 already added them, reuse the existing imports and do not add them again:

```ts
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
```

Keep the existing Core imports, this package's imports, and `afterEach(cleanup)`. Add the following inside the existing `useClient` describe:

```ts
it.each([
  ["explicit only", false, true],
  ["context with undefined override", true, false],
  ["explicit before context", true, true],
] as const)("selects the client: %s", (_name, hasProvider, hasOverride) => {
  const provided = createClient();
  const explicit = createClient();
  let received: Client | undefined;

  function Consumer() {
    received = useClient(hasOverride ? explicit : undefined);
    return null;
  }

  const child = createElement(Consumer);
  render(
    hasProvider
      ? createElement(ClientProvider, { client: provided }, child)
      : child,
  );
  expect(received).toBe(hasOverride ? explicit : provided);
});

it("switches overrides without changing hook order or the provided value", () => {
  const providedA = createClient();
  const providedB = createClient();
  const explicitA = createClient();
  const explicitB = createClient();
  let selected: Client | undefined;
  let ambient: Client | undefined;

  function Consumer({ overrideClient }: { overrideClient?: Client }) {
    selected = useClient(overrideClient);
    ambient = useClient();
    const [count, setCount] = useState(0);
    return createElement(
      "button",
      { onClick: () => setCount((value) => value + 1) },
      String(count),
    );
  }

  const tree = (provided: Client, overrideClient?: Client) =>
    createElement(
      ClientProvider,
      { client: provided },
      createElement(Consumer, { overrideClient }),
    );
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const view = render(tree(providedA, explicitA));
    fireEvent.click(view.getByRole("button"));

    const assertSelection = (
      expectedSelected: Client,
      expectedAmbient: Client,
    ) => {
      expect(selected).toBe(expectedSelected);
      expect(ambient).toBe(expectedAmbient);
      expect(view.getByRole("button").textContent).toBe("1");
    };

    assertSelection(explicitA, providedA);
    view.rerender(tree(providedA));
    assertSelection(providedA, providedA);
    view.rerender(tree(providedA, explicitB));
    assertSelection(explicitB, providedA);
    view.rerender(tree(providedB, explicitB));
    assertSelection(explicitB, providedB);
    view.rerender(tree(providedB));
    assertSelection(providedB, providedB);
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});
```

Keep the existing "throws when there is no Provider" case; do not copy a synonymous case. The console spy above is there so a Hook-order warning fails the test, not so errors are hidden.

Run the focused test:

```bash
bun packages/react/node_modules/vitest/vitest.mjs run --config packages/react/vitest.config.browser.ts src/core.browser.spec.ts --coverage.enabled=false
```

The old implementation is expected to fail the explicit-override cases; TypeScript checking of calls with the new parameter should also error under the old signature. If a test unexpectedly passes, first check whether it really imports the current source and whether it asserts original instance identity, and do not skip the red-test evidence.

- [x] **Step 2: Modify only the getter.**

Keep the existing `HttpClientContext` and Provider, and implement it as:

```ts
export function useClient(overrideClient?: Client): Client {
  const providedClient = useContext(HttpClientContext);
  const client = overrideClient ?? providedClient;

  if (!client) {
    throw new Error(
      "No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?",
    );
  }

  return client;
}
```

`useContext` must be called unconditionally; do not `if (overrideClient) return overrideClient` first. The explicit value is only the choice for the current read, not a write into context or a new Provider; it still subscribes to Context and must not be advertised as reducing re-renders. JSDoc should explain this optional parameter, its priority, and the missing-value error together.

- [x] **Step 3: Add the type-contract file and rerun the focused checks.**

Full contents of `packages/react/src/core.type.test.ts`:

```ts
import type { Client } from "@defjs/core";
import type { useClient } from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type ClientAccessContract = [
  Expect<Equal<Parameters<typeof useClient>, [overrideClient?: Client]>>,
  Expect<Equal<ReturnType<typeof useClient>, Client>>,
];
```

It is only read by the existing type check, does not run the Hook, and does not need a new test runner. The existing build configuration already excludes `.type.test.ts`.

```bash
bun check --project tsconfig.json
```

Rerun the focused browser test. Both the old and new behavior are expected to pass, with no Hook-order warning during switching:

```bash
bun packages/react/node_modules/vitest/vitest.mjs run --config packages/react/vitest.config.browser.ts src/core.browser.spec.ts --coverage.enabled=false
```

- [x] **Step 4: Sync the getter docs and the parameter table.**

Replace the signature on both kinds of R-API pages with:

```ts
function useClient(overrideClient?: Client): Client;
```

Update the description: the explicit value wins, then the nearest Context, and it errors only when both are absent; it can still be called only at a legal position in a component or custom Hook. Keep page titles, slugs, and anchors unchanged. Sync the React README and R-Guide, and do not rewrite the explicit parameter so that every call must go through this Hook.

Add to the `apiParameters` object:

```ts
"@defjs/react:useClient": {
  overrideClient: { type: "Client", required: false },
},
```

In the existing `doc/test/api-reference.test.tsx`, add the following using the existing `render` helper:

```ts
test("useClient renders an optional override parameter", () => {
  expect(apiParameters["@defjs/react:useClient"]).toEqual({
    overrideClient: { type: "Client", required: false },
  });
  expect(render("@defjs/react:useClient")).toContain(">overrideClient?</code>");
});
```

Add an `@defjs/react` subsection to the current unreleased file that only describes the locally unreleased optional parameter and compatibility with the old usage. Do not change the package version or other existing records.

**Completion condition for B:** The behavior matrix above, the type contract, the documentation parameter table, and the section 8 gate pass; the Provider, how Context is written, Client ownership, and public export names are unchanged.

## 7. Task C1: Optional Vue Custom InjectionKey Read

**Enable condition:** The user explicitly includes C in scope; it has been confirmed that a single strict application-level getter still has a real integration cost. Do not implement C automatically just because B was implemented.

**Files:** Modify `packages/vue/src/core.ts`, `packages/vue/test/core.spec.ts`, `packages/vue/src/core.browser.spec.ts`, the Vue README, V-Guide, V-API, `doc/app/data/api-parameters.ts`, `doc/test/api-reference.test.tsx`, and `docs/releases/unreleased.md`; create `packages/vue/src/core.type.test.ts`. Do not modify `createClientPlugin`, `HTTP_CLIENT`, the export list, or Core.

**Interfaces:** `injectClient(key?: InjectionKey<Client>): Client`, still using `HTTP_CLIENT` by default. Providing continues to use the existing `app.provide(key, client)` / `provide(key, client)`, with no added plugin parameter, factory, or registry.

### Fixed Contract for C

| Scenario                                                 | Result                                                   |
| -------------------------------------------------------- | -------------------------------------------------------- |
| No argument, undefined, or explicit HTTP_CLIENT          | Current default injection semantics                      |
| A custom key is already provided                         | Return the corresponding original instance               |
| The default Client exists, but the custom key is missing | Throw, and do not fall back to the default instance      |
| Two Symbols with the same description                    | Still two different keys                                 |
| A subtree override of the same key                       | The nearest ancestor wins; other keys are unaffected     |
| No valid injection context                               | Still fails; do not create a temporary or global context |

`InjectionKey<Client>` reuses Vue's native type convention and does not add a branding system; do not promise that it can distinguish two business roles of the same type or prevent every wrong key/payload combination, and do not write type tests that depend on that extra guarantee.

- [x] **Step 1: Add red-test cases for a custom key in the existing core tests.**

`test/core.spec.ts` keeps the existing Core import and completes the related imports as follows; if A3 already added `vi`, reuse it directly, and do not depend on A having to run first:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, type App, type InjectionKey } from "vue";
import { createClientPlugin, HTTP_CLIENT, injectClient } from "../src";
```

Add the following inside the existing `injectClient` describe:

```ts
it("selects an application key without changing the default client", () => {
  const normal = createClient();
  const billing = createClient();
  const key: InjectionKey<Client> = Symbol("billing");
  const app = createApp({});
  app.use(createClientPlugin(normal));
  app.provide(key, billing);

  app.runWithContext(() => {
    expect(injectClient()).toBe(normal);
    expect(injectClient(undefined)).toBe(normal);
    expect(injectClient(HTTP_CLIENT)).toBe(normal);
    expect(injectClient(key)).toBe(billing);
    expect(injectClient()).toBe(normal);
  });
});

it("does not use the default client for a missing same-description key", () => {
  const key: InjectionKey<Client> = Symbol("billing");
  const otherKey: InjectionKey<Client> = Symbol("billing");
  const app = createApp({});
  app.use(createClientPlugin(createClient()));
  app.provide(key, createClient());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  try {
    expect(() => app.runWithContext(() => injectClient(otherKey))).toThrow(
      "No Defjs client available for the requested injection key.",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(String(otherKey));
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/injection.*not found/);
  } finally {
    warn.mockRestore();
  }
});

it("isolates a custom key between applications", () => {
  const key: InjectionKey<Client> = Symbol("service");
  const first = createClient();
  const second = createClient();
  const appA = createApp({});
  const appB = createApp({});
  appA.provide(key, first);
  appB.provide(key, second);

  appA.runWithContext(() => {
    expect(injectClient(key)).toBe(first);
    appB.runWithContext(() => expect(injectClient(key)).toBe(second));
    expect(injectClient(key)).toBe(first);
  });
});

it("does not make custom-key lookup available outside injection context", () => {
  const key: InjectionKey<Client> = Symbol("service");
  const app = createApp({});
  app.provide(key, createClient());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  try {
    expect(() => injectClient(key)).toThrow(
      "No Defjs client available for the requested injection key.",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/inject\(\).*only be used/);
  } finally {
    warn.mockRestore();
  }
});
```

Run the focused test:

```bash
bun packages/vue/node_modules/vitest/vitest.mjs run --config packages/vue/vitest.config.browser.ts test/core.spec.ts src/core.browser.spec.ts --coverage.enabled=false
```

The old implementation ignores the extra argument and cannot satisfy the custom-selection / missing-key assertions; type checking of the old signature also cannot accept calls with the new parameter. First confirm the red result comes from that contract difference, not from test-environment initialization failure.

- [x] **Step 2: Add only a key parameter to the getter.**

```ts
export function injectClient(key: InjectionKey<Client> = HTTP_CLIENT): Client {
  const client = inject(key);
  if (!client) {
    throw new Error(
      key === HTTP_CLIENT
        ? "No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client)."
        : "No Defjs client available for the requested injection key. Call injectClient(key) in a Vue injection context and provide a client with app.provide(key, client) or provide(key, client). Use the same key object when providing and injecting.",
    );
  }
  return client;
}
```

The default key keeps the original error text, protecting existing calls and error assertions. The custom-key error explains the requested key and no longer wrongly suggests fixing it by a plugin that only provides the default key; do not print Client configuration, credentials, or request data. Do not add a `hasInjectionContext` dependency or private Vue context access.

- [x] **Step 3: Protect nearest-ancestor semantics per key.**

Add `InjectionKey` to the Vue type import in `src/core.browser.spec.ts`, and add the following inside the existing `vue browser runtime` describe:

```ts
test("overrides one custom key without changing the default or siblings", () => {
  const normal = createClient();
  const outerBilling = createClient();
  const innerBilling = createClient();
  const key: InjectionKey<Client> = Symbol("billing");
  let boundaryClient: Client | undefined;
  let childBilling: Client | undefined;
  let childDefault: Client | undefined;
  let siblingBilling: Client | undefined;

  const Child = defineComponent({
    setup() {
      childBilling = injectClient(key);
      childDefault = injectClient();
      return () => h("div");
    },
  });
  const Boundary = defineComponent({
    setup() {
      provide(key, innerBilling);
      boundaryClient = injectClient(key);
      return () => h(Child);
    },
  });
  const Sibling = defineComponent({
    setup() {
      siblingBilling = injectClient(key);
      return () => h("div");
    },
  });
  const Root = defineComponent({
    setup() {
      return () => [h(Boundary), h(Sibling)];
    },
  });

  mountRuntime(Root, (app) => {
    app.use(createClientPlugin(normal));
    app.provide(key, outerBilling);
  });

  expect(boundaryClient).toBe(outerBilling);
  expect(childBilling).toBe(innerBilling);
  expect(childDefault).toBe(normal);
  expect(siblingBilling).toBe(outerBilling);
});
```

- [x] **Step 4: Add the type contract and recheck old and new tests.**

Full contents of `packages/vue/src/core.type.test.ts`:

```ts
import type { Client } from "@defjs/core";
import type { InjectionKey } from "vue";
import type { injectClient } from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type ClientAccessContract = [
  Expect<Equal<Parameters<typeof injectClient>, [key?: InjectionKey<Client>]>>,
  Expect<Equal<ReturnType<typeof injectClient>, Client>>,
];
```

```bash
bun check --project tsconfig.json
```

Run the focused tests again. Both the custom and default paths are expected to pass; do not replace the default-behavior regression by running only the new cases:

```bash
bun packages/vue/node_modules/vitest/vitest.mjs run --config packages/vue/vitest.config.browser.ts test/core.spec.ts src/core.browser.spec.ts --coverage.enabled=false
```

- [x] **Step 5: Sync the Vue docs and parameter table, without extending the provide side.**

Change the V-API getter signature to:

```ts
function injectClient(key?: InjectionKey<Client>): Client;
```

The Vue README, V-Guide, and V-API state clearly: omitting the key reads `HTTP_CLIENT`; a custom key uses native app/component provide; the same Symbol must be shared; a missing key does not fall back; synchronous context and ancestor visibility stay unchanged. Keep every `createClientPlugin(client)` signature, and do not add a second parameter for symmetry.

Add to the `apiParameters` object:

```ts
"@defjs/vue:injectClient": {
  key: { type: "InjectionKey<Client>", required: false },
},
```

Add an independent case in `doc/test/api-reference.test.tsx` that does not depend on whether B ran:

```ts
test("injectClient renders an optional injection key", () => {
  expect(apiParameters["@defjs/vue:injectClient"]).toEqual({
    key: { type: "InjectionKey<Client>", required: false },
  });
  expect(render("@defjs/vue:injectClient")).toContain(">key?</code>");
});
```

Add the corresponding `@defjs/vue` note only in the current unreleased file. `api-entries.json`, the `createClientPlugin` API pages, and the default key's name all stay unchanged.

**Completion condition for C:** The custom-key behavior matrix, default-path compatibility, the type/parameter table, and the section 8 gate pass; there is no registry, silent fallback, plugin-parameter extension, or Vue semantics change.

## 8. Task G: Unified Verification and Delivery

**Files:** Do not add implementation files; check the full diff of the implementation packages selected this round, the existing test configuration, and generated artifacts. Run every command from the repository root, except Node CI commands that explicitly specify a working directory.

**Interfaces:** Consume the results of A and of B/C that were actually enabled. Produce an accurate verification record. Do not treat "started", "a test file exists", or some local pass as completion.

- [x] **Step 1: After the focused checks, run the full tests of the affected packages in order.**

When A affects both sides, run them in sequence; when only a single-side candidate is added and the other side is unchanged, run the corresponding package first, and still follow the project's full gate at the end.

```bash
bun run --bun --cwd packages/react test
```

```bash
bun run --bun --cwd packages/vue test
```

Expected: both current browser configurations pass, and the existing coverage thresholds stay. The `--coverage.enabled=false` used in the focused red/green phase must not be written into project configuration or replace the full package-level check.

- [x] **Step 2: Check docs and types.**

When B/C are enabled, verify the parameter table first; A, which only changes guidance, should also pass the existing documentation tests.

```bash
bun test ./doc/test
```

```bash
bun run typecheck
```

Check that the corresponding guides and API pages are semantically consistent across the 11 language tracks; keep titles, anchors, and paths. Do not describe a passing TS/TSX type check as Vue SFCs having been statically checked.

- [x] **Step 3: If B/C are implemented, explicitly use Bun to build declaration artifacts.**

The adapter build tsconfig points at `packages/core/dist/index.d.ts`, so build Core first. Do not bypass that existing prerequisite by changing tsconfig, and do not let a build configuration that depends on `Bun.file` fall through to Node after the execution path changes.

```bash
bun run --bun --cwd packages/core build
```

```bash
bun run --bun --cwd packages/react build
```

```bash
bun run --bun --cwd packages/vue build
```

An unselected single-side candidate does not need to be accepted on the grounds that "it also added an API." Actually check that the generated declarations contain only the selected signatures; the React JS entry still starts with `'use client'`. Record build warnings and the exit status separately, and do not infer artifacts from configuration alone.

- [x] **Step 4: After the selected scope is done, run the project gate once.**

```bash
bun run verify
```

That command includes lint, format, types, workspace tests, the build, and documentation site tests. Intermediate steps do not repeat the full gate on every line change; the final full result cannot be replaced by focused cases.

Current CI also requires the Node 24 Core server / OpenTelemetry tests. Reuse the jobs in `.github/workflows/ci.yml`, and do not pass off a pass on some other local Node environment as a Node 24 result:

Working directory `packages/core`, run in the Node CI environment the project specifies:

```bash
bunx --no-install vitest run --config vitest.config.ts --project core-server --coverage.enabled=false
```

Working directory `packages/opentelemetry-server`, run in the same Node CI environment:

```bash
bunx --no-install vitest run --config vitest.config.ts --coverage.enabled=false
```

Do not add `--bun` here, because the Node interpreter chosen by CI must be kept. When that environment or result is absent, explicitly write that it was not verified; do not install or replace the environment yourself, and do not create a PR or push just to obtain a CI result.

- [x] **Step 5: Check the final diff and deliver.**

```bash
git diff --check
```

```bash
git status --short
```

Confirm that only files from the selected implementation packages are included; when B/C are not selected, their runtime, type files, parameter-table entries, and candidate docs were not added ahead of time. Protect the original research reports and the user's changes. Delivery should list the A/B/C actually chosen, the commands actually run and their results, items not verified, and Git/publish operations that were not performed.

## 9. Acceptance Summary and Exit Conditions

| Acceptance item                                                            | A         | B            | C            |
| -------------------------------------------------------------------------- | --------- | ------------ | ------------ |
| import / parameter / DI are all valid choices; the adapter is optional     | Required  | Kept         | Kept         |
| define stays separate from Client; ownership is unchanged                  | Required  | Required     | Required     |
| Existing default getter semantics and error behavior                       | Unchanged | Kept         | Kept         |
| React A-to-B exact identity and existing state preserved                   | Required  | Regression   | Not involved |
| Vue app isolation, await boundary, and ancestor semantics                  | Required  | Not involved | Regression   |
| Explicit value wins and is not written into React Context                  | Not added | Required     | Not involved |
| Custom key is selected strictly and does not fall back to the default      | Not added | Not involved | Required     |
| New signature types, parameter table, and all related language pages agree | Not added | Required     | Required     |
| No new dependency, no Query layer, no automatic resource management        | Required  | Required     | Required     |
| No commit, push, or publish without authorization                          | Required  | Required     | Required     |

Stop and report when: during execution the current code no longer matches a key premise of this document; a test failure comes from real behavior that still needs explanation; or the work would require raising a framework support floor, adding a dependency, or stepping outside the duty of providing and reading a Client. First finish documentation or read-only checks that do not depend on that problem, and do not disguise personal preference as an extra approval condition.

If unpublished B/C need to be withdrawn, withdraw only the getter parameter this implementation package introduced, plus the corresponding type/behavior tests, docs, and parameter metadata; A's notes and contract tests may stay independently. Do not restore state with a whole-repo reset or by overwriting other people's files. Once it has been published externally, do not delete the public API on your own; handle the compatibility decision separately. This plan does not authorize publishing.

## 10. Completion Criteria for This Write-up

- [x] The implementation scope, the default package, and the two optional packages have clear boundaries.
- [x] Each task has concrete files, actual code or explanatory text, commands to run, and expected results.
- [x] New APIs are not described as already existing, and research probes are not described as formal regressions.
- [x] Other branches, other Defjs versions, and Query-library features were not pulled into the implementation scope.
- [x] Links, file groups, and format checks for the writing stage are done; only the document was created then, and later A/B/C implementation is in section 11.

## 11. Actual Execution and Acceptance Record

Execution date: 2026-10-26. The user explicitly chose to implement everything, and A/B/C are all complete. Changes remain in the existing `feat/up` working tree; no branch was created or switched, and nothing was committed, pushed, or published.

### 11.1 Completed Work

- React: `useClient(overrideClient?)` reads Context unconditionally, and the explicit value wins; the default strict error, instance identity, Context writes, and ownership are unchanged.
- Vue: `injectClient(key?)` defaults to `HTTP_CLIENT` and reads by the native key, with no fallback when a custom key is missing; the plugin, public exports, and native ancestor semantics are unchanged.
- Regressions and types: the already-declared identity replacement, scope boundaries, new-parameter priority/selection, default compatibility, and two type contracts were formally added.
- Docs: 66 pages across 11 language tracks, both READMEs, and the current unreleased notes are synced; signatures on 44 API pages, and existing titles/includes/anchors, were checked and stay consistent.
- Metadata and HTML render assertions for the real API parameter table were updated. Dependencies, the lockfile, peer ranges, and the Core runtime were not modified.

### 11.2 Review and Extra Fixes

1. An independent runtime review found that the new `InjectionKey<Client>` type, when emitted through the shared Markdown table, was misclassified by unknown-component detection. In `doc/app/lib/markdown.ts` type cells are now rendered as inline code, and `doc/test/markdown.test.ts` gained a real `ApiReference` regression. The original metadata and the unknown-component protection were not weakened.
2. The full gate was first blocked by a formatting problem in an existing design document, and further checking then found an untouched Core case failing when a real clock and fake timers were mixed. After asking about both and receiving additional user authorization, only the table layout of `docs/design/2026-10-25-define-dx-minimal-proposal.md` was formatted, and `Date` was added to the fake clock in `packages/core/test/regression/thenable-input.spec.ts`; the Core runtime, timeout values, and assertions were not changed.
3. Compared after normalizing table cells and separator lines, the design document's prose, code, and table content are unchanged. The focused regression after the clock fix was 57/57 passing.
4. An independent review of the full diff was Approved, and the Markdown regression verdict was ADDRESSED; the two extra verification fixes received a separate incremental review of Approved, with no new problem that needed a fix.

### 11.3 Final Verification

| Check                      | Final actual result                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `bun run verify`           | Exit code 0; includes lint, whole-repo format, types, tests, build, and site tests                                        |
| Whole-repo format          | 2877 files passed the check; the repo was not rewritten, only actually modified files and authorized fixes were formatted |
| Types                      | Root project 282 files, docs app 165 files, and TS/TSX examples 179 files passed                                          |
| Core: Bun/browser suite    | 2456 passed, 2 pre-existing skips, 0 failed                                                                               |
| OpenTelemetry: Bun         | 332 passed                                                                                                                |
| React adapter              | Chromium/Firefox 22 passed in total; all four adapter coverage figures are 100%                                           |
| Vue adapter                | Chromium/Firefox 34 passed in total; all four adapter coverage figures are 100%                                           |
| Documentation unit tests   | 69 passed                                                                                                                 |
| Root tooling tests         | 5 passed                                                                                                                  |
| Static site build          | Exit code 0; link checks passed for 2279 generated pages                                                                  |
| Site browser tests         | 25 passed, 0 failed, 2242 assertions; uses the existing Chromium/Firefox test configuration                               |
| Node 24.22.1 Core server   | 103 files, 2300 tests passed                                                                                              |
| Node 24.22.1 OpenTelemetry | 13 files, 332 tests passed                                                                                                |
| Actual artifacts           | Declarations for both getters include the optional parameter; the React JS entry keeps `'use client'`                     |

Node 24 used the runtime already on the machine and only set the interpreter and PATH for the test subprocess; the system default Node was not installed or replaced. Running the Node tests directly from the repository root at first failed because of config-relative paths, and no tests were collected; they passed after switching to the package working directories that match CI.

Red-test evidence is kept: under the old implementation the new getter behavior produced 6 React failures and 10 Vue failures respectively; types showed 15 errors related to the old signatures; two new parameter-table cases failed. After implementation the corresponding checks passed. The Markdown integration fix also first reproduced 15 pass / 1 fail, then reached 16 pass / 0 fail.

The build still has the existing TypeScript 7 API experimental hints; the React bundler's source-file directive hint did not cause the real entry to lose `'use client'`. The site error-handling test deliberately emits an `Original search failure` log, and both its assertion and the whole site test suite passed, so it must not be recorded as a real site failure.

Verification covers only the current dependencies and the local environment; it does not claim that the full framework version matrix or real production applications have been verified. Raw logs and execution records were moved, during pre-commit cleanup, to a local session archive outside the project and can be restored from the cleanup list; they are not part of Git or publish content.
