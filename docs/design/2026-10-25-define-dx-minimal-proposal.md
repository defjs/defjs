# defineXXX experience optimization: rely on natural type inference, without adding usage steps

- Status: Shared English property descriptions have landed and verification is complete; extra field checks and custom type diagnostics have been explicitly ruled out.
- Language: Source JSDoc, outward-facing editor descriptions, and this design explanation use English.
- Date: 2026-10-25.
- Baseline revision: `8af234e19bf09ed6769b9926b242b9a4bd4aa7b0`.

## 1. Establish one rule first: type work is borne by the library, not handed to the user

An SDK author declares an interface in the normal way, and the editor should be able to infer parameters, complete fields, and point out mistakes as far as possible.

```ts
import { defineRequest, struct } from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: ({ id }) => ({
    path: { id },
    query: { keyword: "ada" },
  }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});
```

**Before and after the improvement, the user keeps this way of writing.** They should not add another layer of type-checking syntax in order to obtain correct inference or better errors.

"Natural inference" here means: related types are obtained automatically from the struct, method, path, and builder already written. Declaring the service's data contract is still necessary; the library is not required to guess the interface out of nothing.

### Approaches not adopted

- Do not require or recommend that the user hand-write generic parameters for a normal `defineXXX` call.
- Do not have the user add an extra return-type annotation on the builder to make up for a gap in the library's checks.
- Do not improve the experience of a normal call through a type assertion, an extra check expression, or a wrapper function.
- Do not keep promoting these approaches in the documentation as "optional advanced techniques".
- Do not require filling in again a method, path, or data shape that has already been declared.

These restrictions target Defjs's normal definition experience. They do not forbid an application from using TypeScript types in its own business code.

**The earlier suggestion to "have the user actively add checks" has been withdrawn and is not kept as an alternative.**

### What does the current proposal still contain?

| Item                                           | Intended result                                                                                            | Current status                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Property descriptions                          | While writing code, hovering shows the field rules                                                         | Landed; the thirteen hover descriptions in the published declarations have been verified |
| Extra field checks and custom type diagnostics | Keep the existing type and runtime boundaries; do not add a mechanism for an individual typo or error form | The author confirmed this will not be done, and it is not listed as an item to fix       |

**This round's deliverable is property descriptions, not newly added type validation. Both specialized diagnostic optimizations have been withdrawn and are not kept as later development tasks.**

## 2. An existing small improvement: see the usage directly on hover

### 2.1 What is the experience now?

For example, an SDK author wrote a GET request but returned a body:

```ts
// An intentionally wrong example.
const search = defineRequest({
  method: "GET",
  path: "/users",
  builder: () => ({
    body: { keyword: "ada" },
  }),
});
```

The editor reports a type error, but the message may only say that this value cannot be assigned to undefined. The user still has to guess: is the body's data type wrong, or is a body not allowed on GET?

The following is a display sketch, not a newly measured log.

**Before:**

```text
Hover the mouse over body:
  body?: undefined

After filling in body:
  Type '...' is not assignable to type 'undefined'.
```

**After adding the description:**

```text
Hover the mouse over body:
  body?: undefined

  Request body. Not allowed for GET or HEAD.
  Other methods send a native body or encoded JSON, depending on the value.

After filling in body:
  The original TypeScript type error still exists.
```

What was added is a property description, not a replacement for the compiler error. The user's definition code does not need to change, and no new type or utility needs to be imported.

### 2.2 What needs to change in the source?

Change the shared file: [builder_types.ts](../../packages/core/src/internal/builder_types.ts). Only one property is excerpted below; the remaining types stay as they were.

**Before:**

```ts
body?: Uppercase<M> extends "GET" | "HEAD" ? never : BodyValue;
```

**After adding the description:**

```ts
/**
 * Request body. Not allowed for GET or HEAD.
 * Other methods send a native body or encoded JSON, depending on the value.
 */
body?: Uppercase<M> extends "GET" | "HEAD" ? never : BodyValue;
```

This kind of `/** ... */` comment is called JSDoc, and the editor can display it in the tooltip. The type condition is not changed here, and which values may be passed in is not changed either.

### 2.3 Which properties need descriptions?

| Property            | Sentence the user should understand directly                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder`           | What is received is already-parsed business parameters; synchronously return the request's placement result, and do not send the request here                    |
| `path`              | When assembling the object yourself, the key corresponds to a placeholder in the path; when handing over a typed object, it is still encoded by its struct alias |
| `query`             | `URLSearchParams` or an object may be handed over; the object is encoded first, and complex query formats are decided by the Client's serializer                 |
| HTTP/SSE `body`     | GET and HEAD cannot be filled in; other methods handle JSON, forms, bytes, and so on by the existing rules                                                       |
| HTTP/SSE `headers`  | A native header representation or flat fields may be used; cross-request auth and tracing policy belong on the Client                                            |
| WebSocket `body`    | The handshake cannot be given a body; after the connection succeeds, send messages with `session.send`                                                           |
| WebSocket `headers` | The builder cannot set handshake headers                                                                                                                         |

HTTP and SSE already share the request shape. Keep reusing it, and do not separately invent three copies of the rules.

### 2.4 Do not weaken checks just to make the hints look better

WebSocket currently keeps two properties that must not be filled in:

```ts
body?: never;
headers?: never;
```

They may appear in completion, but deleting them might let some return values that should originally have been rejected pass. Keep the restriction for now and add the explanation; do not promise to hide them from the completion list.

Also do not use `@deprecated` to pretend they are deprecated features, and do not use `any` to cover up the problem.

## 3. Explicitly not doing: extra field checks and custom type errors

Confirmed by the author, the following two items do not need special handling and are no longer listed as items to fix:

| Observed situation                                                                            | Decision                                                                                       | Behavior kept                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A `qeury` typo in a particular builder return value is not caught by TypeScript               | Do not add precise object checks, an extra-field scan, or a new type-validation layer for this | Rely on the existing type checks; at runtime only known fields are read, and unknown fields are not guessed into legal fields |
| When a path key is written wrong, TypeScript's diagnostic may mention the internal `[STRUCT]` | Do not adjust generics or the path type rules in order to rewrite this kind of diagnostic      | Existing type errors continue to be reported; legal alias and anonymous-object writing styles stay unchanged                  |

The earlier reproductions were used to explain current behavior. They do not mean those cases must become product-improvement goals, nor that TypeScript will let every similar way of writing pass. This decision is not to handle them specially; it is not a claim that these behaviors have already been fixed.

**Natural type inference is a usage principle. It does not equal a requirement that the library add another layer of mechanism for every kind of typo or compiler-error form.** The user is not required to intervene in types manually, and unnecessary type complexity is not added inside the library because of that.

## 4. Which boundaries stay completely unchanged?

### Both encoding styles are kept

Suppose `input.user.displayName` declared `alias("display_name")`:

```ts
builder: (input) => ({ body: input.user });
// {"display_name":"Ada"}
```

```ts
builder: ({ user }) => ({
  body: { displayName: user.displayName },
});
// {"displayName":"Ada"}
```

Both ways of writing are correct. The field names of the second way will not be rewritten on our own just to improve the type experience.

### No new usage patterns are added

- `bind` is not provided; the definition and the Client stay separate, and the user assembles the service.
- `preview` is not provided; tests use the existing custom Fetch.
- `queryKey` is not required.
- No class-style SDK, generator execution framework, implicit context, or new test DSL is introduced.
- `input` defines business parameters, and the builder explicitly decides placement; where a parameter goes is not guessed automatically.
- Continue designing in the direction of ESM pure functions.

## 5. The modification scope that can be stated now

| Content                                          | How it can be done                                                                                                              | Is there an implementable plan now?                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Property descriptions                            | Add JSDoc in the shared [builder_types.ts](../../packages/core/src/internal/builder_types.ts), without changing type conditions | Landed; only comments and necessary formatting were added                                                        |
| Extra-field and diagnostic special optimizations | Do not add extra field checks, and do not customize path errors                                                                 | Explicitly not doing                                                                                             |
| User documentation and examples                  | Keep the ordinary definition style, and do not add a tutorial on manual type intervention                                       | That tutorial path has been deleted from this proposal; this round does not change the actual documentation site |

This round's source only supplements the shared builder property descriptions. The signatures, runtime implementations, and encoding rules of the three `defineXXX` stay unchanged, and no new automatic-diagnostic type validation was added.

## 6. How to accept?

### Property descriptions

```text
Open a project that actually uses the SDK
→ Write an ordinary defineRequest / defineEventStream / defineWebSocket
→ Hover the mouse over builder, path, body, and headers
→ Accurate, short descriptions are visible
→ Not a single line of the original valid code is changed
```

This round built the actual `dist/index.d.ts`, and verified the thirteen hover descriptions through the TypeScript language service in an isolated consumer project; module resolution confirmed that what is read is the build artifact, not the source. **It was not manually checked in a real IDE window, and it was not published to npm.**

### Keep the existing natural inference and checks

- Normal examples do not add explicit generics, a builder return-type annotation, a type assertion, or an extra check step.
- Existing error examples continue to use the ordinary writing style, and do not rely on user-side annotations to cover up a regression in type checking.
- Existing type inference for input, output, error, events, and messages does not regress.
- Legal alias, anonymous object, spread, optional input, composite structure, and native body writing styles still pass.
- Examples that should originally error, such as a GET/HEAD body and WebSocket headers/body, are still rejected.
- No check is added for the sake of a particular error wording or an extra field, and existing tests are not weakened.

Reuse the existing tests:

- [HTTP builder type tests](../../packages/core/src/http/builder.type.test.ts)
- [builder type regression](../../packages/core/test/regression/builder-types.type.test.ts)
- [explicit builder regression](../../packages/core/test/regression/explicit-builder.type.test.ts)
- [documentation example check configuration](../../doc/examples/tsconfig.json)

## 7. Verification results after this round's implementation

The checks below were run after property descriptions were added to the source, on 2026-10-25.

| Check                                                      | Actual result                     | Coverage                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript 7.0.2 checks Core                               | Exit code 0                       | Includes the existing builder types and regression tests                                                                            |
| TypeScript 7.0.2 checks the documentation examples         | Exit code 0                       | The original examples do not need user-side type annotations added                                                                  |
| Format and lint of the changed files                       | Exit code 0                       | Only the source files changed this round, not a whole-repository check                                                              |
| Compare the source type structure after stripping comments | Consistent with HEAD              | Proves that the type declarations only added comments and formatting, and did not change conditions or field types                  |
| Explicitly build Core with Bun                             | Exit code 0                       | Produces the actual JavaScript, type declarations, and package metadata; there is an experimental warning from the TypeScript 7 API |
| An isolated consumer project uses the built package        | The TypeScript 7.0.2 check passes | Verifies natural inference for input, result, error, SSE, and WebSocket, plus three expected errors                                 |
| Consumer hover descriptions                                | 13/13 pass, LanguageService 6.0.3 | Covers HTTP, SSE, and WebSocket; confirms module resolution to `dist/index.d.ts`, with no fallback to the source                    |

The consumer sample does not need explicit generics, a builder return-type annotation, or an extra check expression. The three expected errors are a wrong call-argument type, a GET that returns a body, and a WebSocket that returns headers; these negative cases are still rejected.

The first build used `bun run --cwd packages/core build`. The build hook ran under Node and failed because `Bun is not defined`, with exit code 1. After the build script was explicitly made to use Bun, it passed, and the build configuration was not changed:

```bash
bun run --bun --cwd packages/core build
```

This round did not run the full runtime tests or browser end-to-end tests, and did not manually check in a real IDE window. Nothing was committed, pushed, or published as a package.

The earlier old diagnostic candidates and the intentionally wrong project were not rerun this round; the specialized diagnostic optimization has now been decided against and is no longer an unfinished task. The isolated consumer and the hover verification were completed with a temporary directory and session scripts, and no long-lived test framework was added; this document does not package those temporary scripts as checked-in tests that can be reproduced independently.

Reusable repository check commands:

```bash
./node_modules/.bin/tsc --project packages/core/tsconfig.json --pretty false --noEmit --incremental false
```

```bash
./node_modules/.bin/tsc --project doc/examples/tsconfig.json --pretty false --noEmit --incremental false
```

## 8. Audit questions from a learning perspective

1. Did the user write only the business contract, or were they asked to additionally help the library finish the type checking?
2. Was the improvement to the hover description, to autocomplete, or to the compiler diagnostic? Were the three conflated?
3. Did the comment change preserve the existing valid code and the original type restrictions?
4. Was an individual compiler behavior that had already been decided against packaged again as a requirement that must be developed?
5. Have the experimental results in the source already been verified in the published package and in an actual consumer project?

**Audit standard: keep natural type inference and the current boundaries, do not require the user to learn another set of type writing, and do not add an unnecessary mechanism for an individual diagnostic form.**
