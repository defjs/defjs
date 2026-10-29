# zen-kit Full Audit Report

- Baseline: branch `feat/up`, commit `6b0b0c1e`, 2026-10-12
- Result: 77 findings (P0 1, P1 5, P2 46, P3 25), deduplicated and merged from 82 findings confirmed by review
- Companion file: [`module-map.md`](module-map.md) (the role of all 2863 tracked files)

## Executive Summary

### Scope and Method

- **Subject**: zen-kit monorepo, branch `feat/up`, HEAD `6b0b0c1e`.
  - Packages: `@defjs/core` 0.4.0, `@defjs/opentelemetry-server`, `@defjs/react`, `@defjs/vue`.
  - Documentation site: based on Fumadocs and React Router, covering 11 languages.
  - Operations and project documentation: `.github/workflows`, root README, code of conduct, design drafts, and so on.
- **Partitions**: 15 in total.
  - P01 Struct, P02 HTTP client, P03a SSE, P03b WebSocket, P04 core infrastructure, P05 core tests.
  - P06 OpenTelemetry server plugin, P07 React/Vue adapters, P08 documentation-site engineering.
  - P09a guides, P09b API reference, P10a CJK translations, P10b other-language translations.
  - P11 release and operations, P12 project documentation.
- **Double-blind audit**: each partition was audited independently by codex (gpt-6.1-sol, xhigh) and grok (grok-4.7, xhigh), 30 runs in total, with auditors invisible to each other.
- **Adversarial review**: for each partition, one reviewer tried to overturn every conclusion on an independent clone.
  - Behavioral conclusions were reproduced separately on Bun 1.4.3 and Node 26.11.1.
  - Test conclusions were proven with mutation probes that "the test cannot fail".
  - External facts were fetched read-only: npm/jsdelivr, WHATWG SSE specification, GraphQL specification, DNS over HTTPS, Codecov API.
- **Baseline**: the coordinator ran `bun run verify` on HEAD, and everything passed.
  - Coverage includes lint, fmt, typecheck, and build.
  - Tests: core 1915, otel 288, react 12, vue 14, doc 49, doc e2e 23.
  - A fully green baseline coexists with the problems below; that itself shows that some tests and gates have insufficient coverage (see systemic themes 7 and 8).
- **Roll-up phase**: cross-partition deduplication, adjudication of review disagreements, and global severity calibration were done on top of the review results, without re-auditing.

### Statistics

| Stage                                               | Count |  P0 |  P1 |  P2 |  P3 |
| --------------------------------------------------- | ----: | --: | --: | --: | --: |
| Auditor raw entries (codex 76 + grok 71)            |   147 |   1 |  17 | 116 |  13 |
| Kept by review (CONFIRMED 81, PLAUSIBLE 1)          |    82 |   1 |   5 |  50 |  26 |
| After cross-partition dedup and calibration (final) |    77 |   1 |   5 |  46 |  25 |

**Raw to review**:

- Of 147 raw entries, 82 were kept after same-root merges between the two auditors in each partition, and after rejecting items that could not be reproduced and behavior that is by design.
- 2 of them were added by the reviewer: P03a-core-sse-06, and P12-project-docs-04 from a P06 review side note.
- Of the original 17 P1s, 12 were downgraded at review time according to actual consequences.
- P10b (other-language translations) had zero findings from both auditors and the reviewer.

**Review to final**:

- 5 entries were merged into same-root primary entries.
- 1 downgrade: F055, P2 to P3.
- 1 merged group's severity was taken as P2: F042; the merged-in P09a-doc-guides-05 was originally P3.
- Nothing was deleted.

Final entries by severity and category:

| Category         |  P0 |  P1 |  P2 |  P3 | Total |
| ---------------- | --: | --: | --: | --: | ----: |
| correctness      |   0 |   3 |  13 |   2 |    18 |
| contract         |   0 |   1 |  17 |   0 |    18 |
| docs             |   0 |   0 |   7 |  11 |    18 |
| test             |   0 |   0 |   4 |   8 |    12 |
| ops              |   1 |   0 |   3 |   0 |     4 |
| security         |   0 |   1 |   2 |   0 |     3 |
| i18n             |   0 |   0 |   0 |   2 |     2 |
| over-engineering |   0 |   0 |   0 |   2 |     2 |
| Total            |   1 |   5 |  46 |  25 |    77 |

Counted by the partition of the primary entry:

| Area                                   | Partitions and counts                                           | Total |
| -------------------------------------- | --------------------------------------------------------------- | ----: |
| core runtime                           | Struct 6, HTTP/client 11, SSE 10, WebSocket 7, infrastructure 7 |    41 |
| core tests                             | P05                                                             |     5 |
| OpenTelemetry plugin                   | P06                                                             |     5 |
| React/Vue                              | P07                                                             |     1 |
| Documentation-site engineering         | P08                                                             |     6 |
| Documentation content and translations | P09a 3, P09b 3, P10a 2                                          |     8 |
| Release and operations                 | P11                                                             |     5 |
| Project documentation                  | P12                                                             |     6 |

### P0 / P1 Overview

- **F001 (P0, ops) The core release package is missing a third-party license notice**: the SSE parser is adapted from Azure/fetch-event-source, which is copyrighted by Microsoft (MIT), but the core tarball copies only `LICENSE` and `README.md`. `THIRD_PARTY_NOTICES.md` is not published with the package, and the source path inside it is stale. The already published `@defjs/core@0.4.0-beta.1` is missing it as well.
- **F002 (P1, security) Defined-path validation can be bypassed**: it checks `^scheme:` and `//` only on the raw string. A backslash, leading whitespace, or an embedded tab/newline can bypass the check, and HTTP, SSE, and WebSocket requests are sent to another host together with default headers and authentication headers injected by interceptors.
- **F003 (P1, contract) The SSE startup-failure tuple carries another request's data**: the module-level `errorOpenInfoMap` is keyed by the shared sentinels `ERR_ABORTED`/`ERR_TIMEOUT` and is never cleared. The result is:
  - the third slot of a startup-failure tuple may return another request's response status, headers, and URL (possibly across clients), which is cross-request data exposure in a multi-tenant server process;
  - a cancellation may be misreported as `HTTP_STATUS`.
- **F004 (P1, correctness) The default fetch is fixed at import time**: the default HTTP/SSE handle is bound to the then-current `globalThis.fetch` when the module is evaluated. A mock or instrumentation installed after import is bypassed by every default client; if the environment has no fetch at import time, importing the whole package fails.
- **F005 (P1, correctness) FormData upload progress on Node buffers the whole body**: when `onUploadProgress` is set, the body is first read entirely into memory (measured at about 3 times the file size), and that read is not constrained by timeout/abort; if the file stream stalls, `execute` never returns.
- **F006 (P1, correctness) FormData upload progress on Bun drops the boundary**: when `onUploadProgress` is set, the multipart body is sent as `application/octet-stream`, the server cannot parse it, and this contradicts the documented promise of FormData progress on Bun.

### Systemic Themes

Each root cause below corresponds to several findings and should be fixed once, not patched finding by finding.

1. **Module-level side tables and object identity carry cross-request state.**
   - Related entries:
     - F003: `errorOpenInfoMap` is keyed by shared sentinels.
     - F012: the transport-origin `WeakSet` permanently marks shared sentinels, so the classification of `ERR_ABORTED`/`ERR_TIMEOUT` thrown by an interceptor flips with process history.
     - F039: OTel decides cancellation with `error === ERR_ABORTED`, which fails when multiple instances exist.
     - F038: Struct's `activeErrorMap` is module state and fails across package copies.
   - Fix principle: pass per-execution metadata along with the failure value, and stop marking or indexing process-level shared sentinels; identify across instances with a `Symbol.for` brand, not object identity.
2. **Configuration validation happens inside the transport, and deterministic configuration errors are reported as `NET_UNREACHABLE`.**
   - Related entries:
     - F011: a missing or illegal endpoint, or a path containing `?`/`#`; correctly rejected absolute paths do the same (see the incidental observation on F002).
     - F013: an out-of-range jitter is exposed only at the first drop.
     - F015: writing the `Last-Event-ID` header throws outside the try.
     - F023: writing `binaryType` fails.
   - When `withSSEReconnect` is enabled, this class of error is also retried against the budget.
   - Fix principle: parse and validate the URL and options uniformly before entering the transport, and report them as `REQ_*`; stamp a transport origin only on a real transport failure.
3. **SSE and WebSocket each implement their own reconnect/backoff semantics, and neither is written down.**
   - Related entries:
     - F008, F009: `attempts` is a cumulative budget for the whole logical stream or session, and the backoff exponent accumulates across healthy periods; a long-lived connection with the default `attempts: 3` ends permanently on the 4th drop within its lifetime.
     - F013: SSE does not validate parameters; WebSocket does.
     - F032: `maxDelayMs` takes effect before jitter.
     - F041: `0 × Infinity` in `backoff.ts` yields NaN.
     - F048: SSE backoff parameters have no effective test.
   - Decide the budget semantics as a product decision first, then share one normalization and one document between the two transports.
4. **Transport-boundary rules are not uniform.**
   - Outbound encoding: F010, WebSocket text frames do not reuse HTTP's `rejectNonJson`.
   - Upload-progress conversion `prepareUploadProgressRequest`: F005, F006, and F024 are concentrated here.
   - Content-Type metadata: F025.
   - Download-progress accounting: F026.
   - The fix should land on the shared conversion and serialization boundary, not be patched condition by condition.
5. **Error-message and log hygiene.**
   - F007: the default issue message and the JSON parser error contain the original value, while the docs say `String(fault)` can be logged directly.
   - F037: an errorMap that returns `''` cannot be used for redaction.
   - F038: errorMap is bypassed across copies.
   - Together, "logging the way the docs say" writes scalar payloads into the logs.
6. **Documentation drift after the Fumadocs migration and gate removal.**
   - Dead links and stale process statements: F043 (published README links to the old route), F064, F042 (the deleted packed-consumer gate), F044, F065, F066.
   - Docs that do not match the code: F019-F021, F053, F054, F056-F061.
   - Most en-US errors are copied verbatim into 11 languages (for example `docs/sse.mdx:64`, `:99`). Fix the en-US source first, then sync each language.
7. **Tests that do not do what their names say, or that cannot fail.**
   - Related entries: F046, F047, F048, F049, F068, F069, F070, F072, plus the gate-class F050 and F071.
   - Several mutation probes show that after the statement under test is deleted, all 1757 core-server tests still pass.
   - Recommendation: sample-mutate cleanup, timing, and listener-identity code, and assert callback identity and the scheduled delay, not just a count.
8. **The release pipeline has no gate.**
   - The four publish jobs only run `bun ci`, then build, then `npm publish`.
   - Declaration generation always uses `--noCheck`, does not require the chosen SHA to have passed CI, and the `copy` list has never included the third-party notice.
   - Corresponding entries: F001, F016, F017, and the "deleted verification" described by F042.
   - Add a pre-publish check step:
     - build core first;
     - run `tsc --noEmit` against the build config;
     - assert the file list with `npm pack --dry-run` (including `THIRD_PARTY_NOTICES.md`);
     - check that SHA's CI status.
9. **CI runs only on Bun (F018).**
   - The docs claim Node support, but Node-only branches (such as native WebSocket error-before-close) never run in CI.
   - F005 appears only on Node and F006 only on Bun, which means both runtimes need an automated guard.

### Suggested Fix Order

1. **Release compliance and the pre-publish check (before any next release).**
   - F001: add `THIRD_PARTY_NOTICES.md` to core's `copy`, and correct the path inside it.
   - F016, F017: publish jobs build core first, then typecheck and verify the pack file list.
   - These changes are concentrated in `release.yml` and the tsdown config, cost little, and stop the same class of problem from being published again.
2. **Security and cross-request isolation.**
   - F002: compare origins after parsing, and move it to the build phase so it is reported as `REQ_BUILD_FAILED`.
   - F003 and F012: as one change, remove the module-level tables keyed by shared sentinels.
   - F007 and F037.
3. **P1 transport defects.**
   - F004.
   - F005, F006, and F024: the same function, fix them together.
4. **Configuration-error classification (theme 2)**: F011, F013, F015, F023.
5. **Reconnect-semantics decision (theme 3)**: F008, F009, F032, F041, with test F048 filled in alongside.
6. **Remaining runtime P2s**: F010, F014, F022, F025-F031, F033-F040.
7. **Test and CI guards**: F018 adds a Node job; F046, F047, F049, and the other test gaps are best submitted together with the corresponding code fix.
8. **One documentation cleanup pass**: change en-US first, then sync the 10 languages.
   - Covers F019-F021, F034, F042-F045, F050-F061.
   - Translations F055, F067.
   - Documentation site F050-F052.
9. **P3 cleanup**: F062-F077.

### Matters Outside the Repository

- **The documentation-site domain does not resolve**: `defjs.org` was NXDOMAIN at review time (2026-10-12; both Cloudflare and Google DoH returned `Status: 3`).
  - The GitHub repository homepage points at that domain, and `defjs.github.io/defjs/` returns 404; `SITE_URL` is supplied by a variable outside the repository.
  - After the route path in F043 is corrected, the links still cannot take effect until the domain or Pages configuration is restored. The owner has to handle this at the DNS/Pages layer.
- **Packages already published on npm cannot be corrected in place**: npm tarballs are immutable.
  - `@defjs/core@0.4.0-beta.1` was published without the third-party notice, so the fix can ship only with a new version; whether to `npm deprecate` that version is the maintainer's decision.
  - `latest` (0.3.3) and earlier versions were not checked one by one.
- **Adapter version numbers (process note, not filed)**: `@defjs/react` exists on npm only as `0.0.1-beta.0/1`, and was not published by `release.yml`. `release.yml` does not change the version number, `0.0.1` can be published only once, and every later publish needs a manual version bump.
- **Code of Conduct reporting channel (F045)**: a maintainer must choose a real contact channel that meets the privacy promise; it cannot be fixed in code.
- **Codecov (F066)**: project data on Codecov stopped at the 2025-03-14 snapshot; restoring uploads or removing the badge both involve external service configuration.
- **Upstream defect (F051)**: the cache defect is in `fumadocs-core@16.17.1`. Report it upstream, or wrap a retryable loader on the site side.
- **npm provenance (not filed)**: the P11 reviewer listed provenance / trusted publishing as optional hardening, not a defect.

### Limitations

- **Browser-related projects were not run.**
  - Neither the auditors nor the reviewer ran the browser Vitest projects (Chromium/Firefox), doc e2e, or preview/dev, because of fixed ports and parallel conflicts; those ran only in the coordinator baseline.
  - Conclusions that depend on a browser:
    - F014: not verified end to end in a real Worker;
    - F051: the UI presentation part was not verified;
    - F052: Firefox/Safari in the tr-TR locale were not measured; the conclusion is PLAUSIBLE, and it is the only PLAUSIBLE entry;
    - F002: the browser `withCredentials` cookie path was not verified.
- **Environments and scenarios not covered.**
  - Publish jobs were simulated only on local macOS arm64, not executed on a GitHub ubuntu runner.
  - F004 was not verified against the install timing of specific third-party libraries (MSW, OTel, Sentry).
  - The time and memory numbers in F005 indicate magnitude only, not a benchmark.
- **How translations were read.**
  - The 10 non-English languages were machine-read by a model, not proofread by a native speaker.
  - A mechanical consistency script covered every file; close semantic reading was only sampled paragraph by paragraph, so a wording reversal inside the same paragraph can still be missed.
  - Actual Arabic RTL layout was not inspected.
- **Reproduction material is not in the repository**: probes, mutation scripts, and logs live in the `/tmp/zen-audit/verified/*/scratch` and `/tmp/zen-audit/verify/*` clones and may be cleaned up. A fix needs regression tests rewritten inside the repository.
- **Boundary of the legal judgment**: F001 is judged from the MIT license text and the correspondence of code structure, and is not a legal opinion.
- **Severity method**: severity is the auditors' and reviewer's judgment, calibrated in the roll-up phase; between two levels, the lower one is taken.
- **Brief factual correction**: audit brief `_shared.md` section 4 says the cancellation shape "stays `NET_*` no matter where it comes from". That does not hold for cancellation sentinels thrown by SSE/WebSocket interceptors; they are reported as `EXT_INTERCEPTOR_FAILED`, consistent with the public docs. This is a factual correction of the brief itself and is not a finding.

## Findings Index

| ID            | Severity | Category         | Verdict   | Title                                                                                                                               | Primary location                                                                                   |
| ------------- | -------- | ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [F001](#f001) | P0       | ops              | CONFIRMED | The core release package omits the fetch-event-source MIT notice                                                                    | `packages/core/tsdown.config.ts:48`                                                                |
| [F002](#f002) | P1       | security         | CONFIRMED | Defined-path validation can be bypassed by a backslash or whitespace, sending auth headers to another origin                        | `packages/core/src/internal/url.ts:217`                                                            |
| [F003](#f003) | P1       | contract         | CONFIRMED | SSE errorOpenInfoMap is keyed by a shared sentinel and leaks a response snapshot across requests                                    | `packages/core/src/sse/transport/event_stream.ts:703`                                              |
| [F004](#f004) | P1       | correctness      | CONFIRMED | The default fetch is fixed at module evaluation, so a global fetch replaced afterward is bypassed                                   | `packages/core/src/client/config.ts:199`                                                           |
| [F005](#f005) | P1       | correctness      | CONFIRMED | On Node, FormData with progress is buffered whole and ignores timeout and cancellation                                              | `packages/core/src/http/transport/fetch.ts:447`                                                    |
| [F006](#f006) | P1       | correctness      | CONFIRMED | On Bun, a FormData upload with progress drops the boundary                                                                          | `packages/core/src/http/transport/fetch.ts:496-499`                                                |
| [F007](#f007) | P2       | security         | CONFIRMED | String(fault) contains the original response-field value, conflicting with "directly loggable"                                      | `packages/core/src/error/factory.ts:59`                                                            |
| [F008](#f008) | P2       | contract         | CONFIRMED | WebSocket reconnect attempts are a cumulative budget for the whole session, and the docs do not say so                              | `packages/core/src/web_socket/web_socket.ts:401`                                                   |
| [F009](#f009) | P2       | contract         | CONFIRMED | SSE reconnect attempts are a cumulative budget for the whole logical stream, and the docs do not say so                             | `packages/core/src/sse/transport/event_stream.ts:157`                                              |
| [F010](#f010) | P2       | correctness      | CONFIRMED | WebSocket outbound JSON silently rewrites non-JSON values that HTTP rejects for the same value                                      | `packages/core/src/web_socket/codec.ts:11`                                                         |
| [F011](#f011) | P2       | contract         | CONFIRMED | An endpoint or path configuration error is reported as NET_UNREACHABLE                                                              | `packages/core/src/internal/url.ts:148-151`                                                        |
| [F012](#f012) | P2       | correctness      | CONFIRMED | The transport-origin mark permanently remembers shared sentinels, and interceptor failures are misclassified                        | `packages/core/src/internal/transport_origin.ts:1`                                                 |
| [F013](#f013) | P2       | contract         | CONFIRMED | withSSEReconnect does not validate numeric parameters, and a NaN budget causes infinite reconnects                                  | `packages/core/src/client/option.ts:202-206`                                                       |
| [F014](#f014) | P2       | security         | CONFIRMED | In a Worker, the XSRF token is attached to cross-origin requests                                                                    | `packages/core/src/http/transport/fetch.ts:28-30`                                                  |
| [F015](#f015) | P2       | correctness      | CONFIRMED | A non-ASCII event ID makes Last-Event-ID reconnect fail or encode incorrectly                                                       | `packages/core/src/sse/transport/event_stream.ts:241-247`                                          |
| [F016](#f016) | P2       | ops              | CONFIRMED | Publish jobs do not run typecheck, lint, or tests                                                                                   | `.github/workflows/release.yml:34-100`                                                             |
| [F017](#f017) | P2       | ops              | CONFIRMED | Publishing an adapter alone degenerates the ClientProvider return type to any                                                       | `.github/workflows/release.yml:51-100`                                                             |
| [F018](#f018) | P2       | ops              | CONFIRMED | CI runs tests only on Bun, so Node runtime behavior has no guard                                                                    | `.github/workflows/ci.yml:12-20`                                                                   |
| [F019](#f019) | P2       | docs             | CONFIRMED | After SSE is open, a TimeoutError abort throws, while the docs call it aborted                                                      | `doc/content/en-US/docs/sse.mdx:93`                                                                |
| [F020](#f020) | P2       | docs             | CONFIRMED | The terminal code for a non-2xx SSE reconnect does not match the documented HTTP_STATUS                                             | `doc/content/en-US/docs/sse.mdx:64` (the other 10 locales' `docs/sse.mdx:64` is the same sentence) |
| [F021](#f021) | P2       | docs             | CONFIRMED | The withEndpoint docs say a relative base is accepted, but only an absolute URL is                                                  | `packages/core/src/client/option.ts:19`                                                            |
| [F022](#f022) | P2       | contract         | CONFIRMED | A non-HttpResponse HTTP interceptor result rejects or is misreported                                                                | `packages/core/src/http/http.ts:412`                                                               |
| [F023](#f023) | P2       | correctness      | CONFIRMED | When writing binaryType throws, the already constructed socket is left behind and not closed                                        | `packages/core/src/web_socket/web_socket.ts:606-620`                                               |
| [F024](#f024) | P2       | contract         | CONFIRMED | onUploadProgress overwrites an explicitly set Content-Type                                                                          | `packages/core/src/http/transport/fetch.ts:452-455`                                                |
| [F025](#f025) | P2       | contract         | CONFIRMED | After an interceptor replaces the body, Content-Type cannot be specified, and an empty body keeps the old header                    | `packages/core/src/http/transport/body.ts:32-34`                                                   |
| [F026](#f026) | P2       | correctness      | CONFIRMED | Download progress treats the compressed Content-Length as the decoded total                                                         | `packages/core/src/http/transport/fetch.ts:264`                                                    |
| [F027](#f027) | P2       | contract         | CONFIRMED | A recursive Struct throws RangeError on deep or cyclic input                                                                        | `packages/core/src/struct/parse.ts:78`                                                             |
| [F028](#f028) | P2       | correctness      | CONFIRMED | An outer retry reuses Headers, and later spans hang under an already ended span                                                     | `packages/opentelemetry-server/src/interceptor/http.ts:32`                                         |
| [F029](#f029) | P2       | correctness      | CONFIRMED | queryPropagation only appends and does not replace a same-named key, so the receiver reads the old context                          | `packages/opentelemetry-server/src/propagation/carrier.ts:35`                                      |
| [F030](#f030) | P2       | contract         | CONFIRMED | A rejection from the HTTP responseHook is not recorded                                                                              | `packages/opentelemetry-server/src/telemetry/trace.ts:106-116`                                     |
| [F031](#f031) | P2       | contract         | CONFIRMED | The SSE tuple's third slot reads the live open and can be overwritten by a reconnect during trailing async work                     | `packages/core/src/sse/sse.ts:373-384`                                                             |
| [F032](#f032) | P2       | contract         | CONFIRMED | maxDelayMs constrains only the base before jitter, so the actual wait can exceed the cap                                            | `packages/core/src/internal/backoff.ts:11-12`                                                      |
| [F033](#f033) | P2       | contract         | CONFIRMED | The path-placeholder grammar is undocumented, and a static segment containing a colon cannot be expressed                           | `packages/core/src/internal/url.ts:36`                                                             |
| [F034](#f034) | P2       | correctness      | CONFIRMED | The GraphQL recipe rejects data: null, and an application error is misreported                                                      | `doc/examples/recipes/graphql-http-envelope.ts:13-17`                                              |
| [F035](#f035) | P2       | contract         | CONFIRMED | Flattening a nested intersection drops the inner nullable                                                                           | `packages/core/src/struct/constructors.ts:446-447`                                                 |
| [F036](#f036) | P2       | contract         | CONFIRMED | The public type of a single-member intersection loses optional                                                                      | `packages/core/src/struct/constructors.ts:417-418`                                                 |
| [F037](#f037) | P2       | contract         | CONFIRMED | An errorMap that returns an empty string does not replace the default message                                                       | `packages/core/src/struct/errors.ts:129-131`                                                       |
| [F038](#f038) | P2       | contract         | CONFIRMED | A bigint/date conversion failure from another package copy bypasses this call's errorMap                                            | `packages/core/src/struct/constructors.ts:378`                                                     |
| [F039](#f039) | P2       | contract         | CONFIRMED | When two @defjs/core instances coexist, caller cancellation is recorded as WARN                                                     | `packages/opentelemetry-server/src/telemetry/logs.ts:30`                                           |
| [F040](#f040) | P2       | correctness      | CONFIRMED | SSE strips a BOM per line and per field value, departing from the specification                                                     | `packages/core/src/sse/transport/parser.ts:181`                                                    |
| [F041](#f041) | P2       | correctness      | CONFIRMED | When the backoff base is 0, the 1025th retry throws RangeError                                                                      | `packages/core/src/internal/backoff.ts:11-16`                                                      |
| [F042](#f042) | P2       | docs             | CONFIRMED | Docs still claim the deleted packed-consumer and ES2022 baseline verification                                                       | `docs/releases/0.4.0.md:66`                                                                        |
| [F043](#f043) | P2       | docs             | CONFIRMED | Every documentation-site link in the published Core and OTel READMEs is dead                                                        | `packages/core/README.md:83-87`                                                                    |
| [F044](#f044) | P2       | docs             | CONFIRMED | design.md's statement about the subprotocol token is the opposite of the implementation                                             | `packages/core/design.md:237`                                                                      |
| [F045](#f045) | P2       | docs             | CONFIRMED | The CODE_OF_CONDUCT reporting channel is empty, so the enforcement process is unusable                                              | `CODE_OF_CONDUCT.md:61-63`                                                                         |
| [F046](#f046) | P2       | test             | CONFIRMED | The abort-listener regression test only compares counts, and removing the wrong callback still stays green                          | `packages/core/test/regression/abort-listeners.spec.ts:15-27`                                      |
| [F047](#f047) | P2       | test             | CONFIRMED | Two removals in WebSocket attempt cleanup are locked by no test                                                                     | `packages/core/src/web_socket/web_socket.ts:640`                                                   |
| [F048](#f048) | P2       | test             | CONFIRMED | SSE backoff-parameter tests only assert counts, and removing the wiring still stays green                                           | `packages/core/src/sse/transport/event_stream.advanced.spec.ts:1355-1373`                          |
| [F049](#f049) | P2       | test             | CONFIRMED | The test that responseHook runs before the span ends cannot detect an inverted order                                                | `packages/opentelemetry-server/src/interceptor/http.spec.ts:409-425`                               |
| [F050](#f050) | P2       | correctness      | CONFIRMED | checkLinks treats a directory without index.html as a valid link target                                                             | `doc/scripts/check-links.ts:41-44`                                                                 |
| [F051](#f051) | P2       | correctness      | CONFIRMED | After the search index fails to load the first time, it is cached forever and search fails silently                                 | `doc/app/components/search.tsx:16`                                                                 |
| [F052](#f052) | P2       | correctness      | PLAUSIBLE | API index filtering misses matches on uppercase I under the tr/az default locale                                                    | `doc/app/data/api-catalog.ts:11`                                                                   |
| [F053](#f053) | P3       | docs             | CONFIRMED | Several docs treat every declared body as a JSON check and parse                                                                    | `doc/content/en-US/api/opentelemetry-server.mdx:99`                                                |
| [F054](#f054) | P3       | docs             | CONFIRMED | OTel docs say an execute timeout always records one log, but a timeout outside the chain is not recorded                            | `packages/opentelemetry-server/README.md:95`                                                       |
| [F055](#f055) | P3       | i18n             | CONFIRMED | The Simplified Chinese and Hong Kong Traditional OTel pages translate "a declared body is missing" as "undeclared"                  | `doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:71`                                |
| [F056](#f056) | P3       | docs             | CONFIRMED | The decode-result table does not hold for an SSE handshake error-struct mismatch                                                    | `doc/content/en-US/docs/errors.mdx:79-81`                                                          |
| [F057](#f057) | P3       | docs             | CONFIRMED | withTimeout JSDoc still names the nonexistent ABORTED/TIMEOUT                                                                       | `packages/core/src/client/option.ts:49`                                                            |
| [F058](#f058) | P3       | docs             | CONFIRMED | The struct.object page says .alias reads by wire key                                                                                | `doc/content/en-US/api/core/struct-object.mdx:16`                                                  |
| [F059](#f059) | P3       | docs             | CONFIRMED | HttpRequestShape.body is miswritten as unknown on the module page                                                                   | `doc/content/en-US/api/http.mdx:160`                                                               |
| [F060](#f060) | P3       | docs             | CONFIRMED | The OTel README lists server.port as a required attribute                                                                           | `packages/opentelemetry-server/README.md:230-232`                                                  |
| [F061](#f061) | P3       | docs             | CONFIRMED | The Errors guide says data.status passing a struct proves it came from the backend                                                  | `doc/content/en-US/docs/errors.mdx:124-126`                                                        |
| [F062](#f062) | P3       | correctness      | CONFIRMED | A heartbeat ACK dispatched synchronously inside send is overwritten by a timeout created afterward                                  | `packages/core/src/web_socket/heartbeat.ts:69`                                                     |
| [F063](#f063) | P3       | correctness      | CONFIRMED | injectClient() misreports that the plugin is not installed when it errors outside the injection context                             | `packages/vue/src/core.ts:44-48` (primary)                                                         |
| [F064](#f064) | P3       | docs             | CONFIRMED | Four documentation links in the Struct README are dead, and a constructor-table row is duplicated                                   | `packages/core/src/struct/README.md:383`                                                           |
| [F065](#f065) | P3       | docs             | CONFIRMED | DESIGN-builder.md still calls itself the current contract and contradicts the code                                                  | `DESIGN-builder.md:3`                                                                              |
| [F066](#f066) | P3       | docs             | CONFIRMED | The root README's Codecov badge is stuck on the 2025-03-14 snapshot                                                                 | `README.md:12`                                                                                     |
| [F067](#f067) | P3       | i18n             | CONFIRMED | The Hong Kong Traditional interceptors guide has a whole sentence left in English                                                   | `doc/content/zh-Hant-HK/docs/interceptors.mdx:83`                                                  |
| [F068](#f068) | P3       | test             | CONFIRMED | Equal in types.type.test.ts accepts any                                                                                             | `packages/core/src/error/types.type.test.ts:5`                                                     |
| [F069](#f069) | P3       | test             | CONFIRMED | The ignored discriminatedUnion guard has no test                                                                                    | `packages/core/src/struct/constructors.ts:314-317`                                                 |
| [F070](#f070) | P3       | test             | CONFIRMED | Five Content-Length tests only assert duplex                                                                                        | `packages/core/src/http/transport/fetch.spec.ts:467`                                               |
| [F071](#f071) | P3       | test             | CONFIRMED | The documentation build fingerprint does not include dependency versions, so an old artifact is still judged fresh after an upgrade | `doc/scripts/build-state.ts:3-12`                                                                  |
| [F072](#f072) | P3       | test             | CONFIRMED | exports.test.ts is blind to type-only exports such as export type *                                                                 | `doc/test/exports.test.ts:13-37`                                                                   |
| [F073](#f073) | P3       | test             | CONFIRMED | A process-level miss log makes an in-process rerun of http.e2e report a false failure                                               | `packages/core/test/e2e-routes.ts:12-23`                                                           |
| [F074](#f074) | P3       | test             | CONFIRMED | Teardown port probing reports a false failure when the port is rebound by another process                                           | `packages/core/test/setup.ts:653-659`                                                              |
| [F075](#f075) | P3       | test             | CONFIRMED | Three path boundaries in preview.ts disagree with static hosting                                                                    | `doc/scripts/preview.ts:8`                                                                         |
| [F076](#f076) | P3       | over-engineering | CONFIRMED | The fillUrl branch that takes the first array item is unreachable on the public execution path                                      | `packages/core/src/internal/url.ts:17`                                                             |
| [F077](#f077) | P3       | over-engineering | CONFIRMED | The @types/react-dom version is pinned independently in two places                                                                  | `package.json:34-35`                                                                               |

## Finding Details

### P0

#### F001

**The core release package omits the fetch-event-source MIT notice**

- Review ID: P11-ops-01
- Verdict: CONFIRMED
- Severity: P0
- Category: ops
- Location: packages/core/tsdown.config.ts:48; packages/core/src/sse/transport/parser.ts:1-4; packages/core/THIRD_PARTY_NOTICES.md:5; .github/workflows/release.yml:41-49
- Sources: P11-ops-codex-01, P11-ops-grok-02
- Summary: The core build copies only `LICENSE` and `README.md`. The SSE parser packed into `index.js` / `index.min.js` is adapted from MIT code copyrighted by Microsoft, and the tarball contains none of that copyright or license text.
- Failure scenario: The tarball produced by any core release (the core job in release.yml, or a manual `npm publish` from `packages/core/dist`) lacks the Microsoft notice and does not satisfy the MIT condition that the "copyright notice and this permission notice shall be included in all copies or substantial portions". Downstream users and license scanners see only MunMunMiao's MIT notice. The already published `@defjs/core@0.4.0-beta.1` is exactly this case.
- Evidence:
  - Source `parser.ts:2-3` says `Portions of this file are adapted from Azure/fetch-event-source.` and `See packages/core/THIRD_PARTY_NOTICES.md for the license text.` Compared with upstream `src/parse.ts` (fetched read-only with curl): `getBytes`/`getLines`/`getMessages` correspond to `readStreamBytes`/`createLineParser`/`createMessageParser`, and the `ControlChars` enum, `discardTrailingNewline`, and `fieldLength` state machine have the same structure, so this is a substantial portion.
  - `tsdown.config.ts:48` is `copy: ['../../LICENSE', './README.md'],`.
  - In the clone, `cd packages/core && bun --bun run build` exited 0; then `cd dist && npm pack --dry-run` exited 0, `total files: 6`, files `LICENSE README.md index.d.ts index.js index.min.js package.json`.
  - `grep -ci microsoft` counts 0 in all 6 files. The only clue is in `index.d.ts:668-669`, a one-line Azure attribution that points at the unpacked `packages/core/THIRD_PARTY_NOTICES.md`.
  - Published package: the jsdelivr file-list API shows `@defjs/core@0.4.0-beta.1` has only `/index.d.ts /index.js /index.min.js /LICENSE /package.json /README.md`; in its `index.js`, `discardTrailingNewline` appears 4 times and `microsoft` appears 0 times.
  - Git history: this notice has never been on the copy list (since `744f7791` it has been `['../../LICENSE', './README.md']`). This is a long-standing problem, not a regression.
  - Also, `THIRD_PARTY_NOTICES.md:5` names the old path `src/transport/sse/parser.ts`; the actual file is `src/sse/transport/parser.ts`.
  - Severity note: zero runtime impact, and the fix is one line. It is P0 because `_shared.md` section 5 explicitly lists "release produces a non-compliant package" as P0, and the problem already exists in production. If the coordinator grades by functional consequence alone, P1 is the floor.
- Fix direction: Add `./THIRD_PARTY_NOTICES.md` to core's `copy`, and correct the source path inside it. Then confirm with `npm pack --dry-run` that the tarball contains the file.
- Tags: cross-partition (the notice file path belongs to the documentation scope)

### P1

#### F002

**Defined-path validation can be bypassed by a backslash or whitespace, sending auth headers to another origin**

- Review ID: P04-core-infra-01
- Verdict: CONFIRMED
- Severity: P1
- Category: security
- Location: packages/core/src/internal/url.ts:217, packages/core/src/internal/url.ts:218, packages/core/src/internal/url.ts:226, packages/core/src/internal/url.ts:138, packages/core/src/http/transport/fetch.ts:213, packages/core/src/sse/transport/event_stream.ts:254, packages/core/src/web_socket/build.ts:31, doc/content/en-US/docs/http.mdx:24, doc/content/en-US/api/core/createresolvedrequesturl.mdx:13
- Sources: P04-core-infra-codex-01
- Summary: `normalizeEndpointPath` checks `^scheme:` and a literal `//` only on the raw string; the following `new URL(path, base)` treats `\` as `/` under WHATWG rules, strips leading C0 controls and spaces, and deletes `\t`/`\n` anywhere. Equivalent absolute URLs and protocol-relative spellings therefore pass validation, and all three transports, HTTP, SSE, and WebSocket, send the request to the other host named in the path.
- Failure scenario: The client is configured with `withEndpoint('https://trusted.example/api')` and `withHeaders({ authorization: 'Bearer …' })`, or uses `basicAuthHttpInterceptor`/`basicAuthSSEInterceptor`, or enables the `withCredentials` cookie in a browser. When the defined path is any of the following forms, the request actually goes to `https://other.example/x` (WebSocket: `wss://other.example/ws`) and carries every default header and every authentication header injected by an interceptor: `'\\\\other.example/x'`, `'/\\\\other.example/x'`, `'\\/other.example/x'`, `' https://other.example/x'`, `'\thttps://…'`, `'h\tttps://…'`, `'\t//other.example/x'`, `'\n//other.example/x'`. Control: a literal `https://other.example/x` and `//other.example/x` are rejected.
- Evidence:
  - Contract `docs/http.mdx:24`: "Definition path can’t contain `?` or `#`, and can’t be absolute or protocol-relative."
  - Implementation `url.ts:218` is `if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path) || path.startsWith('//'))`; `:226` only strips a leading `/`; `:138` calls `new URL(normalizedPath, base)` directly.
  - Reproduction (no network request; a custom handle only records the Request): `cd …/repo/packages/core && bun --bun run build` (Build complete), then `cd /tmp/zen-audit/verified/P04-core-infra/scratch && bun url-bypass.mjs && node url-bypass.mjs`. Both exit 0 with identical output (excerpt):
    ```text
    http {"path":"https://other.example/x","code":"NET_UNREACHABLE","msg":"Endpoint path must not be an absolute URL","sent":null}
    http {"path":"\\\\other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"/\\\\other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":" https://other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"h\tttps://other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"\n//other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    sse {"path":"\\\\other.example/sse","code":"HTTP_STATUS","sent":{"url":"https://other.example/sse","auth":"Basic dTpw"}}
    ws {"path":"\\\\other.example/ws","code":"NET_UNREACHABLE","url":"wss://other.example/ws"}
    ```
  - Graded P1 rather than P0:
    - Triggering requires the defined path itself to contain these forms, or an interceptor to rewrite `req.endpoint` into these forms.
    - When an untrusted value is placed in a placeholder as the docs say, `encodePathSegment` encodes these characters with `encodeURIComponent` as `%5C`/`%20`/`%09`, so it cannot trigger.
    - But this is the only same-origin defense the docs declare, and bypassing it hands credentials to a third-party host.
  - Incidental observation: an absolute path that is correctly rejected returns `NET_UNREACHABLE` rather than a build-class error code. The reason is that validation throws inside the transport and is marked as coming from the transport.
- Fix direction: After parsing, compare the result URL's `origin` (and path prefix) with the base, instead of simulating the URL parser on the raw string. Preferably put this step in the build phase so it is reported as `REQ_BUILD_FAILED`, and add regression tests for the backslash, whitespace, and tab forms.
- Tags: cross-partition, runtime=both

#### F003

**SSE errorOpenInfoMap is keyed by a shared sentinel and leaks a response snapshot across requests**

- Review ID: P03a-core-sse-01
- Verdict: CONFIRMED
- Severity: P1
- Category: contract
- Location: packages/core/src/sse/transport/event_stream.ts:703; packages/core/src/sse/transport/event_stream.ts:705-711; packages/core/src/sse/transport/event_stream.ts:505-512; packages/core/src/sse/transport/event_stream.ts:528-529; packages/core/src/sse/sse.ts:389-395; packages/core/src/sse/sse.ts:530-539; packages/core/src/internal/abort.ts:51-55; packages/core/src/internal/abort.ts:144; packages/core/src/error/cause.ts:2; packages/core/src/error/cause.ts:5
- Sources: P03a-core-sse-codex-01
- Summary: `attachOpenInfo` writes the current stream's most recent open info into a module-level WeakMap, keyed by the failure object. The cancel and timeout paths pass the process-level singletons `ERR_ABORTED` / `ERR_TIMEOUT`, the map is never cleared, and `runEventStreamCommand` does not check ownership when it reads it back.
- Failure scenario:
  - Timeout path: client A opens a stream with `{ signal: AbortSignal.timeout(n) }`, and it expires after open. `finishAborted` takes `finishError(ERR_TIMEOUT)`, so `errorOpenInfoMap[ERR_TIMEOUT] = A.open`. Then another client B calls SSE `execute(cmd, { timeout: 30 })`, the server never responds, and the deadline aborts with `ERR_TIMEOUT` (`abort.ts:144`). B gets `[NET_TIMEOUT fault, undefined, A's open]`, whose status, response headers, and URL all belong to A. In a server-side multi-tenant process, B's error handling reads A's response metadata.
  - Cancel path: every normal `close()`, `break`, or dispose writes that stream's open into `errorOpenInfoMap[ERR_ABORTED]`. If the most recent write was a cancelled 401 handshake, a later startup whose handle throws `ERR_ABORTED` is reported by `createEventStreamFault` as `HTTP_STATUS` from that stale 401, when the correct result is `NET_ABORTED`.
- Evidence:
  - Reviewer probe `scratch/verify-probe.ts`: `bun verify-probe.ts` exit 0; after `bun build … --target=node`, `node node/verify-probe.js` exit 0. Node 26.11.1 and Bun 1.4.3 output the same:
    - `stream-A {"openUrl":"","closed":{"kind":"error","code":"NET_TIMEOUT"}}`
    - `stream-B-startup-timeout {"code":"NET_TIMEOUT","stream":"undefined","openUrl":"","tenantHeader":"A"}`
    - B uses a different client and endpoint, and the handle never returns, but the third slot carries A's `x-tenant: A` header. openUrl is empty because the probe uses a synthetic Response.
  - Re-running the codex probe on this clone (`scratch/codex-probe.ts`), both Bun and Node exit 0:
    - `stale-timeout-open {"code":"NET_TIMEOUT","fetchStarted":true,"secondGotResponse":false,"returnedRequestId":"first-request","bodyUnlocked":true}`
    - `stale-abort-classification {"expected":"NET_ABORTED","actual":"HTTP_STATUS","status":401,"returnedRequestId":"prior-401"}`
  - Related code:
    - `event_stream.ts:703` is `const errorOpenInfoMap = new WeakMap<object, EventStreamOpenInfo>()`; `:706` returns immediately when this attempt has no open, and the old mapping remains.
    - `:507-508` is `if (abortedError === ERR_TIMEOUT) { finishError(ERR_TIMEOUT) …}`; `:512` is `attachOpenInfo(abortedError, latestOpen)`.
    - `abort.ts:55` is `return timedOut ? ERR_TIMEOUT : ERR_ABORTED`.
    - `sse.ts:391` is `const openInfo = getErrorOpenInfo(cause)`, `:395` puts it in the third slot unchanged; `:530-539` produces `HTTP_STATUS` whenever a non-ok response is obtained.
  - The docs at `docs/sse.mdx:32` say "A response snapshot can still sit in the third tuple slot when validation fails after the response arrives.", but in this scenario B never received a response.
  - Severity rationale: an ordinary API combination (`AbortSignal.timeout` as the signal, plus the `timeout` option) makes a documented return slot carry another request's data, so this is P1. Not P0: there is no crash, the fault code on the timeout path is itself correct, and the leak requires the caller to read or log the third slot.
- Fix direction: Pass the open info along with this `fetchEventStream` failure, for example recorded on the stream owned by `sseHandler`, or wrapped and unwrapped at the catch; stop using a cross-request shared sentinel as the key of a side table. Add an isolation regression test: close or time out one stream first, then have another client time out or cancel at startup. This item and P04-core-infra-03 (the transport-origin WeakSet) are the same design defect and should be fixed together.
- Tags: cross-partition (same class as P04-core-infra-03), runtime=both

#### F004

**The default fetch is fixed at module evaluation, so a global fetch replaced afterward is bypassed**

- Review ID: P02-core-http-client-01
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/client/config.ts:199, packages/core/src/client/config.ts:205, packages/core/src/client/config.ts:212-220, packages/core/src/client/config.ts:225, packages/core/src/client/config.ts:234, packages/core/src/http/http.ts:340, packages/core/src/sse/sse.ts:348, doc/content/en-US/api/core/clientconfig-type.mdx:29
- Sources: P02-core-http-client-codex-01, P02-core-http-client-grok-01
- Summary: `PLATFORM_FETCH = globalThis.fetch` and `DEFAULT_FETCH = PLATFORM_FETCH.bind(globalThis)` are evaluated at import time and written into the default config. Replacing the global fetch afterward has no effect on any client that was not given `withHTTPHandle`/`withSSEHandle`, even if the client is created after the replacement; if there is no fetch at import time, the whole package throws at import.
- Failure scenario: First `import '@defjs/core'`, then a mock or instrumentation tool replaces `globalThis.fetch`, then `createClient(withEndpoint(...))`. The request bypasses the replacement and hits the real network, and the mock count is 0; at the same time the default argument of `fetchHandler()` does reach the new function. If `globalThis.fetch` is `undefined` at import time, importing the root entry throws `TypeError`, including for a user who only uses `struct`.
- Evidence:
  - `config.ts:199` is `const PLATFORM_FETCH = globalThis.fetch`, and `config.ts:205` is `export const DEFAULT_FETCH: FetchHandle = PLATFORM_FETCH.bind(globalThis)`.
  - `config.ts:212-220` writes it into `DEFAULT_HTTP_OPTIONS`/`DEFAULT_SSE_OPTIONS`, and `config.ts:225/234` only shallow-copies.
  - `http.ts:340` always passes `clientConfig.http.handle` to `fetchHandler`, so `resolveGlobalFetch()` in the default argument at `fetch.ts:360` never takes effect on the client path.
  - The docs at `clientconfig-type.mdx:29` say "`http.handle` and `sse.handle` are the global `fetch`".
  - `test/fetch-native-suite.ts:193-253` only locks "when the global is not replaced, the default handle equals `DEFAULT_FETCH`", and no test treats "a replacement after import is ignored" as the expected behavior.
  - Reproduction uses a real local server (port 0):
    - `bun scratch/a_fetch_capture.ts capture` (exit 0): `client created after patch {"fault":null,"data":"wire","patchedCalls":0}`, `fetchHandler() default after patch {"data":"mocked","patchedCalls":1}`.
    - `node scratch/node/a_fetch_capture.js capture` (exit 0): the same output.
    - missing mode (both exit 0): Bun is `IMPORT_THREW TypeError undefined is not an object (evaluating 'PLATFORM_FETCH.bind')`, Node is `IMPORT_THREW TypeError Cannot read properties of undefined (reading 'bind')`.
  - SSE is driven by the same constant (`sse.ts:348`); no separate SSE connection was opened to reproduce it.
  - The install timing of specific third-party libraries (MSW, OTel, Sentry) was not verified.
- Fix direction: Do not bind the platform fetch at module top level in the default config. Resolve the current global at send time, keeping the semantics of `resolveGlobalFetch()` (the unreplaced path takes the platform fast path; a replacement is handled as a custom handle). Defer a missing-fetch failure to the first HTTP/SSE call and report `ENV_UNSUPPORTED`.
- Tags: runtime=both, cross-partition (the SSE default handle belongs to P03)

#### F005

**On Node, FormData with progress is buffered whole and ignores timeout and cancellation**

- Review ID: P02-core-http-client-03
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:447, packages/core/src/http/transport/fetch.ts:496-499, packages/core/src/http/transport/fetch.ts:404, packages/core/src/http/http.ts:376-381, packages/core/README.md:49, doc/content/en-US/docs/http.mdx:150
- Sources: P02-core-http-client-codex-03
- Summary: The progress conversion runs `await new Response(body).blob()` on FormData with no signal constraint. A file FormData is materialized in full, using about 3 times the file size in memory; after cancel or deadline expiry, `execute` still waits for materialization to finish before it returns.
- Failure scenario: On Node, put a 512 MiB file into FormData with `fs.openAsBlob`, pass `onUploadProgress`, and add `timeout: 20` or abort at 20 ms. Without progress it returns in 22 ms with peak RSS about 136 MiB; with progress it returns only after 442-574 ms, with peak RSS about 1.6 GiB. The larger the file, the delay grows linearly, and it can OOM outright. If the File stream stalls, `execute` never returns.
- Evidence:
  - Code:
    - `await convertBodyToUploadStream(body)` at `fetch.ts:447` does not race the signal.
    - `fetch.ts:497-498` is `new Response(body)` plus `await serialized.blob()`.
    - The cancel branch at `http.ts:378-379` is `await Promise.allSettled([inflightTransport])` and must wait for the conversion to finish.
  - Contract:
    - `README.md:49`: "Ordinary HTTP work … is bounded with its execute-time timeout or `AbortSignal`".
    - `docs/http.mdx:150` says FormData "converts … to a stream" and does not mention buffering the whole body.
  - Reproduction: a real local server and a 512 MiB file, each combination in its own process, all exit 0.
    - `node plain timeout {"code":"NET_TIMEOUT","settledMs":23,"serverRequests":1,"maxRssMiB":136}`
    - `node plain abort {"code":"NET_ABORTED","settledMs":22,"abortFiredMs":20,"maxRssMiB":136}`
    - `node progress timeout {"code":"NET_TIMEOUT","settledMs":442,"serverRequests":0,"maxRssMiB":1618}`
    - `node progress abort {"code":"NET_ABORTED","settledMs":574,"abortFiredMs":19,"maxRssMiB":1630}`; a rerun was 532 ms / 1621 MiB.
  - Stall variant: codex's File subclass script, retargeted at this clone, exit 0 on Node, output `{"outcome":"STILL_PENDING_AFTER_200MS","fetches":0,"opened":1,"closed":0}`. `NET_TIMEOUT` arrives only after the stream is released.
  - Bun is not a library bug: Bun's platform fetch itself materializes FormData synchronously. plain is 158 ms / 1041 MiB, progress is 166 ms / 1043 MiB, almost the same. Bun also does not preserve File subclasses.
  - Codex's sub-conclusion that "on Bun the handle starts only after the deadline" had no observable consequence on a real server (serverRequests 0) and was not included.
  - The time numbers indicate magnitude only and are not a benchmark.
- Fix direction: Do not `blob()` the whole FormData. Use cancellable streaming serialization, for example `new Response(body).body`; when the total is unknown, `lengthComputable=false`. The conversion must race the request signal and release the reader on cancel.
- Tags: runtime=node

#### F006

**On Bun, a FormData upload with progress drops the boundary**

- Review ID: P02-core-http-client-02
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:496-499, packages/core/src/http/transport/fetch.ts:453-455, packages/core/src/http/transport/fetch.ts:472-477, packages/core/src/http/transport/body.ts:59-61, packages/core/src/http/transport/body.ts:76-77, packages/core/src/http/transport/fetch.streaming.spec.ts:420-485
- Sources: P02-core-http-client-grok-02
- Summary: `convertBodyToUploadStream` reads `headers.get('Content-Type')` only after `await serialized.blob()`. On Bun 1.4.3 that header is `null` after `blob()`, and the streaming body takes the detection branch and becomes `application/octet-stream`.
- Failure scenario: In a Bun server or CLI, POST FormData (including a file) and pass `onUploadProgress`. The server receives a multipart body, but the Content-Type is octet-stream with no boundary, and multipart parsing fails. Without progress it works; Node is unaffected.
- Evidence:
  - Platform mechanism (`bun -e` / `node -e`, exit 0):
    - Bun: `{"readBefore":"multipart/form-data; boundary=","readAfterBlob":null,"blobType":"multipart/form-data; boundary="}`
    - Node: `{"readAfterBlob":"multipart/form-data; boundary=",...}`
  - Library path: a real server echoes the Content-Type it received, run with `bun scratch/b_upload_ct.ts` and `node scratch/node/b_upload_ct.js`, both exit 0.
    - `bun default formdata plain {"ct":"multipart/form-data; boundary=----WebKitFormBoundary…","len":335}`
    - `bun default formdata progress {"ct":"application/octet-stream","len":335,"head":"------WebKitFormBoundary"}`
    - The custom handle result is the same.
    - `node default formdata progress {"ct":"multipart/form-data; boundary=----formdata-undici-…"}`
  - Test gap: the FormData progress cases in `fetch.streaming.spec.ts:420-485` use a mock fetch and do not check the request Content-Type. The partition tests all pass, 356 on Bun; CI runs only Bun.
  - Why this is P1: `docs/http.mdx:150` explicitly promises that FormData on Bun is converted to a stream and reports progress, and an upload under this combination is necessarily unparseable.
- Fix direction: Read the Content-Type before `blob()`, or use `blob.type` directly (both runtimes carry the boundary). Add an assertion that the real request's Content-Type contains both `multipart/form-data` and `boundary=`.
- Tags: runtime=bun

### P2

#### F007

**String(fault) contains the original response-field value, conflicting with "directly loggable"**

- Review ID: P04-core-infra-02 (merged: P01-core-struct-02)
- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/error/factory.ts:59, packages/core/src/error/cause.ts:30, packages/core/src/struct/errors.ts:124, packages/core/src/struct/utils.ts:248, packages/core/README.md:46, doc/examples/errors/log-fault.ts:5, doc/content/en-US/api/errors.mdx:63, doc/content/en-US/docs/errors.mdx:177, doc/content/zh-Hans/api/core/fault-type.mdx:14; doc/examples/errors/log-fault.ts:7; doc/content/en-US/docs/errors.mdx:152-158
- Sources: P04-core-infra-codex-02, P04-core-infra-grok-03
- Summary: `createDecodeFault` uses `describeCause(cause)` as the fault's message. The README, the API page, and the official logging example all treat `String(fault)` as a form that can be logged directly, while the same docs require Struct issues and the response body to be treated as sensitive data.
  - For `RES_STRUCT_MISMATCH`, the message is the StructError's first issue message and contains the original string or number of `received`.
  - For `RES_DECODE_FAILED`, the message is the JSON parser's error; on Node it contains the first several characters of the response body.
- Failure scenario: The server returns `{"email":"ada.lovelace@example.test"}`, while the client contract declares `email` as `struct.number()`. The caller follows `log-fault.ts:5` and runs `console.error(String(fault), …)`, and the log line is `DefjsFault: Expected number at email, received "ada.lovelace@example.test"`. If the response body is not JSON, on Node `String(fault)` is `DefjsFault: Unexpected token 's', "session=FA"... is not valid JSON`.
- Evidence:
  - On the docs side:
    - `README.md:46`: "`String(error)` is directly loggable".
    - `api/errors.mdx:63`: "produces a directly loggable `DefjsFault: <message>`".
    - `log-fault.ts:5` logs `String(fault)` unconditionally, and `:7` also logs `prettify()` unconditionally.
    - Contradicting that: `docs/errors.mdx:173` lists "Struct issues, body, input values" as sensitive, and `:177` requires "Treat … Struct issues, input values … as sensitive".
  - On the implementation side: `struct/utils.ts:248` runs `JSON.stringify(value)` on a string, `struct/errors.ts:124` splices it into the message, and `factory.ts:60` uses it unchanged as the fault message.
  - Reproduction: `bun|node fault-message.mjs` and `bun|node json-frag.mjs`, all exit 0, output:
    ```text
    mismatch number<-email {"code":"RES_STRUCT_MISMATCH","string":"DefjsFault: Expected number at email, received \"ada.lovelace@example.test\""}
    mismatch string<-ssn {"code":"RES_STRUCT_MISMATCH","string":"DefjsFault: Expected string at ssn, received 123456789"}
    {"rt":"bun","code":"RES_DECODE_FAILED","string":"DefjsFault: JSON Parse error: Unexpected identifier \"session\""}
    {"rt":"node","code":"RES_DECODE_FAILED","string":"DefjsFault: Unexpected token 's', \"session=FA\"... is not valid JSON"}
    ```
  - Graded P2: a received value of object type is written only as `object`, so the leak is limited to scalar fields and parser fragments; but the trigger is ordinary contract drift, and it follows exactly the logging style the docs recommend.
- Fix direction: Pick one and stay consistent. Either the `RES_*` fault message contains only the code and the path, leaving the original value on `cause`; or withdraw the "directly loggable" claim, change the example to log only `code`/`status` (`summarize-fault.ts` already has that style), and state that the output of `prettify()` is sensitive.
- Tags: cross-partition, runtime=both

<details><summary>Review record of merged item P01-core-struct-02</summary>

##### P01-core-struct-02 The default issue message embeds a scalar payload, and the official logging example writes it into the log unchanged

- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/struct/errors.ts:124; packages/core/src/struct/utils.ts:247-248; packages/core/src/error/cause.ts:31; packages/core/src/error/factory.ts:60; packages/core/README.md:46; doc/examples/errors/log-fault.ts:5-7; doc/content/en-US/docs/errors.mdx:152-158
- Sources: P01-core-struct-codex-08, P01-core-struct-grok-03
- Summary: The default message format is `Expected ${expected} at ${path}, received ${describeValue(received)}`. A string's original value is placed in whole after `JSON.stringify`, then becomes `StructError.message` and `Fault.message` in turn. The root README says `String(error)` is "directly loggable", and the docs example prints both `String(fault)` and `fault.cause.prettify()`, so the scalar payload enters the log.
- Failure scenario: A response field is declared as `struct.number()`, but the server returns a token or email in that field. The application logs the way `log-fault.ts` does, and the log contains `DefjsFault: Expected number at id, received "SYNTHETIC_PAYLOAD_123"`, and the `prettify()` line carries the same value. Objects and arrays appear in the message only as `object` / `array`, so the leak is limited to scalars.
- Evidence:
  - **Reproduction output (the same on both runtimes, data is synthetic):** `@@ H {"code":"RES_STRUCT_MISMATCH","text":"DefjsFault: Expected number at id, received \"SYNTHETIC_PAYLOAD_123\"","pretty":"× id: Expected number at id, received \"SYNTHETIC_PAYLOAD_123\""}`.
  - **Message path:** `errors.ts:124` builds the message, then `utils.ts:248` runs `JSON.stringify(value)` on a string, then `errors.ts:27-28` uses the first issue's message as the Error message, then `describeCause` at `cause.ts:31` takes `cause.message`, then `factory.ts:60` creates the fault from it.
  - **The docs contradict each other:**
    - The side that encourages logging directly: `packages/core/README.md:46` says "`String(error)` is directly loggable"; `log-fault.ts:5` is `console.error(String(fault), { code: fault.code })`, `:7` is `console.error(fault.cause.prettify())`, and this example is introduced by `errors.mdx:158`.
    - The side that requires redaction: `errors.mdx:173` lists "Struct issues, body, input values" as sensitive content; `docs/struct.mdx:95` says "Issues can hold untrusted input — redact before logging"; `src/struct/README.md:360` has the same warning.
  - **Why this is P2:** the Struct docs already have a local warning, and the leak happens only on the scalar of a mismatched field.
- Fix direction: Pick one. Either the default message no longer embeds the received value and keeps it only on `StructIssue.received`; or change the README's "directly loggable" claim and the `log-fault.ts` example to the same redaction requirement as the Struct docs.
- Tags: cross-partition (P09, P12), runtime=both

</details>

#### F008

**WebSocket reconnect attempts are a cumulative budget for the whole session, and the docs do not say so**

- Review ID: P03b-core-ws-02
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/web_socket/web_socket.ts:401; packages/core/src/web_socket/web_socket.ts:484-512; packages/core/src/web_socket/web_socket.ts:521; packages/core/src/client/config.ts:71; packages/core/src/client/config.ts:75; doc/content/en-US/docs/web-socket.mdx:52; doc/content/en-US/api/core/withwebsocketreconnect.mdx:25-27; doc/content/en-US/api/core/clientwebsocketoptions-type.mdx:34; doc/content/en-US/api/core/websocketexecuteoptions-type.mdx:30; doc/content/en-US/api/web-socket.mdx:106
- Sources: P03b-core-ws-grok-02 (codex confirmed the same behavior in coverage H1 but did not list it as a finding; the dispute has been adjudicated)
- Summary: `attempt` starts at 0 when the session starts and only increases, and a successful `open` does not replenish the budget; the same counter is also the backoff exponent, so independent drops hours apart also use an ever longer first wait.
- Failure scenario: `withWebSocketReconnect({ attempts: 3, delayMs: 100, factor: 2 })`. Each connection works normally for 1 hour, then the server drops it with 1012, and each reconnect succeeds immediately. The first wait after the 1st/2nd/3rd drop is 100/200/400 ms (not 100 ms each time). After the 4th drop the session ends with `{ kind: 'closed', code: 1012 }`, with no further reconnect and no error. A long-lived connection running with the default `attempts: 3` terminates silently on the 4th drop within its lifetime.
- Evidence: `web_socket.ts:401` `let attempt = 0`; `:484` `const nextAttempt = attempt + 1`, `:487` asks the predicate only when `nextAttempt <= reconnect.attempts`, `:512` `attempt = nextAttempt`, `:521` `computeReconnectDelay(reconnect, nextAttempt)`; `handleOpen` (`:692-732`) does not touch `attempt`, and there is no other write-back in the file. Review probe (fake timers, each connection first advances a 1-hour healthy period, Node/Bun agree): `PROBE BUDGET node=26.11.1 opens=4 beforeConnect=[0,1,2,3] gapsMs=[100,200,400] closed={"code":1012,"kind":"closed","reason":"drop","wasClean":true}` (bun=1.4.3 is the same). Docs: `docs/web-socket.mdx:52` "`attempts` counts retries after the initial attempt"; `withwebsocketreconnect.mdx:25` "`attempts` is the retry budget after the first connect", `:27` "every close is retried while the budget lasts"; `config.ts:71` "Retry budget after the first connect."; `config.ts:75` `factor` is "Multiplier applied to the delay after each failed attempt." The first few sentences do not say whether a successful open replenishes the budget; `config.ts:75` contradicts the runtime (the exponent still grows after a successful reconnect). No test locks the "not reset after success" semantics. Dispute adjudication: codex did not report it because "the docs do not promise a per-drop reset", grok reported P2; brief H1's standard is "if the lifetime-budget semantics are not written down, it is at least a docs/contract finding". The behavior was reproduced, the docs do not write it down, and the `factor` JSDoc contradicts the actual behavior, so grok is adopted. Not raised to P1: the default predicate also returns true for a clean close, and a cumulative budget can prevent infinite reconnects of the "connected and immediately closed" kind. That is a reasonable design, but it is not explained.
- Fix direction: If accumulation is intentional, write in the `withWebSocketReconnect` page, the WebSocket guide, and the `ClientWebSocketOptions.reconnect` JSDoc that "the budget and the backoff index accumulate over the whole logical session, and a successful open does not reset them", and correct the `factor` description; if it should be counted per drop, reset the counter after open, and add a constraint on the default predicate against "connected and immediately closed".
- Tags: runtime=both; SSE `retryCount` (P03a) is the same class, left to the P03a reviewer to judge

#### F009

**SSE reconnect attempts are a cumulative budget for the whole logical stream, and the docs do not say so**

- Review ID: P03a-core-sse-02 (merged: P09b-doc-api-01)
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/sse/transport/event_stream.ts:157; packages/core/src/sse/transport/event_stream.ts:412; packages/core/src/sse/transport/event_stream.ts:442; packages/core/src/sse/transport/event_stream.ts:458-460; packages/core/src/sse/transport/event_stream.ts:470; packages/core/src/client/config.ts:99; packages/core/src/client/config.ts:103; doc/content/en-US/docs/sse.mdx:62; doc/content/en-US/api/core/withssereconnect.mdx:31; doc/content/en-US/api/core/clientsseoptions-type.mdx:36; doc/content/en-US/api/client.mdx:241; doc/content/en-US/api/client.mdx:247; doc/content/en-US/recipes/consume-sse.mdx:22
- Sources: P03a-core-sse-grok-03. Codex reproduced the same behavior in coverage H1 but did not report it; the dispute has been adjudicated.
- Summary: `retryCount` starts at 0 and increments only inside `resolveRetryDelay`; it is not cleared after a successful handshake or after an event is delivered. The same counter is used as the budget, as the `attempt` received by `shouldReconnect`, and as the exponent of `computeReconnectDelay`.
- Failure scenario: A long-lived connection using `withSSEReconnect({ attempts: 3 })` (or the default of 3). Each physical connection works normally for a while, then drops, and the reconnect also succeeds immediately. On the 4th drop it does not reconnect: the iterator throws the raw network error, and `closed` is `{ kind: 'error', code: 'NET_UNREACHABLE' }`. If `factor > 1` is set, the wait for independent drops far apart also grows each time.
- Evidence:
  - The lifetime-budget section of `scratch/verify-probe.ts`, configured `attempts: 3, delayMs: 40, factor: 2`. Each connection delivers one event, stays healthy for 30 ms, then errors.
    - Bun output `{"fetches":4,"events":["e1","e2","e3","e4"],"iterationError":"connection lost","closed":{"kind":"error","code":"NET_UNREACHABLE"},"approxBackoffMs":[42,82,163]}`.
    - Node's `approxBackoffMs` is `[45,82,162]`; the other fields are the same.
  - Doc wording:
    - `sse.mdx:62`: "`attempts` counts retries after the initial attempt"
    - `withssereconnect.mdx:31`: "`attempts` is the retry budget after the first attempt"
    - `config.ts:99` means the same as the above; `config.ts:103` describes `factor` as "Multiplier applied to the delay after each failed attempt."
    - None of the above says whether the budget is restored after a successful open.
  - Grepping `attempts` throughout the SSE specs finds no test that locks "not reset after success" or the opposite semantics.
  - SSE-specific points:
    - The default `factor` is 1, so exponent accumulation is visible only when `factor > 1` is set explicitly; budget exhaustion happens under the default configuration.
    - The browser-native `EventSource` reconnects forever, so users migrating from it are more likely to expect "counted per drop".
  - The severity and the adjudication stay consistent with P03b-core-ws-02 (the same WebSocket semantics, P2 contract).
- Fix direction: If accumulation is intentional, write in the SSE guide, the `withSSEReconnect` page, and the `ClientSSEOptions.reconnect` JSDoc that the budget and the backoff index accumulate over the whole logical stream of one `execute`. If the intent is to count per drop, reset `retryCount` after an attempt opens successfully (or delivers an event), and decide this together with WebSocket.
- Tags: runtime=both; same root as P03b-core-ws-02 (implemented separately)

<details><summary>Review record of merged item P09b-doc-api-01</summary>

##### P09b-doc-api-01 The SSE reconnect reference page does not state that `attempts` is a cumulative budget for the whole logical stream, and a successful reconnect does not restore the budget

- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/api/core/withssereconnect.mdx:31; doc/content/en-US/api/core/clientsseoptions-type.mdx:36; doc/content/en-US/api/client.mdx:241; doc/content/en-US/api/client.mdx:247; packages/core/src/sse/transport/event_stream.ts:157; packages/core/src/sse/transport/event_stream.ts:412; packages/core/src/sse/transport/event_stream.ts:459; packages/core/src/sse/transport/event_stream.ts:470; packages/core/src/client/config.ts:99
- Sources: P09b-doc-api-codex-03, P09b-doc-api-grok-04 (only the SSE part is kept; the WebSocket part duplicates P03b-core-ws-02, see rejected.md)
- Summary: SSE's `retryCount` is set to 0 when the logical stream created by one `execute` starts, and only increases after that. A successful reconnect does not restore the budget, and the backoff exponent also accumulates across healthy periods. The API reference pages only say "the retry budget after the first attempt" and the default, and do not say the scope of the budget.
- Failure scenario: Configure `withSSEReconnect({ attempts: 2, delayMs: 7, factor: 3 })`. Three connections all open successfully, each delivers one event, then reading the stream fails. The wait for the second drop is 21 ms rather than 7 ms, even though the previous reconnect already succeeded. After the third drop the stream ends with `closed.kind === 'error'` and does not reconnect. A long-lived connection using the default `attempts: 3` ends permanently on the 4th drop within its whole lifetime. A reader who understands the budget as "3 tries per interruption" gets fewer retries.
- Evidence: Source `event_stream.ts:157` `let retryCount = 0`; `:412` `retryCount += 1`; `:459` `if (retryCount > attempts) {`; `:470` `return computeReconnectDelay({ delayMs, factor, jitter, maxDelayMs }, retryCount)`. A `grep -n retryCount` shows no other write-back in the file, and a successful open does not zero it. Original docs: `withssereconnect.mdx:31` "`attempts` is the retry budget after the first attempt. It defaults to `3` …"; `clientsseoptions-type.mdx:36` "`attempts` defaults to **3** …"; `client.mdx:241` the default-value table and `:247` do not mention the lifetime scope; the source JSDoc `config.ts:99` is the same sentence, "Retry budget after the first attempt." Review probe `/tmp/zen-audit/verified/P09b-doc-api/scratch/sse-budget.mjs` uses the newly built `packages/core/dist`, injects through the public `withSSEHandle`, and hooks `setTimeout` to record backoff values:
  ```text
  bun 1.4.3 SSE attempts=2 fetches=3 delivered=["gen-1","gen-2","gen-3"] policyAttempts=[1,2,3] backoffDelays=[7,21] closed=error
  node 26.11.1 SSE attempts=2 fetches=3 delivered=["gen-1","gen-2","gen-3"] policyAttempts=[1,2,3] backoffDelays=[7,21] closed=error
  ```
  Both runtimes exit 0. `shouldReconnect` is called a third time before the budget is checked, which matches the page's "runs before the attempts limit is checked" and is not a problem. Severity rationale: the same-root WebSocket item P03b-core-ws-02 is P2, and this stays consistent. Not raised to P1, because the docs do not promise "reset after success", and a cumulative budget can also be read as a reasonable design against infinite reconnects of the "connected and immediately dropped" kind. What is missing is an explanation of it.
- Fix direction: State in the `withSSEReconnect` page, the `ClientSSEOptions` page, the `client.mdx` default-value section, and the `config.ts` JSDoc that the budget and the backoff index accumulate over the whole logical stream of one `execute`, and a successful reconnect does not reset them; if the plan is to count per drop instead, that belongs to P03a and is handled in code.
- Tags: cross-partition (the code behavior belongs to P03a; the guide `docs/sse.mdx:62` belongs to P09a; the WS same-root item is P03b-core-ws-02), runtime=both

</details>

#### F010

**WebSocket outbound JSON silently rewrites non-JSON values that HTTP rejects for the same value**

- Review ID: P03b-core-ws-01 (merged: P01-core-struct-01)
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/codec.ts:11; packages/core/src/web_socket/web_socket.ts:1223; packages/core/src/web_socket/heartbeat.ts:65; packages/core/src/internal/outbound_request.ts:342; packages/core/src/web_socket/web_socket.ts:1236; packages/core/src/internal/outbound_request.ts:347-367
- Sources: P03b-core-ws-codex-01, P03b-core-ws-grok-01
- Summary: `serializeOutgoingWebSocketMessage` runs `JSON.stringify` directly on the value after struct validation, and only intercepts a root value whose result is `undefined`. `send` returns successfully, but the wire data differs from the value the caller handed over.
- Failure scenario: With `outgoing: struct.number()`, `session.send(Infinity)` makes the socket receive the text `null`; `struct.object({ n: struct.number() })` sending `{ n: -Infinity }` yields `{"n":null}`; `struct.any()` sending `new Map(...)`/`new Set(...)` yields `{}`, and a function field inside an object is deleted. `send` does not throw, and the same `struct.number()` cannot parse `null` on the other side. Direct send, queueing while `reconnecting` (what is queued is the already rewritten string), and heartbeat all share this path.
- Evidence: `codec.ts:11-15` is `const wire = JSON.stringify(encodeJson(outgoing, parseStructValue(outgoing, message)))`, then only `if (typeof wire !== 'string') throw new TypeError(...)`. The number check at `struct/constructors.ts:41` is `typeof value === 'number' && !Number.isNaN(value)`, and `docs/struct.mdx:127` says "`struct.number()` rejects `NaN`, accepts infinities." HTTP JSON bodies in the same repository use `JSON.stringify(encodeOutbound(body), rejectNonJson)` at `outbound_request.ts:342`, and `:347-366` reject non-finite numbers, functions, symbols, and non-plain objects; `docs/http.mdx:86` states that these values "fail with `REQ_BUILD_FAILED` before anything is sent, instead of being sent as `{}`, `null`, or no body at all". The WebSocket path has no corresponding guard. Review probe (Node/Bun agree): `PROBE JSON node=26.11.1 number Infinity: threw=false wire=null`; `object{n:-Infinity}: threw=false wire={"n":null}`; `any Map: threw=false wire={}`; `any Set: threw=false wire={}`; `any nested fn: threw=false wire={"keep":1}`; `PROBE JSON bun=1.4.3 number Infinity: threw=false wire=null`. Severity note (both auditors reported P1, downgraded to P2 here): the public WebSocket docs describe `send` exactly as "struct encode, then `JSON.stringify`" (`docs/web-socket.mdx:26`, `api/web-socket.mdx:112`), so there is no violation of a written contract; the problem is silent distortion from inconsistency with the HTTP path, and it appears only for non-finite numbers or non-JSON values inside `any`/`unknown` fields. Real but narrow. Ranked first among P2 because it is silent.
- Fix direction: Use a replacer equivalent to `rejectNonJson` at the shared boundary `serializeOutgoingWebSocketMessage`, so `send`/queue/heartbeat throw synchronously for a value that cannot be represented faithfully as JSON, and write that rule into the WebSocket docs.
- Tags: cross-partition, runtime=both

<details><summary>Review record of merged item P01-core-struct-01</summary>

##### P01-core-struct-01 WebSocket outbound JSON silently rewrites a non-JSON value that Struct already accepted, while HTTP fails closed on the same value

- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/codec.ts:11; packages/core/src/web_socket/web_socket.ts:1223; packages/core/src/web_socket/web_socket.ts:1236; packages/core/src/internal/outbound_request.ts:342; packages/core/src/internal/outbound_request.ts:347-367
- Sources: P01-core-struct-codex-01, P01-core-struct-grok-01
- Summary: `serializeOutgoingWebSocketMessage` runs `JSON.stringify` on the result of `encodeJson` without a replacer. The result is that `±Infinity` accepted by `struct.number()` is written as `null`, a `Map` in a `struct.any()` field is written as `{}`, and `session.send` does not report an error. An HTTP JSON body gets `REQ_BUILD_FAILED` for the same value.
- Failure scenario:
  - Under `outgoing: struct.object({ n: struct.number() })`, `session.send({ n: Infinity })` puts `{"n":null}` on the wire, and parsing that frame again with the same Struct yields `invalid_type`.
  - Under `struct.object({ p: struct.any() })`, sending `{ p: new Map([['k', 1]]) }` puts `{"p":{}}` on the wire.
  - In both cases the sender throws no exception.
- Evidence:
  - **Reproduction output (the same on both runtimes):** `@@ A.ws {"inf":"{\"n\":null}","ninf":"{\"n\":null}","map":"{\"p\":{}}","roundtrip":"invalid_type"}`, and `@@ A.http {"code":"REQ_BUILD_FAILED"}`.
  - **WebSocket path:** `codec.ts:11` is `const wire = JSON.stringify(encodeJson(outgoing, parseStructValue(outgoing, message)))`. `web_socket.ts:1223` takes that result, and `:1236` runs `openSocket.send(serialized)`.
  - **HTTP path:** `outbound_request.ts:342` uses `JSON.stringify(encodeOutbound(body), rejectNonJson)`. The comment at `:347-348` states that this guard specifically prevents "writes NaN and Infinity as null, and turns a Map, Set, stream or class instance into `{}`".
  - **`number` itself is not wrong:** `struct.number()` accepting Infinity is written in the docs (`struct-number.mdx:12`). The gap is that the WebSocket boundary is missing this guard.
  - **Downgrade rationale (P1 to P2):** `websocketsession-type.mdx:25` only promises that send "validates and encodes the message with the `outgoing` struct, then sends JSON text", and does not promise to reject non-JSON values; and only `±Infinity`, plus non-plain objects and functions inside any/unknown fields, trigger it.
  - **Out of scope for this item:** `String(Infinity)` in a path/query is scalar text and is unrelated to the problem here.
- Fix direction: WebSocket text frames reuse `rejectNonJson` (or share the same check with HTTP). On a non-JSON value, `send` throws `TypeError` synchronously, consistent with its existing `StructError` throw path.
- Tags: cross-partition (P03b), runtime=both

</details>

#### F011

**An endpoint or path configuration error is reported as NET_UNREACHABLE**

- Review ID: P02-core-http-client-06
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/url.ts:148-151, packages/core/src/internal/url.ts:199-203, packages/core/src/http/transport/fetch.ts:407, packages/core/src/http/transport/fetch.ts:213, packages/core/src/http/http.ts:388-397, packages/core/src/error/types.ts:13-14, doc/content/en-US/docs/errors.mdx:33-34, packages/core/src/sse/sse.ts:551; packages/core/src/sse/transport/event_stream.ts:254; packages/core/src/internal/url.ts:217-224
- Sources: P02-core-http-client-grok-06 (codex observed the same phenomenon in coverage H2 but did not list it as a finding)
- Summary: A configuration `TypeError` thrown by `resolveRequestUrl` inside the transport is stamped with a transport origin and classified as `NET_UNREACHABLE` by `createNetworkFault`. In fact the request never left, and the handle call count is 0.
- Failure scenario: Forgetting `withEndpoint`, or writing `withEndpoint('/api')` / `withEndpoint('not a url')`, yields `NET_UNREACHABLE` on every call. A caller that retries on `NET_*` according to the errors docs ("Nobody, or retry") will retry a configuration error over and over as if it were a network problem.
- Evidence:
  - Definitions at `error/types.ts:13-14`:
    - `REQ`: "The request never left: input, execute options, or build."
    - `NET`: "No usable response: cancel, timeout, connect, truncated body."
  - Reproduction: run with `bun scratch/ejkl_misc.ts` and `node scratch/node/ejkl_misc.js`, both exit 0.
    - `no endpoint {"code":"NET_UNREACHABLE","message":"Client endpoint is required","handleCalls":0}`
    - relative `/api` and `not a url` both get `NET_UNREACHABLE`, message `Client endpoint must be a valid URL`, `handleCalls` 0.
  - SSE same root: `bun scratch/k_sse.ts` (exit 0) gets `{"code":"NET_UNREACHABLE","message":"Client endpoint is required","calls":0}`, path `sse.ts:551`.
  - Existing tests only assert that a `TypeError` is thrown at `fetch.spec.ts:426-442`, and do not lock the fault code returned by `execute`.
  - The message text is correct, so this is P2.
- Fix direction: Parse and validate the endpoint before entering the transport's `try` (shared by HTTP and SSE), and return `REQ_*` (for example `REQ_BUILD_FAILED`).
- Tags: runtime=both, cross-partition (SSE belongs to P03, `internal/url.ts` belongs to P04)

#### F012

**The transport-origin mark permanently remembers shared sentinels, and interceptor failures are misclassified**

- Review ID: P04-core-infra-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/internal/transport_origin.ts:1, packages/core/src/internal/transport_origin.ts:18, packages/core/src/internal/transport_origin.ts:31, packages/core/src/http/http.ts:330, packages/core/src/http/http.ts:346, packages/core/src/http/http.ts:374, packages/core/src/sse/sse.ts:329, packages/core/src/sse/sse.ts:389, packages/core/src/sse/sse.ts:551, doc/content/en-US/api/core/err-aborted-type.mdx:12, doc/content/en-US/api/core/err-timeout-type.mdx:12
- Sources: P04-core-infra-codex-04 (review found a path more direct than the original report, triggered by the library itself)
- Summary: `markTransportOrigin` adds a value to a module-level `WeakSet` and never removes it. On cancel or timeout, the HTTP and SSE transports mark the shared singleton `ERR_ABORTED`/`ERR_TIMEOUT` returned by `resolveAbortCause`. After the first transport-side cancellation in the process, these two documented sentinels are permanently treated as "from the transport"; when the same value is later thrown from an interceptor, the classification depends on process history.
- Failure scenario:
  - The docs at `err-aborted-type.mdx:12` state: "SSE and WebSocket interceptors that throw it are reported as `EXT_INTERCEPTOR_FAILED`."
  - Right after process start, an SSE interceptor `throw ERR_ABORTED` gets `EXT_INTERCEPTOR_FAILED`, matching the docs.
  - After that, as soon as any unrelated client's HTTP request is aborted by the caller while fetch is in progress, the same SSE interceptor gets `NET_ABORTED`.
  - `ERR_TIMEOUT` is the same: after any HTTP timeout, it flips to `NET_TIMEOUT`.
  - The user-side variant in the original report also holds: the same Error instance thrown first by a Fetch handle and then by another client's interceptor yields `NET_UNREACHABLE`; an interceptor that throws a newly created Error gets `EXT_INTERCEPTOR_FAILED`.
- Evidence:
  - `transport_origin.ts:1` defines a module-level WeakSet, and `:18` only adds, with no delete.
  - `http.ts:346` is `throw markTransportOrigin(resolveAbortCause(transportAbort) ?? error)`; `abort.ts:51-55` returns only one of the two module-level singletons.
  - `sse.ts:389` calls `isTransportOrigin(error)`; when the result is true, `sse.ts:551` takes `createNetworkFault`.
  - Reproduction: `bun|node origin-mark.mjs` and `bun|node origin-timeout.mjs`, all exit 0, and both runtimes output the same:
    ```text
    sse-throw-ERR_ABORTED before any cancellation "EXT_INTERCEPTOR_FAILED"
    unrelated http fault "NET_ABORTED"
    sse-throw-ERR_ABORTED after an unrelated HTTP cancellation "NET_ABORTED"
    reused: first thrown by transport "NET_UNREACHABLE"
    reused: then thrown by interceptor "NET_UNREACHABLE"
    fresh error thrown by interceptor "EXT_INTERCEPTOR_FAILED"
    sse-throw-ERR_TIMEOUT before "EXT_INTERCEPTOR_FAILED"
    unrelated http with timeout "NET_TIMEOUT"
    sse-throw-ERR_TIMEOUT after "NET_TIMEOUT"
    ```
  - Existing tests cannot see this problem: `sse.fault.spec.ts:92` creates a new Error every time, and Vitest isolates modules per file.
  - Graded P2: the consequence is a classification error rather than a data error, and it requires an interceptor to throw the shared sentinel, or to reuse the same Error instance.
- Fix direction: Confine the origin record to a single execution (a local set per execution, or wrap and unwrap at the catch), and stop marking module-level shared sentinels. Add a regression test: an HTTP cancellation happens first, then an SSE interceptor throws `ERR_ABORTED`.
- Tags: cross-partition, runtime=both

#### F013

**withSSEReconnect does not validate numeric parameters, and a NaN budget causes infinite reconnects**

- Review ID: P03a-core-sse-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/client/option.ts:202-206; packages/core/src/sse/transport/event_stream.ts:458-470; packages/core/src/sse/transport/event_stream.ts:329-331; packages/core/src/internal/backoff.ts:11-16; packages/core/src/web_socket/reconnect.ts:20-35 (comparison)
- Sources: P03a-core-sse-codex-02, P03a-core-sse-grok-02
- Summary: `withSSEReconnect` only stores the object it is given. `attempts` is not checked at all; `delayMs`, `factor`, and `maxDelayMs` take part in the calculation only after a drop; `jitter` is checked only on the reconnect path. By contrast, WebSocket's `normalizeReconnectConfig` rejects the same class of illegal values before the session starts.
- Failure scenario:
  - `attempts`:
    - `withSSEReconnect({ attempts: Number(process.env.SSE_ATTEMPTS) })` yields `NaN` when the environment variable is unset, and `NaN ?? 3` is still NaN. `retryCount > NaN` is always false, so continuous failure reconnects forever; combined with a server `retry: 0` or `delayMs: 0`, that becomes a hot loop.
    - `attempts: 1.5` actually allows 2 Fetches; `-1` is equivalent to 0.
  - `delayMs: -100` (jitter 0) or `maxDelayMs: -1` silently turns reconnect off.
  - With `jitter: 1.1` the stream opens normally, and only the first drop throws `RangeError` and ends as `NET_UNREACHABLE`.
  - With `factor: NaN` the second reconnect throws `Reconnect delay must be finite`.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0 with identical output:
    - `budget`: NaN is `{"name":"NaN","calls":8,"code":"NET_ABORTED"}`; Infinity is also 8 calls (the 8th is the probe aborting on purpose to limit the loss); `fraction` is 2 calls; `negative` is 1 call.
    - `invalid-config-opens`: all six illegal configurations open normally with `eof`.
    - `invalid-config-on-drop`:
      - `jitter 1.1` ends as `NET_UNREACHABLE`, cause `SSE reconnect jitter is out of range`.
      - `factor NaN` reports `Reconnect delay must be finite` after 2 calls.
      - `delayMs -100` and `maxDelayMs -1` both end with the raw error after 1 call.
  - Code:
    - `option.ts:203-205` only assigns.
    - `event_stream.ts:458-459` is `const attempts = reconnect.attempts ?? 3; if (retryCount > attempts)`; `:466` is the only jitter check; `:329` sends a negative delay to `finishError`.
  - The docs at `withssereconnect.mdx:34` state `jitter (0 to 1)`.
  - A negative `delayMs` does not directly cause a hot loop (`:329` stops it), and both auditors correctly excluded that.
- Fix direction: Before `execute` starts (or inside `withSSEReconnect`), normalize by the same rules as WebSocket:
  - `attempts` is a non-negative safe integer;
  - `delayMs` and `maxDelayMs` are finite and >= 0;
  - `factor` is finite and > 0;
  - `jitter` is in [0,1].
    On an illegal value, fail as a configuration error (for example `REQ_OPTIONS_INVALID`), and keep the published SSE defaults.
- Tags: cross-partition (`option.ts` and `backoff.ts` belong to P04), runtime=both

#### F014

**In a Worker, the XSRF token is attached to cross-origin requests**

- Review ID: P02-core-http-client-09
- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/http/transport/fetch.ts:28-30, packages/core/src/http/transport/fetch.ts:52-61, packages/core/src/http/transport/fetch.ts:80-81, packages/core/src/http/transport/fetch.ts:430-432, doc/content/en-US/api/core/withxsrf.mdx:19, doc/content/en-US/docs/http.mdx:142
- Sources: P02-core-http-client-codex-04, P02-core-http-client-grok-04
- Summary: `isBrowserRuntime()` requires both `document` and `location` to exist. A Worker has no `document`, so it enters the "not a browser, treat as same-origin whenever there is a baseEndpoint" branch and skips the comparison with `location.origin`.
- Failure scenario: A client in a Worker uses `withXSRF({ tokenProvider })`, and the base points at another origin. The Worker attaches the token; the same configuration in a Window is stopped by the same-origin check.
- Evidence:
  - Code:
    - `fetch.ts:28-30` is `typeof document !== 'undefined' && typeof location !== 'undefined'`.
    - The `return true` at `fetch.ts:57-58` runs before the origin comparison at `fetch.ts:61`.
    - `isBrowserWindowOrWorker()` in the same file at `fetch.ts:430-432` does treat a Worker as a browser, so the two checks disagree.
  - `http.upload_progress.worker.browser.spec.ts:14` asserts `documentType === 'undefined'` inside a Worker.
  - Docs: `withxsrf.mdx:19` says "in a browser, the request URL has the same origin as the page"; `docs/http.mdx:142` says the same.
  - Global-object simulation, run with `bun scratch/ejkl_misc.ts` and `node scratch/node/ejkl_misc.js`, both exit 0:
    - `window cross-origin {"xsrf":null}`
    - `worker cross-origin {"xsrf":"FAKE-TOKEN"}`
    - `window same-origin {"xsrf":"FAKE-TOKEN"}`
  - Not verified end to end in a real browser Worker.
  - Limited impact: the path cannot be an absolute URL (`internal/url.ts:218-220`), so the token is sent only to the base configured on the client or to an origin rewritten by an interceptor.
- Fix direction: Whenever `location` exists, decide same-origin with `resolveRequestUrl(request).origin === location.origin`; still read `document.cookie` only when `document` exists.
- Tags: runtime=both, needs-browser (end to end)

#### F015

**A non-ASCII event ID makes Last-Event-ID reconnect fail or encode incorrectly**

- Review ID: P03a-core-sse-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/sse/transport/event_stream.ts:241-247; packages/core/src/sse/transport/event_stream.ts:196-200; packages/core/src/sse/transport/event_stream.ts:561-562; packages/core/src/sse/transport/parser.ts:231-235; doc/content/en-US/docs/sse.mdx:64; doc/content/en-US/api/core/withssereconnect.mdx:36; doc/content/en-US/api/core/clientsseoptions-type.mdx:36
- Sources: P03a-core-sse-codex-03, P03a-core-sse-grok-01
- Summary: The parsed ID is a UTF-16 JS string, and `headers.set(LAST_EVENT_ID_HEADER, lastEventId)` writes it directly as a ByteString.
- Failure scenario:
  - The server sends `id: 猫` and then drops, and the client has reconnect enabled: only 1 Fetch happens, the iterator throws a platform TypeError, and `closed` is `error` / `NET_UNREACHABLE`.
  - When the server sends `id: été`, reconnect succeeds, but the request-header bytes are `e9 74 e9`. A server that parses as UTF-8 gets the wrong ID, and the resume point is silently changed.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0. `id-header {"id":"猫","calls":1,"seen":[null],"eventIds":["猫"],"terminal":"error","code":"NET_UNREACHABLE",…}`. The cause on Bun is `Header 'last-event-id' has invalid value`, and on Node it is `Cannot convert argument to a ByteString because the character at index 0 has a value of 29483 which is greater than 255.` The ASCII and `é` controls are both 2 Fetches ending in `eof`.
  - The reviewer's probe uses the real global fetch and a local TCP server to read the raw request bytes, and Bun and Node agree: `last-event-id-wire {"events":[{"data":"first","id":"été"},{"data":"second"}],"closed":"eof","requests":2,"headerBytes":["e9","74","e9"],"utf8Expected":["c3","a9","74","c3","a9"]}`.
  - Code: the header write at `event_stream.ts:241-247` sits before the `try` at `:253`, so the exception falls into the fallback catch at `:196-200`. That catch is marked `istanbul ignore`, and the comment says it "only guards a type-invariant failure", but server data alone can trigger it.
  - The SSE section of WHATWG HTML (fetched with firecrawl this time) says, in the reconnect steps, "Let lastEventIDValue be the … last event ID string, encoded as UTF-8".
  - Severity: grok proposed P1. This item does break the documented resume contract, but the premise is that the server uses a non-ASCII ID, and common IDs are mostly numbers or UUIDs; between the two levels the lower one is taken, so P2.
- Fix direction: When writing the header, encode the ID as UTF-8 and hand the byte string to Headers; move the header write into each attempt's error handling so the exception does not escape to the fallback catch. Add reconnect tests for Unicode and Latin-1 IDs, and assert the bytes on the wire.
- Tags: runtime=both

#### F016

**Publish jobs do not run typecheck, lint, or tests**

- Review ID: P11-ops-03
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/release.yml:34-100; .github/workflows/ci.yml:3-6
- Sources: P11-ops-codex-03
- Summary: The four npm publish jobs are only `bun ci`, then `bun --bun run build`, then `npm publish`. There is no lint, typecheck, or test, and they do not check whether the chosen SHA passed CI; declaration generation uses `--noCheck`, and the build itself does not check types.
- Failure scenario: Dispatching a publish on a ref whose CI failed or never ran still builds and publishes code that has type errors. On HEAD, even if the SHA already passed CI, the artifact from P11-ops-02 is published anyway, because CI never checks the build configuration used for publishing.
- Evidence:
  - `release.yml:34-100` was read: no package job has a check step, and none has `needs:`. Only the docs job (line 119) runs `bun run typecheck`.
  - I reproduced the "build does not check types" layer: without the core dist, tsc reports TS2307 on the build config and exits 1, while tsdown in the same state exits 0 (see P11-ops-02). The source of `--noCheck` is the same.
  - Codex's `scratch/bad-release` (in a copy, `{ value: client }` changed to `{ value: 42 }`: tsc reports TS2769, tsdown exits 0) was read; the logic is sound, and I did not rerun it.
  - Manually selecting a publish is itself a design convention, but that does not include "do no checks at publish time". Commit `77a75294`, which deleted the packed-consumer gate, only says that gate was overhead, and does not say that typechecking is unnecessary at publish time.
- Fix direction: In the publish job, run `tsc -p tsconfig.build.json --noEmit` (or `bun run typecheck`) on the package being published, or check that the chosen SHA's CI has passed. The former also stops P11-ops-02.

#### F017

**Publishing an adapter alone degenerates the ClientProvider return type to any**

- Review ID: P11-ops-02
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/release.yml:51-100; packages/react/tsconfig.build.json:10-12; packages/react/src/core.ts:31-32; packages/vue/tsconfig.build.json:10-12; packages/opentelemetry-server/tsconfig.build.json:10-12
- Sources: P11-ops-codex-02, P11-ops-grok-01
- Summary: The react/vue/opentelemetry-server publish jobs build only their own package in a fresh checkout, and `tsconfig.build.json` maps `@defjs/core` to a nonexistent `../core/dist/index.d.ts`. tsdown generates declarations with tsgo `--noCheck` and exits 0, so the inferred `ClientProvider` return type in React becomes `any`.
- Failure scenario: A maintainer checks the react publish (even if core is checked at the same time, the two run on different runners) and the published `index.d.ts:27` is `FunctionComponentElement<ProviderProps<any>>`, while CI and the root build get `ProviderProps<Client | null>`. When a consumer uses `ClientProvider(...).props.value` as some other type, compilation does not error. Ordinary `<ClientProvider client={c}>` and `useClient()` are unaffected.
- Evidence:
  - All gitignored build artifacts were deleted in the clone to simulate a fresh checkout. After confirming `packages/core/dist` does not exist, `cd packages/{react,vue,opentelemetry-server} && bun --bun run build` was run in order: all three exit 0, and the logs have no diagnostics other than `TypeScript 7.0 ... experimental` (`scratch/isolated/*.build.log`).
  - Core and the adapters were then built in order (all 4 exit 0), and the two sets of artifacts were diffed:
    - react `index.d.ts` differs only on line 27: `ProviderProps<any>` versus `ProviderProps<Client | null>`.
    - vue and otel d.ts are identical, because the public functions have explicit return types (`withOpenTelemetryServer(...): ClientOption` at option.ts:78).
    - `index.js` and `package.json` are the same for all three packages.
  - After removing the core dist, `node_modules/.bin/tsc -p packages/<p>/tsconfig.build.json --noEmit`: all three packages exit 1 with `TS2307: Cannot find module '@defjs/core'`; otel also has `TS7006`.
  - `rolldown-plugin-dts@0.28.6` used by tsdown@0.23.0 hardcodes `"--noCheck"` at `dist/index.mjs:300`, which is why the build still exits 0.
  - Consumer comparison (`scratch/consumer-{isolated,ordered}`, TS 7, `skipLibCheck: false`): the JSX usage in `usage.tsx` passes on both sides; in `misuse.ts`, `const asText: string = ClientProvider({client}).props.value` exits 0 on the isolated build and exits 1 on the ordered build (`TS2322: Type 'Client | null' is not assignable to type 'string'`).
  - Live state: on jsdelivr, `@defjs/react@0.0.1-beta.1/index.d.ts:27` is `Client | null`. That version's manifest is `0.0.1-beta.1` / peer `0.4.0-beta.1`, while gitHead `f2b2a66d` committed `0.0.1` / `^0.4.0`, and release.yml does not change the version, so it can be inferred that it was not published by release.yml. This defect is not live yet.
  - Severity note: only one inferred return type degenerates, and ordinary usage is unaffected, so this is downgraded from the auditor's P1 to P2. The risk is that any future public export that depends on inference takes the same silent-degeneration path.
- Fix direction: The adapter publish job builds `@defjs/core` before building itself (or switches to a workspace-filtered build that waits for core), and adds a `tsc -p tsconfig.build.json --noEmit` step so failure to resolve `@defjs/core` fails the job.
- Tags: cross-partition (packages/react/src)

#### F018

**CI runs tests only on Bun, so Node runtime behavior has no guard**

- Review ID: P05-core-tests-02
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/ci.yml:12-20; bunfig.toml:5-6; package.json:50; packages/opentelemetry-server/e2e.spec.ts:267-288; packages/opentelemetry-server/README.md:97; doc/content/en-US/docs/start.mdx:12; packages/core/src/internal/http_request.ts:23-24
- Sources: P05-core-tests-codex-04
- Summary: The only CI job runs `bun run verify`, and `[run] bun = true` makes Vitest run on Bun. The docs claim Node.js support, but the different platform event order on Node, and the test branches that follow from it, never run in CI.
- Failure scenario: When core's path for a native WebSocket "`error` before `close`" regresses, or OTel's logic that records a WARN for a 1006 disconnect regresses, only Node users are affected: per the README a disconnect should end as `error` and record one WARN. Bun does not fire `error`, so CI stays green and the regression gets published.
- Evidence:
  - `ci.yml` has only one `ubuntu-latest` job, with steps `oven-sh/setup-bun@v2`, `bun ci`, and `bun run verify`; `bunfig.toml` is `[run] bun = true`.
  - `start.mdx:12`: states that `@defjs/core` is ESM and supports Node.js and Bun.
  - OTel `README.md:97` states that a 1006 disconnect on Node records one WARN, and on Bun it does not.
  - `e2e.spec.ts:274-288` picks one of two assertions based on `reportsErrorFirst`.
  - I measured the event order on both runtimes (`scratch/ws1006-order.mjs`, the same ws server calls `terminate()` after 20ms): `bun 1.4.3 ["close:1006"]`, `node 26.11.1 ["error","close:1006"]`. So CI only takes the `reportsErrorFirst=false` branch.
  - grok rejected H1 because local Node and Bun both pass 1757 with no skip that appears on only one runtime. That shows Node is not broken today, but it does not prove CI covers Node, and the two do not contradict.
- Fix direction: Keep the existing Bun verify, and add a job that explicitly runs the core-server and OTel non-browser tests in a Node process (for example `bunx vitest run --config vitest.config.ts --project core-server`, without `--bun`).
- Tags: cross-partition (P11 ops), runtime=node

#### F019

**After SSE is open, a TimeoutError abort throws, while the docs call it aborted**

- Review ID: P03a-core-sse-06
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:93; doc/content/en-US/api/core/eventstreamcloseinfo-type.mdx:15; packages/core/src/sse/transport/event_stream.ts:505-509; packages/core/src/sse/transport/event_stream.advanced.spec.ts:888-921
- Sources: added by the reviewer. Observed while reproducing P03a-core-sse-01; neither auditor reported it.
- Summary: Both the implementation and the tests treat "a caller abort after open whose reason is a TimeoutError (or `ERR_TIMEOUT`)" as a failure, while the docs loosely say the iterator ends normally and `closed` reports `aborted`.
- Failure scenario: The common form `client.execute(cmd, { signal: AbortSignal.timeout(60_000) })` is used to limit the stream's duration. When it expires, `for await` throws `ERR_TIMEOUT`, and `closed` is `{ kind: 'error', code: 'NET_TIMEOUT' }`. A consumer loop that only checks `closed.kind === 'aborted'` as the docs say, and is not wrapped in try/catch, receives an unexpected exception.
- Evidence:
  - The docs at `sse.mdx:93` say "So does aborting the `signal` or `abort` given to `execute` after the stream is open: the iterator ends normally and `closed` reports `aborted`."
  - `eventstreamcloseinfo-type.mdx:15` says "`aborted` means the stream was closed with `close()` or disposal, or its signal aborted".
  - The code at `event_stream.ts:507-508` is `if (abortedError === ERR_TIMEOUT) { finishError(ERR_TIMEOUT) … }`.
  - The test at `event_stream.advanced.spec.ts:888-921` explicitly locks: `next` rejects with `ERR_TIMEOUT`, and `closed` is `{ kind: 'error', code: 'NET_TIMEOUT', … }`. Also `:923` locks that `close(timeoutError)` still reports `aborted`.
  - Reviewer probe output `stream-A {"closed":{"kind":"error","code":"NET_TIMEOUT"}}`, the same on Bun and Node.
  - This behavior matches section 4 of _shared, "the cancellation shape stays NET_TIMEOUT", so the problem is that the docs over-generalize, not that the implementation is wrong.
- Fix direction: State in the SSE guide and on the `EventStreamCloseInfo` page that if the caller's signal aborts with a TimeoutError or `ERR_TIMEOUT` after open, the iterator throws `ERR_TIMEOUT` and `closed` is `error` / `NET_TIMEOUT`; only other reasons are `aborted`.
- Tags: cross-partition (the documentation content belongs to P09a/P09b), runtime=both

#### F020

**The terminal code for a non-2xx SSE reconnect does not match the documented HTTP_STATUS**

- Review ID: P03a-core-sse-05
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:64 (the other 10 locales' `docs/sse.mdx:64` is the same sentence); packages/core/src/sse/transport/event_stream.ts:661-667; packages/core/src/sse/transport/event_stream.ts:298-305; packages/core/src/sse/transport/event_stream.ts:561-562; packages/core/src/sse/transport/event_stream.ts:41-51
- Sources: P03a-core-sse-codex-07
- Summary: When the first startup hits a non-2xx, `sse.ts:530-539` turns it into an `HTTP_STATUS` fault. After the stream is already open, a non-2xx reconnect handshake goes through `validateOpenResponse`, throws `EventStreamFatalError('RES_DECODE_FAILED', …, { statusSignal: true })`, and that becomes the terminal code directly. `EventStreamFaultCode` itself does not contain `HTTP_STATUS`.
- Failure scenario: The first handshake is 200, reading the stream fails, then it reconnects, and the second handshake returns 401 (credentials expired, exactly the example in the docs). `closed` is `{ kind: 'error', code: 'RES_DECODE_FAILED' }`, and code that matches `HTTP_STATUS` to re-authenticate, as the docs say, does not hit. The status code can be read only from the live `stream.open.response.status`.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0: `reconnect-401 {"calls":2,"code":"RES_DECODE_FAILED","status":401}`.
  - The docs at `sse.mdx:64` say "If a credential still expires, the next handshake gets a non-2xx response, which ends the stream with `HTTP_STATUS`." Running `sed -n 64p | grep HTTP_STATUS` on each of the 11 locales hits 11, meaning line 64 of every locale contains the same conclusion.
  - The comment at `event_stream.ts:663-664` says this code is "only the fallback for a response that never carried a status", which does not hold for the reconnect path.
  - No test covers the non-2xx terminal code after reconnect: the 401/503 cases in the SSE specs are all at startup.
- Fix direction: The docs should distinguish the two cases: a startup fault is `HTTP_STATUS`; a reconnect failure of an already open stream is currently `RES_DECODE_FAILED`, and the status code is at `stream.open.response.status`. Alternatively, after review, add a status-class terminal code to `closed` and sync the types and the docs.
- Tags: cross-partition (the documentation content belongs to P09a), runtime=both

#### F021

**The withEndpoint docs say a relative base is accepted, but only an absolute URL is**

- Review ID: P02-core-http-client-07
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/src/client/option.ts:19, doc/content/en-US/api/core/withendpoint.mdx:14, packages/core/src/internal/url.ts:199-203, packages/core/src/internal/url.spec.ts:13
- Sources: P02-core-http-client-codex-06
- Summary: The JSDoc says "Absolute or relative base endpoint", and the API page says "absolute or relative base endpoint". The implementation only calls `new URL(baseEndpoint)`, with no second argument, and the tests also lock that `/api` is illegal.
- Failure scenario: A user calling a same-origin API in the browser writes `withEndpoint('/api')` as the API page says, and every request fails with `NET_UNREACHABLE`. The handle is never called (reproduction is in 06).
- Evidence:
  - Original text: `option.ts:19` and `withendpoint.mdx:14`.
  - Implementation: `url.ts:199-203` throws `TypeError('Client endpoint must be a valid URL')` on failure.
  - Test: `url.spec.ts:13` asserts that `createResolvedRequestUrl('/api', '/user/info')` throws that error.
  - Other docs all require an absolute URL: `design.md:17`, `docs/client.mdx:52` ("Absolute base endpoint for all transports").
- Fix direction: Change the JSDoc and the API page to "an absolute base URL".
- Tags: cross-partition (`withendpoint.mdx` belongs to P09)

#### F022

**A non-HttpResponse HTTP interceptor result rejects or is misreported**

- Review ID: P04-core-infra-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/http.ts:412, packages/core/src/http/http.ts:413, packages/core/src/http/http.ts:470, packages/core/src/interceptor/interceptor.ts:23, packages/core/src/interceptor/interceptor.ts:147, doc/content/en-US/docs/errors.mdx:145
- Sources: P04-core-infra-grok-01
- Summary: The HTTP chain's return value is read as an `HttpResponse` outside the try/catch, so:
  - when the chain resolves to `undefined` (forgetting `return` is common in JS), execute rejects with a TypeError;
  - when the chain resolves to a native `Response`, the result is `RES_STRUCT_MISMATCH`, because it treats the ReadableStream as the body;
  - SSE and WebSocket collect the same mistake into an `EXT_INTERCEPTOR_FAILED` tuple.
- Failure scenario:
  - JS or `any` code written as `createHttpInterceptor(async (req, next) => { await next(req) })`. Then `await client.execute(cmd)` throws `TypeError: Cannot read properties of undefined (reading 'headers')` (on Bun, `undefined is not an object (evaluating 'response.headers')`). This contradicts `errors.mdx:145`, "The execute promise settles once, with the tuple."
  - When an interceptor returns a native `Response`, this error is classified as the server contract error `RES_STRUCT_MISMATCH: Expected object at <root>, received [object ReadableStream]`, rather than an extension error.
- Evidence:
  - `http.ts:412-413` runs `const settledResponse = response as HttpResponse<unknown>; const meta = toHttpMeta(settledResponse)` after the catch.
  - Reproduction: `bun|node interceptor-result.mjs`, both exit 0. The following is Node output; the Bun conclusion is the same, only the TypeError wording differs:
    ```text
    http: forgot return {"settled":"REJECTED","error":"TypeError: Cannot read properties of undefined (reading 'headers')"}
    http: native Response {"settled":"tuple","code":"RES_STRUCT_MISMATCH","msg":"Expected object at <root>, received [object ReadableStream]"}
    sse: forgot return {"settled":"tuple","code":"EXT_INTERCEPTOR_FAILED","msg":"Cannot read properties of undefined (reading 'closed')"}
    ws: resolves undefined {"settled":"tuple","code":"EXT_INTERCEPTOR_FAILED","msg":"Cannot read properties of undefined (reading 'connection')"}
    ```
  - Graded P2 rather than P1: both of these return values are already forbidden by the types. `InterceptorFn`'s return type is `Promise<HttpResponse>`, and `interceptor.type.test.ts:110-111` also locks a native `Response` with `@ts-expect-error`.
- Fix direction: After the chain returns, and still inside the catch, check the `HTTP_RESPONSE` brand; if it does not match, collect it as `EXT_INTERCEPTOR_FAILED`, consistent with SSE/WebSocket.
- Tags: cross-partition (`http.ts` belongs to P02), runtime=both

#### F023

**When writing binaryType throws, the already constructed socket is left behind and not closed**

- Review ID: P03b-core-ws-05
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/web_socket.ts:606-620; packages/core/src/web_socket/web_socket.ts:622; packages/core/src/client/config.ts:30-43; doc/content/en-US/api/core/websockethandle-type.mdx
- Sources: P03b-core-ws-codex-02
- Summary: Constructing the socket and `socket.binaryType = 'arraybuffer'` share one catch. When the latter throws, a failure outcome is returned, but the already constructed socket is neither closed nor registered on `sessionController.currentSocket`, so no later cleanup path can find it.
- Failure scenario: The user injects, through `withWebSocketHandle`, an adapter class that exposes `binaryType` as a read-only getter (`WebSocketHandle` omits `binaryType`, which is legal in the types). In strict mode the assignment throws `TypeError`; execute returns `NET_UNREACHABLE`; with `reconnect: { attempts: 2 }`, 3 sockets are constructed in total, all `readyState 1`, and `close` is called 0 times. `NET_UNREACHABLE` looks retryable, so an outer retry loop keeps accumulating unclosed connections.
- Evidence: `web_socket.ts:608` does `new WebSocketImpl(...)` first, `:610-612` is `if ('binaryType' in socket) { socket.binaryType = 'arraybuffer' }` (a getter-only accessor makes `in` true), the catch at `:613-619` returns `{ opened: false, cause: error }` directly, and `sessionController.currentSocket = socket` at `:622` does not run. `websockethandle-type.mdx` says "The transport sets `binaryType = 'arraybuffer'` when the property exists." and does not require it to be writable. Review probe: `PROBE BINARYTYPE node=26.11.1 fault=NET_UNREACHABLE cause=TypeError: Cannot set property binaryType of #<Socket> which has only a getter session=undefined sockets=3 states=[1,1,1] closeCalls=[0,0,0]`; `bun=1.4.3 ... cause=TypeError: Attempted to assign to readonly property. ... sockets=3 states=[1,1,1] closeCalls=[0,0,0]`. Severity note: `binaryType` is writable in browsers, undici, Bun, and `ws`, so the trigger is limited to a custom adapter and startup necessarily fails; but the consequence is a leftover real network connection plus a misleading retryable fault, so P2 is kept.
- Fix direction: Separate setting `binaryType` from construction: ignore a failed set (the property is only an optimization), or best-effort `close()` the already constructed handle before returning failure; do not let a successfully constructed socket leave the cleanup responsibility.
- Tags: runtime=both

#### F024

**onUploadProgress overwrites an explicitly set Content-Type**

- Review ID: P02-core-http-client-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/transport/fetch.ts:452-455, packages/core/src/http/transport/fetch.ts:472-477, packages/core/src/http/transport/fetch.ts:484-494, packages/core/src/http/transport/body.ts:41-51, doc/content/en-US/docs/http.mdx:84, packages/core/design.md:159
- Sources: P02-core-http-client-codex-02
- Summary: The progress conversion writes `converted.contentType` into the header and `bodyContentType`, and sets the new stream as the source. The `content-type` the builder wrote in `headers` therefore loses its override.
- Failure scenario: On the server, the builder returns `{ body: arrayBuffer, headers: { 'content-type': 'image/png' } }` and passes `onUploadProgress`. The server receives `application/octet-stream`; a Blob/File receives `blob.type`. An upload whose signature includes the Content-Type fails, and a service that routes by media type picks the wrong handler.
- Evidence:
  - Contract:
    - `docs/http.mdx:84`: "Set `content-type` on `headers` to override the default."
    - `design.md:159`: the builder's `content-type` overrides the detected result.
  - Code: `fetch.ts:453-455` and `fetch.ts:475-476` write the detected value, and `body.ts:49-51` adopts it unconditionally.
  - Reproduction: a real server, run with `bun scratch/b_upload_ct.ts` and `node scratch/node/b_upload_ct.js`, both exit 0; default and custom handle agree.
    - `arraybuffer_custom plain {"ct":"application/x-custom"}`
    - `arraybuffer_custom progress {"ct":"application/octet-stream"}`
    - On Bun, `blob_custom progress {"ct":"text/plain;charset=utf-8"}`
    - On Node, `file_custom progress {"ct":"text/plain"}`
  - Downgraded from P1 to P2: it needs "server runtime + progress observer + binary body + explicit type different from the detected value" all at once, and the body bytes do not change.
  - It shares `prepareUploadProgressRequest` with 02, but the trigger and the fix point differ, so it is recorded separately.
- Fix direction: When converting to a stream, keep the Content-Type that finally takes effect on the original request (explicit header or `bodyContentType` first), and use the detected value only when the original request has no type. FormData still follows the boundary actually serialized.
- Tags: runtime=both

#### F025

**After an interceptor replaces the body, Content-Type cannot be specified, and an empty body keeps the old header**

- Review ID: P02-core-http-client-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/transport/body.ts:32-34, packages/core/src/http/transport/body.ts:41-42, packages/core/src/http/transport/body.ts:55-61, packages/core/src/internal/transport_request.ts:55, packages/core/src/internal/transport_request.ts:66, doc/content/en-US/docs/interceptors.mdx:42, doc/content/en-US/api/core/httprequest-type.mdx:13
- Sources: P02-core-http-client-grok-05
- Summary: `applyRequestContentType` decides whether metadata is stale only by body identity. As soon as the body changes, both the `content-type` header newly written by the interceptor and the public field `bodyContentType` are overwritten by the detected value, and only rewriting the `@internal` `bodyContentTypeSource` takes effect. When the body becomes `undefined`, the function returns immediately, and the `application/json` detected at build time stays on the empty request.
- Failure scenario:
  - (a) An interceptor copies the request as the docs say and rewrites the JSON body, while also setting the header or `bodyContentType: 'application/json'`. The request on the wire is always `text/plain;charset=UTF-8`, and a server parser that depends on a JSON Content-Type cannot read the body.
  - (b) An interceptor runs `next({ ...req, body: undefined })`. The sent request has an empty body but carries `Content-Type: application/json`, and a strict framework rejects an empty JSON body.
- Evidence:
  - Docs:
    - `interceptors.mdx:42`: "Fetch ignores stale content-type metadata when the body value changed."
    - `httprequest-type.mdx:13` publishes `bodyContentType`, and the source field is marked `@internal`.
  - Code:
    - `transport_request.ts:55` sets the source, and `:66` writes the detected result into headers before entering the interceptor.
    - `body.ts:41-42` and `body.ts:55-61`: when the source does not match the current body, `bodyContentType` and the existing header are ignored.
    - `body.ts:32-34`: when the body is `undefined`, return immediately.
  - Reproduction: run with `bun scratch/ejkl_misc.ts` and `node scratch/node/ejkl_misc.js`, both exit 0, and the two runtimes agree.
    - `new json string + header {"ct":"text/plain;charset=UTF-8"}`
    - `new json string + bodyContentType {"ct":"text/plain;charset=UTF-8"}`
    - `body undefined {"ct":"application/json","body":""}`
  - What `interceptor.spec.ts:125-155` locks, "replaced with a plain string and no declared type, re-detected as text/plain", is by design and is not part of this finding.
  - Dispute about (b): codex held that no contract requires deleting a header the user wrote. But this header was not written by the user; it was detected at `transport_request.ts:66`, which is exactly the stale metadata the docs talk about, so grok's conclusion is adopted.
  - Graded P2: it affects only interceptors that rewrite or delete the body, and there is a workaround through an internal field.
- Fix direction: A `bodyContentType` given explicitly by the interceptor (or a `content-type` header different from the original value) should take effect for the new body. When the body becomes `undefined`, delete the Content-Type written by detection.
- Tags: runtime=both, cross-partition (`internal/transport_request.ts` belongs to P04)

#### F026

**Download progress treats the compressed Content-Length as the decoded total**

- Review ID: P02-core-http-client-08
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:264, packages/core/src/http/transport/fetch.ts:307-310, packages/core/src/http/transport/utils.ts:4-12, doc/content/en-US/docs/http.mdx:148
- Sources: P02-core-http-client-codex-05, P02-core-http-client-grok-03
- Summary: `total` is the encoded byte count on the wire, and `loaded` accumulates the decoded byte count. With gzip/br, the event reports `lengthComputable: true`, but `loaded` is far larger than `total`.
- Failure scenario: Declare a JSON `output` and pass `onDownloadProgress`. The response is gzip-compressed and carries `Content-Length`. Progress shows far over 100% (measured at 68,501%); the decoded result itself is correct.
- Evidence:
  - Code: `fetch.ts:264` reads Content-Length; `fetch.ts:307-310` accumulates `byteLength` and sets `lengthComputable: contentLength > 0`; there is no Content-Encoding branch.
  - Reproduction: a gzip response on a real socket, run with `bun scratch/f_gzip_progress.ts` and `node scratch/node/f_gzip_progress.js`, both exit 0; default and custom handle agree.
    - Bun: `{"decodedLen":100000,"wireBytes":146,"last":{"lengthComputable":true,"loaded":100011,"total":146},"maxPct":68501}`
    - Node: `{"wireBytes":145,"last":{"lengthComputable":true,"loaded":100011,"total":145},"maxPct":68973}`
  - `docs/http.mdx:148` does not say that the two are measured on different bases.
  - Codex could reproduce it only with a fixture at the time; this time the real on-the-wire reproduction was filled in.
- Fix direction: When there is a `Content-Encoding` other than `identity`, report `lengthComputable: false` and `total: 0`.
- Tags: runtime=both

#### F027

**A recursive Struct throws RangeError on deep or cyclic input**

- Review ID: P01-core-struct-03
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/parse.ts:78; packages/core/src/struct/parse.ts:245; packages/core/src/struct/introspection.ts:51-57; packages/core/src/struct/encode.ts; packages/core/src/struct/codec/json.ts:8
- Sources: P01-core-struct-codex-04, P01-core-struct-grok-02
- Summary: An object Struct that recurses through a getter has neither a depth limit nor cycle detection. A deep document that `JSON.parse` can parse normally makes `struct.parse` throw `RangeError: Maximum call stack size exceeded`.
- Failure scenario: Let `Node = struct.object({ get child() { return Node.null() } })`, and the input be `JSON.parse('{"child":'.repeat(50000) + 'null' + '}'.repeat(50000))`. Then `struct.parse` throws directly instead of returning `[StructError, undefined]`; `decodeJson` and `encodeJson` throw as well. When the input is changed to a cyclic object `cyc.child = cyc`, `struct.parse` also throws.
- Evidence:
  - **Reproduction output (the same on both runtimes):** 1000, 5000, and 10000 levels are all `no-throw`; 50000 levels are `parse=RangeError decode=RangeError encode=RangeError`; the cyclic object outputs `@@ D.cycle "RangeError"`.
  - **The threshold moves:** the depth that triggers it depends on the schema and the runtime. grok triggered it at about 8000 levels on Node with a wider schema.
  - **Contract violated:** `api/core/struct-parse.mdx:20` says "Invalid input never throws.", and the input here is itself legal.
  - **Why nothing caught it:** `parseEntry` (`parse.ts:77-83`) has only try/finally; `parseStructTuple` (`introspection.ts:51-57`) does not catch exceptions either.
  - **Every transport layer did catch it:**
    - HTTP outputs `@@ D.http {"code":"RES_DECODE_FAILED","cause":"RangeError"}`, corresponding to `http.ts:456`.
    - WebSocket turns it into `emitRuntimeError` at `web_socket.ts:747-751`.
    - SSE turns it into `notifyInvalidEvent` at `sse.ts:439-448`.
  - **Why this is P2:** it affects only code that calls these three APIs directly, and it does not crash the process.
- Fix direction: Add a depth count and cycle detection at the recursion boundary (or switch to an explicit stack), and return a `StructError` with a path when the limit is exceeded. The HTTP layer then naturally classifies it as `RES_STRUCT_MISMATCH`.
- Tags: cross-partition, runtime=both

#### F028

**An outer retry reuses Headers, and later spans hang under an already ended span**

- Review ID: P06-otel-server-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/opentelemetry-server/src/interceptor/http.ts:32, packages/opentelemetry-server/src/interceptor/http.ts:53-54, packages/opentelemetry-server/src/interceptor/sse.ts:37, packages/opentelemetry-server/src/interceptor/sse.ts:50-51, packages/core/src/internal/transport_request.ts:44, packages/core/src/interceptor/interceptor.ts:10-17, doc/examples/interceptors/retry-safe-reads.ts:47-55, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:171, packages/opentelemetry-server/src/interceptor/http.spec.ts:566-580, packages/opentelemetry-server/src/interceptor/sse.spec.ts:618
- Sources: P06-otel-server-codex-01, P06-otel-server-grok-02
- Summary: The interceptor extracts the parent context from `req.headers`, then writes this span's `traceparent` back into the same `Headers` in place. When an outer interceptor calls `next(req)` again with the same request, the parent extracted on the next attempt is the previous client span.
- Failure scenario: Inside an inbound server span, run `createClient(withInterceptors(retry), withOpenTelemetryServer({ tracer }), withHTTPHandle(...))`. `retry` has the same structure as `retry-safe-reads.ts`, calling `next(request)` on the same `request` inside a loop. The handle returns 503, 503, then 200. The expected result is that all three CLIENT spans have the inbound span as parent; actually the 2nd has the 1st as parent and the 3rd has the 2nd as parent, forming a chain. SSE case: an outer SSE interceptor retries after a 503 handshake, and the 2nd span likewise has the 1st as parent.
- Evidence: Probe `/tmp/zen-audit/verified/P06-otel-server/scratch/zz_verify_p06.spec.ts`, using a real `BasicTracerProvider`, `InMemorySpanExporter`, and `AsyncLocalStorageContextManager`. It was copied temporarily into `packages/opentelemetry-server/src/` at runtime and deleted after the run.
  - Command: `bunx vitest run --config vitest.config.ts --coverage.enabled=false --silent=false src/zz_verify_p06.spec.ts`, Node exit 0, 12/12; `bun --bun vitest run ...` the same command, exit 0, 12/12.
  - Node output: `H1-http {"order":"retry-outer",...,"server":"1cd0541b987382f0","attempts":[{"id":"de15de4905a4bf68","parent":"1cd0541b987382f0","status":503},{"id":"090c0cc704974001","parent":"de15de4905a4bf68","status":503},{"id":"484b2a8318e480c4","parent":"090c0cc704974001","status":200}]}`.
  - Control (OTel registered before retry, that is, on the outside): only one span, `parent` is the inbound span.
  - SSE output: `{"server":"7c9b...","attempts":[{"id":"8581...","parent":"7c9b...","status":2},{"id":"e02c...","parent":"8581...","status":1}]}`.
  - The Bun result has the same structure as Node.
  - Code basis: `http.ts:32` is `propagator.extract(context.active(), req.headers ?? new Headers(), headersGetter)`; `http.ts:53-54` is `const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers)` followed by `propagator.inject(spanCtx, headers, headersSetter)`. Core creates one `Headers` per execute (`transport_request.ts:44`). `interceptor.ts:13-16` explicitly allows the same layer to call `next` again; the integration guide at :171 says "A new outer retry is a new lifecycle".
  - The existing test `should reuse existing Headers when req.headers is already Headers` (http.spec.ts:566, sse.spec.ts:618) locks in-place reuse of the same object and does not cover the parent-child relationship after reentry; the mock tracer's span id is fixed, so it cannot discover this either.
  - Severity: codex reported P1, grok reported P2, and P2 is taken. The trace id does not change; the `traceparent` sent on each attempt points at its own span, so the parent-child relationship of the downstream server span is correct; metrics and logs are unaffected. What is wrong is only the client-side tree of a retried request in the order "retry is outside OTel", and there is no data loss.
- Fix direction: Extract the parent context from the carrier as it was when entering the interceptor, and write the injection onto a copy of the Headers handed to `next`, without changing the object the caller holds. Also change the two tests that lock object identity, and add a real-SDK test asserting that spans from multiple retries are siblings under the same parent.
- Tags: cross-partition, runtime=both

#### F029

**queryPropagation only appends and does not replace a same-named key, so the receiver reads the old context**

- Review ID: P06-otel-server-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/opentelemetry-server/src/propagation/carrier.ts:35, packages/opentelemetry-server/src/interceptor/web_socket.ts:68-74, packages/opentelemetry-server/src/interceptor/web_socket.ts:155-173, packages/core/src/web_socket/build.ts:30-38, packages/opentelemetry-server/test/setup.ts:46, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:65, packages/opentelemetry-server/README.md:214
- Sources: P06-otel-server-codex-03, P06-otel-server-grok-01
- Summary: `queryStringSetter` uses `params.append`, and `appendInjectedQueryString` only appends the new value to the end of the original query string. A same-named propagation field already in the query stays in front, and a receiver that takes the first value gets the old context.
- Failure scenario: Turn on `webSocket.queryPropagation: true`. The `URLSearchParams` returned by the builder already contains an upstream `traceparent` and `baggage=tenant=old`, and the current context's baggage is `tenant=new`. Core uses the queryString given by the interceptor for the socket URL. The final URL contains two `traceparent`s and two `baggage`s, and `new URL(url).searchParams.get('traceparent')` returns the old value, not this WebSocket span.
- Evidence: The same probe. The real URL received by the in-memory WebSocket constructor (the same on Node and Bun): `wss://api.example.test/ws?room=a&traceparent=00-11111111111111111111111111111111-2222222222222222-01&baggage=tenant%3Dold&traceparent=00-68f5...-420cf7b3225c044a-01&baggage=tenant%3Dnew`, output `"firstIsCurrentSpan":false`. Control (the query originally has no same-named key) outputs a single value, `firstIsCurrentSpan:true`.
  - This package's test server at `test/setup.ts:46` reads with `c.req.query('traceparent')`, which also takes the first value.
  - Mutation probe: after changing `carrier.ts:35` to `set`, the whole OTel suite on Node exits 0, 288/288 (log `scratch/mutation-carrier-set-node.log`), and was restored with `git checkout`. That shows existing tests lock neither append nor set, and the duplicate-key case is not covered by tests.
  - The integration guide at :65 says "propagator fields append to the connection query string", which describes where the append happens, and does not say that the old value wins on a duplicate key.
  - It triggers only when explicitly enabled (default false) and the query already has a same-named key, so this is P2.
- Fix direction: On injection, replace same-named keys listed by the propagator's `fields()`, and keep `queryParams` and `queryString` in sync, preserving the serialized bytes of the other keys. Add a test: preset traceparent/baggage in the query, and assert that `get()` returns the current span's value.
- Tags: cross-partition, runtime=both

#### F030

**A rejection from the HTTP responseHook is not recorded**

- Review ID: P06-otel-server-02
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/opentelemetry-server/src/telemetry/trace.ts:106-116, packages/opentelemetry-server/src/interceptor/http.ts:62-64, packages/opentelemetry-server/src/telemetry/trace.ts:87-88, packages/opentelemetry-server/README.md:219, doc/content/en-US/api/opentelemetry-server/opentelemetryservertransportoptions-type.mdx:21, doc/content/en-US/api/opentelemetry-server.mdx:79, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:36, doc/content/en-US/api/opentelemetry-server/opentelemetryserverhttpoptions-type.mdx:15
- Sources: P06-otel-server-codex-02, P06-otel-server-grok-03
- Summary: `runSpanHook` schedules recording of a rejection onto a microtask with `void Promise.resolve(result).catch(...)`, while the HTTP success path immediately calls `setSpanHttpResponse` synchronously and ends the span. An HTTP `responseHook` rejection therefore always arrives too late, and the real SDK does not keep that record.
- Failure scenario: Configure `http.responseHook: () => Promise.reject(new Error('rej'))`, or throw after an `await`, and the request returns 200 normally. The exported span has neither `defjs.otel.hook.error` nor an `exception` event. A synchronous throw has both events. The same kind of SSE rejection is recorded, because the SSE span does not end until `closed`.
- Evidence: The same probe, with the same result on Node and Bun:
  - `H2 {"name":"http responseHook Promise.reject","events":[]}`
  - `H2 {"name":"http responseHook sync throw","events":["defjs.otel.hook.error","exception"]}`
  - `H2 {"name":"http responseHook attr after await","events":[],"appBefore":true,"appAfter":null}`
  - `H2 {"name":"sse responseHook Promise.reject","events":["sse.connected","defjs.otel.hook.error","exception","sse.closed"]}`

  Documentation wording: README:219 says "may return `void` or `Promise<void>`; their throws/rejections are recorded without blocking the operation"; the transport options page at :21 and the API overview at :79 say "a throw or rejection is recorded the same way"; the integration guide at :36 says "A hook failure records `defjs.otel.hook.error`". Only the HTTP options page at :15 says "only its synchronous part can still change the span", so losing an attribute written after await is documented behavior and is out of scope for this item; but no document says a rejection is lost.

  Severity: codex reported P1, downgraded to P2. The business result is unaffected, and what is lost is diagnostic information from the application's own hook; the HTTP options page already limits what async customization can do.

- Fix direction: Pick one and make every document say the same thing. Either, without making the business result wait for the hook, record an HTTP hook rejection on a channel that does not depend on the span still recording; or state explicitly that the async part of an HTTP `responseHook` (including a rejection) is not recorded, and make README:219 consistent with the HTTP options page at :15. Add a test that returns `Promise.reject(...)`, using a tracer that drops writes after the span ends.
- Tags: cross-partition, runtime=both

#### F031

**The SSE tuple's third slot reads the live open and can be overwritten by a reconnect during trailing async work**

- Review ID: P03a-core-sse-09
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/sse/sse.ts:373-384; packages/core/src/sse/transport/event_stream.ts:161-171; packages/core/src/sse/transport/event_stream.ts:263; doc/content/en-US/docs/sse.mdx:34; doc/content/en-US/api/sse.mdx:58
- Sources: P03a-core-sse-codex-05
- Summary: `fetchEventStream` overwrites `latestOpen` on every handshake. `const open = stream.open` at `sse.ts:380` runs only after the whole interceptor chain has been `await`ed, and the code does not separately save the first successful handshake.
- Failure scenario: Some SSE interceptor still waits on a stretch of async work after `await next(req)` (for example flushing a log). During that time the first connection drops and reconnects successfully, and the `startupOpen` returned by `execute` is already the second response. A caller that depends on the first response's headers (for example a session ID) gets the wrong value.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0. Inside the interceptor, `x-attempt` is `1` when `next` returns; the tuple returned by `execute` is `startup-snapshot {"calls":2,"startupAttempt":"2","liveAttempt":"2"}`.
  - The docs at `sse.mdx:34` say "`startupOpen` is the initial snapshot. … Keep the tuple value when the first response matters."; `api/sse.mdx:58` says "The tuple's third slot is the startup snapshot of `open`".
  - The trigger is narrow: it needs an interceptor with async work at the tail of the chain, an early drop, and a fast reconnect all at once.
- Fix direction: Separately save the first successful handshake inside `fetchEventStream` (or capture it when `sseHandler` resolves), and have the `execute` tuple reference it; `stream.open` continues to follow the latest connection.
- Tags: cross-partition (the interceptor chain belongs to P04), runtime=both

#### F032

**maxDelayMs constrains only the base before jitter, so the actual wait can exceed the cap**

- Review ID: P03b-core-ws-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/backoff.ts:11-12; packages/core/src/client/config.ts:79; packages/core/src/client/config.ts:107; doc/content/en-US/api/core/withwebsocketreconnect.mdx:26; doc/content/en-US/docs/web-socket.mdx:58
- Sources: P03b-core-ws-grok-03
- Summary: `computeReconnectDelay` does `Math.min(..., maxDelayMs)` first and then multiplies by `(1 ± jitter)`. When jitter > 0 and the cap has already been reached, the wait is at most `(1 + jitter) × maxDelayMs`.
- Failure scenario: The default `maxDelayMs: 30000` plus `jitter: 0.2` makes the 7th and later retries wait up to about 36000 ms; with `maxDelayMs: 3000` and `jitter: 1` the maximum is about 6000 ms. A caller that relies on "a 30 s cap" for an SLA, a timeout, or a UI countdown waits longer. The default `jitter: 0` is unaffected.
- Evidence: `backoff.ts:11` `const exponential = Math.min(config.delayMs * config.factor ** Math.max(0, attempt - 1), config.maxDelayMs)`; `:12` `Math.round(exponential * (1 + (Math.random() * 2 - 1) * config.jitter))`; after that only `:17` clamps to `2_147_483_647`. `web_socket.ts:521` calls it directly. Review probe (`Math.random` fixed at 0.9999, Node/Bun agree): `PROBE JITTER node=26.11.1 cap=3000 jitter=1 attempt10=5999; cap=30000(default) jitter=0.2 attempt7=35999`. Docs: the JSDoc at `config.ts:79` (WebSocket) and `config.ts:107` (SSE) are both "Upper bound for computed backoff delay."; `withwebsocketreconnect.mdx:26` "The delay for retry _n_ is `delayMs * factor^(n-1)`, capped at `maxDelayMs`." `docs/sse.mdx:62` says "`maxDelayMs` caps the base", which is accurate for SSE and suggests "capping the base" may be intentional semantics, but the WebSocket page and the two JSDoc comments do not say it that way. `reconnect.spec.ts:140-148` asserts the cap only under `jitter: 0`, and the jitter cases at `:174-185` never reach the cap, so none of them lock the combined behavior.
- Fix direction: Pick one and make it uniform: clamp to `maxDelayMs` after jitter; or keep the current behavior, change the WebSocket API page and both `config.ts` JSDoc comments to "caps the base delay before jitter", and add a case that sets jitter and the cap together.
- Tags: cross-partition (`backoff.ts` belongs to P04; SSE shares it and belongs to P03a), runtime=both

#### F033

**The path-placeholder grammar is undocumented, and a static segment containing a colon cannot be expressed**

- Review ID: P04-core-infra-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/url.ts:36, packages/core/src/internal/builder_types.ts:42, doc/content/en-US/docs/http.mdx:22, doc/content/en-US/docs/commands.mdx:44, doc/content/en-US/api/core/definerequest.mdx:25
- Sources: P04-core-infra-codex-05, P04-core-infra-grok-05
- Summary: `fillUrl` recognizes placeholders with `/:([^/]+)/g`, and `PathParams` at the type layer uses the same rule. The docs only use `:id` as an example, never define this grammar, and never give a spelling for a literal colon, so any colon in a static segment fails at execution.
- Failure scenario:
  - `defineRequest({ method: 'POST', path: '/models/gemini-pro:generateContent' })` is the AIP-136 custom-method style. It declares no input, and because `HttpRequestShape.path` is optional it passes type checking; but at execution it returns `REQ_BUILD_FAILED: Missing path param: generateContent`, and the request is not sent.
  - Written as `'/models/:model:generateContent'`, the placeholder name becomes `model:generateContent`; filling a value under that key also replaces `:generateContent`.
  - The placeholder name of `'/files/:name.json'` is `name.json`.
  - `'/v1/time/12:30'` reports `Missing path param: 30`.
- Evidence:
  - `url.ts:36` is `return path.replace(/:([^/]+)/g, …)`; `builder_types.ts:42-46` also matches from the colon all the way to `/` or the end of the string.
  - On the docs: `http.mdx:22` only covers encoding rules, `commands.mdx:44` only says "Use `builder` for path placeholders", and `definerequest.mdx:25` does not define the grammar.
  - Reproduction: `bun|node misc.mjs`, both exit 0, output:
    ```text
    static colon {"path":"/models/gemini-pro:generateContent","code":"REQ_BUILD_FAILED","msg":"Missing path param: generateContent"}
    static colon {"path":"/v1/time/12:30","code":"REQ_BUILD_FAILED","msg":"Missing path param: 30"}
    placeholder+custom verb {"code":"REQ_BUILD_FAILED","msg":"Missing path param: model:generateContent"}
    suffix placeholder {"code":"REQ_BUILD_FAILED","msg":"Missing path param: name.json"}
    dispatched urls []
    ```
  - Graded P2: the failure is reported clearly as `REQ_BUILD_FAILED`. There is also a workaround: pass `gemini-pro:generateContent` as the whole placeholder value, and the colon is encoded as `%3A`, but whether the server accepts that depends on the server implementation.
- Fix direction: Write the placeholder grammar and the spelling of a literal colon in `http.mdx`/`commands.mdx`. If custom methods are to be supported, tighten placeholder names to identifier characters and keep `PathParams` in sync.
- Tags: runtime=both

#### F034

**The GraphQL recipe rejects data: null, and an application error is misreported**

- Review ID: P09a-doc-guides-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/examples/recipes/graphql-http-envelope.ts:13-17; doc/examples/recipes/graphql-http-envelope.ts:24-26; doc/content/en-US/recipes/graphql-http-envelope.mdx:8; doc/content/en-US/recipes/graphql-http-envelope.mdx:20
- Sources: P09a-doc-guides-codex-01
- Summary: The recipe declares `data` as `struct.object({...}).optional()`, which does not accept `null`. When a GraphQL execution error returns `data: null` plus `errors[]`, `client.execute` fails first with `RES_STRUCT_MISMATCH`, and the recipe's `errors[]` unwrap branch is never reached.
- Failure scenario: A reader copies the recipe to query a schema whose root field is non-null (for example `user(id): User!`). The server returns HTTP 200 and `{"data":null,"errors":[{"message":"viewer unavailable"}]}`. `loadViewer` throws `RES_STRUCT_MISMATCH`, message `Expected object at data, received null`, rather than the application error `viewer unavailable`. That application error is misjudged as a server contract break.
- Evidence:
  - The recipe body at `graphql-http-envelope.mdx:20` says: "Application errors stay in `errors[]` until your unwrap throws or returns."; `:8` says: "unwrap `errors[]` / missing `data` in your own helper".
  - In the example at `:13-17`, `data: struct.object({ viewer: ….null() }).optional()`, and `if (error) throw error` at `:24` sits before `:25` reads `result.errors`.
  - GraphQL spec October 2021 section 7.1.2 (fetched with firecrawl from spec.graphql.org/October2021) says: "If an error was raised during the execution that prevented a valid response, the `data` entry in the response should be `null`."
  - Reproduction: `/tmp/zen-audit/verified/P09a-doc-guides/scratch/probe.mjs` copies the definition and `loadViewer` from example `:6-30` unchanged. `bun probe.mjs` and `node probe.mjs` both exit 0 with the same output:
    `GRAPHQL {"body":{"errors":[{"message":"viewer unavailable"}]},"code":null,"message":"viewer unavailable"}`
    `GRAPHQL {"body":{"data":null,"errors":[{"message":"viewer unavailable"}]},"code":"RES_STRUCT_MISMATCH","message":"Expected object at data, received null"}`
  - The core behavior itself is correct (`http.ts:452-453` classifies a StructError as `RES_STRUCT_MISMATCH`). The problem is the recipe's envelope.
  - Severity note: the recipe's own fixture covers only the "no data" branch, and its own output `ada viewer unavailable` is correct; `viewer` is nullable in the example schema, so that schema rarely produces `data:null`. But this envelope is meant as a pattern for readers to apply, and applying it to a non-null root field makes it fail. Narrow but real, so P2.
- Fix direction: Change the envelope's `data` to `.nullish()`, and keep the errors-first unwrap order; add a `data:null` + `errors` response to the fixture.
- Tags: runtime=both

#### F035

**Flattening a nested intersection drops the inner nullable**

- Review ID: P01-core-struct-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:446-447; packages/core/src/struct/constructors.ts:435-437; packages/core/src/struct/parse.ts:439-444; packages/core/src/struct/types.ts:216; packages/core/src/struct/types.ts:350
- Sources: P01-core-struct-codex-02
- Summary: If a member of an outer intersection is itself an object-side intersection, `flattenObjectIntersectionSides` runs `options.push(...definition.options)`, splitting it into the original members, and the `flags.nullable` set by the inner `.null()` is dropped.
- Failure scenario: Let `inner = struct.intersection(objA, objB).null()` and `outer = struct.intersection(inner, objC.null())`.
  - In the types, both `StructInput<typeof outer>` and `Infer<typeof outer>` include null.
  - At runtime, `struct.parse(inner, null)` succeeds, but `struct.parse(outer, null)` returns `invalid_type`.
  - Control: `struct.intersection(objA.null(), objC.null())` parses null successfully.
- Evidence:
  - **Reproduction output (the same on both runtimes):** `@@ B {"inner":[null,null],"outer":[{"code":"invalid_type","expected":"object","message":"Expected object at <root>, received null","path":[],"received":null}],"flatBothNullable":[null,null]}`.
  - **Type probe:** asserting with `Check<Equal<null extends StructInput<typeof outer> ? true : false, true>>`, `CLAUDECODE= bun check --no-pretty --project .audit-tmp/tsconfig.json` exits 0, and `node_modules/.bin/tsc --noEmit` exits 0.
  - **The assertion is effective:** the reversed control assertion reports TS2344 as expected (bun check exits 1).
  - **Cause:** null input takes `parse.ts:439-444`, which calls `parseNode` on each member, and those members are already the original objects without nullable.
  - **Downgrade rationale (P1 to P2):** it triggers only when "a nested intersection carries a modifier" and "every outer member is nullable" both hold; and the result is rejecting legal input with an explicit issue, not quietly letting bad data through.
- Fix direction: Flatten only an inner intersection that has no modifier; keep an inner one that is nullable or optional as one whole member. Add a regression test for a nested nullable intersection.
- Tags: runtime=both

#### F036

**The public type of a single-member intersection loses optional**

- Review ID: P01-core-struct-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:417-418; packages/core/src/struct/types.ts:216; packages/core/src/struct/types.ts:225; packages/core/src/struct/types.ts:345-348
- Sources: P01-core-struct-codex-03
- Summary: At runtime a single member is returned unchanged, as the docs say (`struct-intersection.mdx:17` says "A single struct is returned unchanged"). The return type is nevertheless `IntersectionStruct<[x]>`, which does `Exclude<…, undefined>` on input/output and inherits the default `optionalOut = false`.
- Failure scenario: Let `s = struct.intersection(struct.string().optional())`. Then `Infer<typeof s>` is `string`.
  - At the top level: `struct.parse(s, undefined)` returns `[null, undefined]`. `if (!e) v.toUpperCase()` compiles, but throws TypeError at runtime.
  - As a field: after it is placed in `struct.object({ v: s })`, the type requires it, but at runtime `{}` succeeds and the field is omitted.
  - Replacing the member with `.nullish()` is the same.
- Evidence:
  - **Reproduction output (the same on both runtimes):** `@@ C {"same":true,"top":[null,"<undef>"],"field":[null,{}]}`.
  - **Type probe:** `Check<Equal<Infer<typeof single>, string>>` and `Check<Equal<Infer<typeof wrapped>, { v: string }>>` both pass (bun check and tsc both exit 0); the reversed control reports TS2344.
  - **Downgrade rationale (P1 to P2):** a single-member call is more often a generic expansion such as `intersection(...parts)`, and is less common.
- Fix direction: Add an overload for the single-member call that returns the member's own type (consistent with the runtime "returned unchanged"); or have `IntersectionStruct` keep input/output/optionalOut when there is a single member.
- Tags: runtime=both

#### F037

**An errorMap that returns an empty string does not replace the default message**

- Review ID: P01-core-struct-06
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/errors.ts:129-131
- Sources: P01-core-struct-codex-05, P01-core-struct-grok-04
- Summary: The condition is `if (override)`, so a legal `''` is treated as "keep the default message", which does not match the contract "a returned string replaces, and only undefined keeps it".
- Failure scenario: A caller wants to use errorMap to strip the original value from the default message (see 02), and runs `struct.parse(struct.number(), 'secret-value', { errorMap: () => '' })`. The message is still `Expected number at <root>, received "secret-value"`.
- Evidence:
  - **Reproduction output (the same on both runtimes):** `@@ E {"message":"Expected number at <root>, received \"secret-value\""}`.
  - **Contract text:** `errors.ts:7` says "Return a string to replace the default message, or `undefined` to keep it."; `api/core/errormap-type.mdx:12` uses the same wording; `api/core/struct-parse.mdx:19` says "Returning `undefined` keeps the default message."
  - **Test gap:** `errors.spec.ts:160` covers only `() => undefined`.
- Fix direction: Change it to `override !== undefined`, and add an empty-string regression test.
- Tags: runtime=both

#### F038

**A bigint/date conversion failure from another package copy bypasses this call's errorMap**

- Review ID: P01-core-struct-07
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:378; packages/core/src/struct/constructors.ts:394; packages/core/src/struct/errors.ts:104; packages/core/src/struct/errors.ts:128; packages/core/src/struct/parse.ts:172-174
- Sources: P01-core-struct-codex-06
- Summary: A cross-copy decode hook already reports failure through the `fail` passed in by the parsing side, but the issue is still created by `issue()` in the copy where the hook lives. `issue()` reads that copy's module `activeErrorMap`, which is undefined, so the errorMap set by the parsing side is never called.
- Failure scenario: The application has two copies of `@defjs/core`. The project explicitly supports this: there is a dedicated case starting at `parse.protocol.spec.ts:771`. Using copy A's `struct.parse` to parse a `struct.bigint()` or `struct.date()` constructed by copy B, `errorMap: () => 'redacted'` is never called when conversion fails, and the message keeps the default text, which contains the original value. Control: when copy B's `struct.string()` has a type mismatch, errorMap takes effect normally.
- Evidence:
  - **Reproduction method:** `cp -R packages/core/src` makes a second copy `scratch/copyB-src`.
  - **Reproduction output (the same on both runtimes; the first number is the errorMap call count):** `@@ F {"distinctCopies":true,"foreignBigint":[0,"Expected bigint at <root>, received \"nope\"",true],"foreignDate":[0,"Expected Date at <root>, received \"nope\""],"foreignString":[1,"redacted"],"localBigint":[1,"redacted"]}`.
  - **Cause:** `constructors.ts:378` is `return fail(issue(path, 'invalid_type', 'bigint', input))`, and this `issue` comes from the copy where the hook lives; `errors.ts:128` checks only this module's `activeErrorMap`.
  - **Test gap:** the test name at `parse.protocol.spec.ts:779` says "decode hooks accept and reject exactly like the hooks of this copy", but it does not cover errorMap.
  - **Why this is P2:** it appears only in a multi-copy combination, and it affects only bigint/date conversion failures.
- Fix direction: Have the hook return only the failure reason, and let the parsing copy create the issue and run the map; or have the parsing side's `fail` run errorMap as a follow-up. One regression on the existing cross-copy case is enough.
- Tags: runtime=both

#### F039

**When two @defjs/core instances coexist, caller cancellation is recorded as WARN**

- Review ID: P06-otel-server-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/opentelemetry-server/src/telemetry/logs.ts:30, packages/core/src/error/cause.ts:2, packages/opentelemetry-server/README.md:95
- Sources: P06-otel-server-codex-04 (grok did not file it in coverage, on the grounds that "there is no second Core install and it cannot be demonstrated"; after this reproduction it was adjudicated as holding)
- Summary: Cancellation suppression recognizes only `error === ERR_ABORTED`, that is, object identity. `ERR_ABORTED` is `new Error(...)` per module instance, so when the client is created by another Core instance, the plugin does not recognize this cancellation sentinel.
- Failure scenario: The application creates the client with one Core instance, and the plugin imports another, for example a server bundle that packs only one of the packages and leaves the other external. After the caller `AbortController.abort()`, the business result is the correct `NET_ABORTED`, but the plugin emits an `http.client.request.exception` WARN; it also happens when only a logger is configured. README:95 promises "caller cancellation produce no LogRecord".
- Evidence: `packages/core/dist` was built in the clone (`bun --bun run build`, exit 0). In the probe the application side uses `packages/core/dist/index.js` to create the client, and the plugin side uses `packages/core/src` through a vitest alias. Node and Bun output the same: `H4 {"which":"second-core","fault":"NET_ABORTED","logs":[["http.client.request.exception","Error"]]}`; the same-instance control: `{"which":"same-core","fault":"NET_ABORTED","logs":[]}`. Under a single instance, Core (`internal/abort.ts:51-55`) unifies every non-timeout cancellation reason into `ERR_ABORTED`, so a normal install is unaffected. The premise is narrow: a peer dependency exists precisely so the package manager keeps one instance, and this was not verified under any concrete bundler configuration. The consequence is one extra WARN of noise per cancellation, and the business result is correct. Lowest priority of the five; if the project explicitly does not support multiple instances, this item can be deleted.
- Fix direction: Change cancellation classification to a judgment that does not depend on object identity. For example, judge by whether the request's abort signal is already aborted and the reason is not a timeout, or use a cross-instance mark exported by Core (such as a `Symbol.for` brand). A TimeoutError must still be logged as usual.
- Tags: cross-partition, runtime=both

#### F040

**SSE strips a BOM per line and per field value, departing from the specification**

- Review ID: P03a-core-sse-08
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/sse/transport/parser.ts:181; packages/core/src/sse/transport/parser.ts:217; packages/core/src/sse/transport/parser.ts:259-264; packages/core/src/sse/transport/parser.spec.ts:314-320
- Sources: P03a-core-sse-codex-04
- Summary: Every field value calls the non-streaming `TextDecoder.decode` once on its own; the default `ignoreBOM: false` means every call strips a leading BOM. Also, `fieldName` skips a leading `EF BB BF` on every line. The specification allows stripping one BOM only at the start of the stream.
- Failure scenario:
  - `data: ﻿payload` becomes `payload` after delivery through `struct.string()`, which does not match the docs' "A `string` struct keeps that text".
  - A `﻿data: injected` that appears mid-stream produces an extra event. Per the specification, that line's field name is `﻿data` and should be ignored.
  - `id: ﻿1` likewise becomes `1`.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0 with identical output:
    - `bom {"name":"payload-bom","data":["payload"],"codepoints":[[112,97,121,108,111,97,100]]}`
    - `bom {"name":"midstream-field-bom","data":["first","injected"],…}`
    - The control for a BOM at the start of the stream gets `["ok"]`, which is correct.
  - WHATWG (fetched this time) gives `stream = [ bom ] *event`, and states "The UTF-8 decode algorithm strips one leading UTF-8 Byte Order Mark (BOM), if any."
  - The JSDoc at `parser.ts:259-261` says of itself "Decoding dropped one leading BOM, so one is skipped here too".
  - The case named "skip one leading BOM" at `parser.spec.ts:314-315` places the BOM after four lines, and what it actually locks is "a mid-stream BOM is accepted".
  - This item is lower priority among P2: it needs U+FEFF to appear exactly at the start of a line or the start of a value; and the server is already the trusted party, so it is not injection across a trust boundary.
- Fix direction: Skip a BOM only once, at the first byte of each physical stream; decode field values with `ignoreBOM: true` or streaming decode, and keep U+FEFF. Split the existing case into three contract scenarios: start of the stream, start of a value, and a field mid-stream.
- Tags: runtime=both

#### F041

**When the backoff base is 0, the 1025th retry throws RangeError**

- Review ID: P03a-core-sse-10
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/internal/backoff.ts:11-16; packages/core/src/sse/transport/event_stream.ts:463-470; packages/core/src/web_socket/web_socket.ts:521; packages/core/src/web_socket/reconnect.ts:20-35
- Sources: P03a-core-sse-codex-06
- Summary: `delayMs * factor ** (attempt - 1)` computes the exponent first. `factor ** 1024` overflows to `Infinity`, and multiplying by 0 yields `NaN`; `Math.min(NaN, maxDelayMs)` is still `NaN`, and it immediately throws `Reconnect delay must be finite`.
- Failure scenario: Every value of `withSSEReconnect({ attempts: 1026, delayMs: 0, factor: 2, maxDelayMs: 50 })` is legal and finite, and the expected delay is constantly 0. But after the 1025th failure, the stream ends as `NET_UNREACHABLE` (cause `RangeError`). The same happens when the server sends `retry: 0` and sets the base to 0. Because both the budget and the exponent accumulate over the whole stream (see P03a-core-sse-02), these 1025 times are the cumulative count over the whole stream's lifetime.
- Evidence:
  - Re-running the codex probe, both Bun and Node exit 0: `finite-zero-delay-overflow {"attempts":1026,"delayMs":0,"factor":2,"maxDelayMs":50,"calls":1025,"code":"NET_UNREACHABLE","cause":"Reconnect delay must be finite"}`. With `{ delayMs: 0, factor: 1e308, attempts: 4 }` it terminates at 3 calls.
  - WebSocket's `normalizeReconnectConfig` allows `delayMs: 0`, `attempts` can reach the safe-integer limit, and it calls the same function directly, so it is affected the same way.
  - In practice it triggers only after more than 1024 cumulative retries, so it is the lowest priority in this partition.
- Fix direction: Return 0 directly when the base is 0; when the exponent overflows, saturate to `maxDelayMs` (or the timer limit). Report an error only when the original input is itself illegal.
- Tags: cross-partition (`backoff.ts` belongs to P04; WebSocket shares it), runtime=both

#### F042

**Docs still claim the deleted packed-consumer and ES2022 baseline verification**

- Review ID: P11-ops-04 (merged: P09a-doc-guides-05)
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: docs/releases/0.4.0.md:66; packages/core/README.md:65; doc/content/en-US/docs/sse.mdx:99; package.json:49-50; tsconfig.base.json:3-4; packages/core/README.md:71-74; tsconfig.base.json:11; doc/content/ar/docs/sse.mdx:99; doc/content/de-DE/docs/sse.mdx:99; doc/content/es-ES/docs/sse.mdx:99; doc/content/fr-FR/docs/sse.mdx:99; doc/content/ja-JP/docs/sse.mdx:99; doc/content/ko-KR/docs/sse.mdx:99; doc/content/ru-RU/docs/sse.mdx:99; doc/content/zh-Hans/docs/sse.mdx:99; doc/content/zh-Hant-HK/docs/sse.mdx:99; doc/content/zh-Hant-TW/docs/sse.mdx:99
- Sources: P11-ops-codex-04
- Summary: The release notes, the core README published with the tarball, and the SSE docs all claim in the present tense that there is tarball-consumer verification or joint verification of the ES2022 lib baseline, but the repository no longer has any corresponding mechanism.
- Failure scenario: A reader or maintainer, relying on "Packed-consumer verification installs all four tarballs…" or "The gate is pinned to TypeScript 7", believes every release has verified that the declarations are usable under the ES2022 baseline. In fact there is no check; if the baseline regresses, nothing raises an alarm.
- Evidence:
  - Original text at `docs/releases/0.4.0.md:66`: "Packed-consumer verification installs all four tarballs outside the workspace, typechecks their public declarations, and runs a Bun 1.4 smoke test." That file was still modified at `c0024006` (2026-10-12), after the gate was deleted.
  - Original text at `packages/core/README.md:65`: "The gate is pinned to TypeScript 7 … This supported set is verified together".
  - Original text at `sse.mdx:99`: "These four entries are verified together as one baseline".
  - Comparison: `git ls-files scripts` is empty; `git grep -E "npm pack|bun pm pack|verify-packed"` hits only the npm badge in the README; no tracked json/ts config contains `ES2022`/`ESNext.Disposable`; `tsconfig.base.json` is `ESNext` and `skipLibCheck: true`.
  - The claimed contract itself currently holds: I built a consumer from the four dists built in order (`scratch/consumer-all`, ES2022 + `ESNext.Disposable` + DOM + DOM.Iterable, `types: []`, `skipLibCheck: false`, including `await using`). tsc exits 0, and the Bun and Node smokes both exit 0 (`smoke ok 40,1,2,3`). So the docs are wrong, not the artifacts.
- Fix direction: Change these three places to describe the facts (the baseline is not continuously verified today); if the gate is to be restored, wire the consumer check into a script and CI.
- Tags: cross-partition (the text belongs to P12)

<details><summary>Review record of merged item P09a-doc-guides-05</summary>

##### P09a-doc-guides-05 The SSE guide calls the minimum lib set "repository-validated", the verification gate has been deleted, and no configuration in the repository uses that lib set

- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:99; packages/core/README.md:65; tsconfig.base.json:3; tsconfig.base.json:11
- Sources: P09a-doc-guides-grok-06 (codex rejected "types are unavailable" in H1, but did not reject the process statement; the dispute is in notes)
- Summary: The original text says "The repository-validated and supported minimum lib contract is `ES2022`, `ESNext.Disposable`, `DOM`, and `DOM.Iterable` … These four entries are verified together as one baseline". The repository no longer verifies this lib set; today this lib set still passes against core's public declarations.
- Failure scenario: If `@defjs/core`'s `.d.ts` later uses a type outside ES2022 + ESNext.Disposable, repository CI will not fail, and the docs will still claim that the baseline is verified by the repository. A reader who chooses a lib configuration from that will fail to compile on the consumer side only after an upgrade.
- Evidence:
  - The gate has been deleted: `git log --oneline --diff-filter=D -- scripts/verify-packed-consumer.ts` outputs `77a75294`; the `scripts/` directory does not exist in the worktree.
  - No configuration in the repository uses this lib set: `git ls-files | grep tsconfig | xargs grep '"lib"'` hits only `["ESNext","DOM","DOM.Iterable"]` at `tsconfig.base.json:3`, and `:11` is `skipLibCheck: true`. No tracked file uses `ESNext.Disposable` except the docs and historical plans.
  - The declarations themselves still hold today: after rebuilding `packages/core/dist/index.d.ts` this time, with `tsc` 7.0.2, `target ES2022`, the four libs above, and `skipLibCheck:false`, running `tsc -p /tmp/zen-audit/verified/P09a-doc-guides/scratch/minlib/tsconfig.json --noEmit` against a consumer that covers HTTP, SSE `await using`, and WS `await using` exits 0.
  - Negative control: removing `ESNext.Disposable` exits 1 (`TS2318 Cannot find global type 'AsyncDisposable'`, `TS2304`, `TS2550`), which proves that check really does verify this lib set.
  - Severity note: the auditor reported P2, downgraded to P3 here. Users are unaffected today, and what is wrong is only the process statement "verified by the repository".
- Fix direction: Either restore the consumer check for this lib set to CI, or delete the "repository-validated"/"verified together" wording and change it to "a support promise (not automatically verified today)"; change the same sentence in the README as well.
- Tags: cross-partition (`packages/core/README.md:65` belongs to P12; deleting the gate belongs to P11; the other locales belong to P10)

</details>

#### F043

**Every documentation-site link in the published Core and OTel READMEs is dead**

- Review ID: P12-project-docs-01
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/README.md:83-87; packages/opentelemetry-server/README.md:356-359; doc/app/routes.ts:2-11; doc/app/lib/routes.ts:10-15
- Sources: P12-project-docs-codex-05, P12-project-docs-codex-06, P12-project-docs-grok-02, P12-project-docs-grok-03
- Summary: The two READMEs published with the tarball (tsdown `copy: ['../../LICENSE', './README.md']`) still link to the pre-Fumadocs-migration `/guide/getting-started`, `/core/{client,http,sse,web-socket}`, and `/plugins/opentelemetry-server`. The current site has none of these routes and no redirect.
- Failure scenario: A reader of `@defjs/core` or `@defjs/opentelemetry-server` on npm clicks any link under Documentation. The path is not in the current route table, and the static site renders 404 for an unknown path; the domain itself also does not resolve today.
- Evidence:
  - Original README text: core:83-87 is `https://defjs.org/guide/getting-started`, `/core/client`, `/core/http`, `/core/sse`, `/core/web-socket`; OTel:356-359 is `https://defjs.org/plugins/opentelemetry-server`, `/core/client`, `/core/sse`, `/core/web-socket`.
  - Route table: `git ls-files 'doc/content/en-US/*' | sed …` has only `/docs/start`, `/docs/client`, `/docs/http`, `/docs/sse`, `/docs/web-socket`, `/docs/integrations/opentelemetry-server`, and other `/docs/*` pages. `doc/app/routes.ts` has only index, sitemap, search, llms, `404`, and `*` to `routes/page.tsx`; `doc/app/lib/routes.ts:10-15` generates URLs from content paths.
  - Redirects: `git grep -n -E 'getting-started|/core/client|plugins/opentelemetry|redirect' -- doc ':!doc/content'` has no relevant hit.
  - External (read-only): `curl https://defjs.org/...` exits 35 for all five URLs; Cloudflare DoH `name=defjs.org&type=A` and `type=NS` return `"Status":3`; Google DoH's A and the `www` CNAME are also `"Status":3`; firecrawl reports `DNS resolution failed for hostname "defjs.org"`. The GitHub API `repos/defjs/defjs` `homepage` is `https://defjs.org`.
  - The two conclusions are separate: the wrong path does not depend on the outside network and can be fixed inside the repository; the unresolvable domain is an external problem.
- Fix direction: Change them to `/docs/start`, `/docs/client`, `/docs/http`, `/docs/sse`, `/docs/web-socket`, `/docs/integrations/opentelemetry-server`. `SITE_URL` / the domain also need to be confirmed as actually usable, which is operations outside the repository.
- Tags: cross-partition (routes belong to P08; the domain and deployment belong to operations)

#### F044

**design.md's statement about the subprotocol token is the opposite of the implementation**

- Review ID: P03b-core-ws-06
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/design.md:237; packages/core/src/web_socket/web_socket.ts:417; packages/core/src/web_socket/web_socket.ts:572-592; doc/content/en-US/docs/web-socket.mdx:26
- Sources: P03b-core-ws-codex-05, P03b-core-ws-grok-04
- Summary: `design.md` says "putting a token into the subprotocol belongs to `beforeConnect` or the interceptor", but the subprotocol list is copied once before the session starts, and neither `beforeConnect` nor the interceptor can affect the protocols the constructor receives.
- Failure scenario: A reader follows `design.md` and refreshes the token inside `beforeConnect` while mutating the protocols source array, or adds the token inside a WebSocket interceptor; the handshake still uses the old list or a list without the token, and a server that authenticates by subprotocol rejects the connection.
- Evidence: The original text at `design.md:237` is "putting a token into the subprotocol belongs to `beforeConnect` or the interceptor, not to the builder."; the original text at `docs/web-socket.mdx:26` is "the builder, `beforeConnect`, and interceptors cannot change them, so a token-in-subprotocol is passed as the execute `protocols` option for that call." `web_socket.ts:417` does `const baseProtocols = [...(protocolsOption ?? clientConfig.webSocket.protocols ?? endpoint.protocols ?? [])]` before `run()` starts; `:574` calls `beforeConnect` only with `{ attempt, signal }` and does not read the return value; `:590` always returns `baseProtocols`. `web_socket.server.spec.ts:430-447` "should snapshot configured protocols before beforeConnect mutates their source" locks that the socket still uses `'snapshot-protocol'` (passed within the review baseline 305/305). `design.md` is not in the publish directory (`publishConfig.directory: "dist"`); graded by `_shared.md` section 4, "A stale design.md statement is a valid P2 docs finding".
- Fix direction: Change `design.md:237` to match `web-socket.mdx:26`: subprotocols come only from the execute `protocols`, `withWebSocketProtocols`, and the definition, and a short-lived token is obtained before execution and passed through that execute's `protocols`.
- Tags: cross-partition (design.md is not on this partition's list)

#### F045

**The CODE_OF_CONDUCT reporting channel is empty, so the enforcement process is unusable**

- Review ID: P12-project-docs-02
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: CODE_OF_CONDUCT.md:61-63
- Sources: P12-project-docs-codex-10, P12-project-docs-grok-05
- Summary: After "reported to the community leaders responsible for enforcement at" the next line is only `.`, and the whole document has no email, form, or private channel.
- Failure scenario: A contributor who is harassed and reports it according to the code of conduct cannot find anyone who will receive it. The following clauses on "protecting the reporter's privacy" and graduated response all presuppose that report, so none of them can be carried out.
- Evidence: `sed -n 58,68p CODE_OF_CONDUCT.md | cat -vet` shows lines 61-63 as `Instances of abusive, …may be$` / `reported to the community leaders responsible for enforcement at$` / `.$`. `grep -n '@\|mailto\|http' CODE_OF_CONDUCT.md` hits only the contributor-covenant and mozilla citations on lines 119-128. `git show be554c00:CODE_OF_CONDUCT.md` shows the first commit (2024-07-08) already had this empty placeholder. The repository has no SECURITY / CONTRIBUTING / SUPPORT file that could serve as an alternate channel.
- Fix direction: A maintainer fills in a private channel that actually works and meets the privacy promise. Do not guess or invent a contact.
- Tags: —

#### F046

**The abort-listener regression test only compares counts, and removing the wrong callback still stays green**

- Review ID: P05-core-tests-01
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/test/regression/abort-listeners.spec.ts:15-27; packages/core/src/internal/abort.spec.ts:31-41; packages/core/src/internal/abort.ts:246; packages/core/src/internal/abort.ts:104
- Sources: P05-core-tests-codex-01
- Summary: `watch().expectReleased()` and the merge case in `abort.spec.ts` only count calls, and do not check that the removed callback is the one that was added; after a listener-identity regression, the HTTP/SSE/WS cleanup contract has no test guarding it.
- Failure scenario: Someone changes `release()` of `mergeAbortSignals` to remove a different function, for example the common spelling of an inline new closure. After that, every successful request that carries the caller's signal leaves a listener on that long-lived signal; the listener also references the combined controller, forming a leak that grows with the request count. The JSDoc at `abort.ts:112-115` explicitly says this is to be prevented ("a caller's long-lived signal would otherwise hold every request that ever used it"). CI stays green.
- Evidence:
  - `abort-listeners.spec.ts:20-22` only does `expect(add...filter(type==='abort')).toHaveLength(remove...filter(type==='abort').length)`. The merge case at `abort.spec.ts:40` only has `expect(remove).toHaveBeenCalledOnce()`. The deadline case at `:111` in the same file checks identity with `toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])`.
  - Mutation m1: `abort.ts:246` changed to `source.removeEventListener('abort', () => undefined)`, and the full core-server is run with `scratch/probe.py`. Bun result `exit=0 total=1757 passed=1757 failed=0`, and Node is the same.
  - Mutation m1b: `abort.ts:104` (`awaitWithSignal`) gets the same change, and on Bun `exit=0 passed=1757`.
  - Control mutation m1c: `abort.ts:152` (deadline) gets the same change, and on Bun `exit=1`. What fails is `abort.spec.ts > should remove its release listener when the deadline is released`. Only the place with an identity assertion is locked.
  - Consequence probe `bun scratch/listener-repro.ts`: the original code outputs `{"activeAbortListenersAfterSuccess":0}` and `{"activeAfter1000":0}`; under the m1 mutation it outputs `1` and `{"activeAfter1000":1000}`.
  - Every mutation was restored with `git checkout`.
- Fix direction: Change `expectReleased()` and the merge case in `abort.spec.ts` to check `(type, listener)` in pairs (the same style as the deadline case at `:111`); or keep the set of active listeners on a controlled signal and assert that it is empty at the end.
- Tags: cross-partition, runtime=both

#### F047

**Two removals in WebSocket attempt cleanup are locked by no test**

- Review ID: P03b-core-ws-03
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/src/web_socket/web_socket.ts:640; packages/core/src/web_socket/web_socket.ts:654; packages/core/src/web_socket/web_socket.server.spec.ts:1115-1147; packages/core/src/web_socket/web_socket.lifecycle.spec.ts:22-33
- Sources: P03b-core-ws-codex-04, P03b-core-ws-grok-05
- Summary: After deleting `clearTimeout(errorCloseTimer)` or `signal.removeEventListener('abort', handleAbort)`, all 1757 core-server tests still pass on both Node and Bun, and a regression at either place produces observable wrong behavior.
- Failure scenario: (a) The `:640` regression is lost: the physical socket `error`s first and then `close`s within the grace period, and after the replacement connection opens successfully the old 1 s timer still calls `finish({ kind: 'error' })`, so a healthy session becomes `error` after about 1 s. (b) The `:654` regression is lost: each physical attempt's `handleAbort` closure (holding the old socket) stays on the session's internal merged signal until the session ends; after 3 reconnects, 4 survive. The existing `web_socket.server.spec.ts:1115-1147` advances only 0 ms after the replacement connection opens and then closes manually; the source regex in `web_socket.lifecycle.spec.ts:22-33` covers only the message listener.
- Evidence: Reviewer mutations, restored with `git checkout` after each one, `git status --short` empty. After deleting `:640` or `:654`, the full core-server project is run (`bunx vitest run --config vitest.config.ts --project core-server --coverage.enabled=false`, Bun uses `bun --bun vitest`, no path filter): `:640 node PROBE_EXIT=0 Tests 1757 passed`; `:640 bun PROBE_EXIT=0 Tests 1757 passed`; `:654 node PROBE_EXIT=0 Tests 1757 passed`; `:654 bun PROBE_EXIT=0 Tests 1757 passed`. Running the review probe's two behavior assertions under the same mutation: `:640` node/bun `PROBE OLDGRACE ... sockets=2 generation=2 stateAfter1100ms=error` (the assertion of 'open' fails, exit 1); `:654` node/bun `PROBE ABORTLISTENERS ... sockets=4 state=open liveHandleAbort=4` (the assertion of 1 fails, exit 1); on HEAD the two are `open` and `1`. The browser spec was read: `should reconnect in real browsers` is triggered by a server close, does not go through an error event, and does not cross the 1 s grace period, so it also cannot discover (a). In the same scan, mutations at `:647`, `:650`, `:652`, and `:653` were caught by existing tests; single-line deletions at `:645`, `:646`, `:648`, `:649`, and `:838` also survive, but each has a redundant equivalent cleanup path (for example `:645` and `:838` back each other up), and they are not reported on that basis.
- Fix direction: In the existing error-to-close-to-replacement case, advance past `SOCKET_CLOSE_GRACE_MS` and assert the session is still open; also add a case that spans multiple reconnects and, with a fake signal or a listener count, asserts that `handleAbort` has been removed after each attempt.
- Tags: runtime=both

#### F048

**SSE backoff-parameter tests only assert counts, and removing the wiring still stays green**

- Review ID: P03a-core-sse-07
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/src/sse/transport/event_stream.advanced.spec.ts:1355-1373; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1393-1438; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1440-1457; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1459-1476; packages/core/src/sse/transport/event_stream.ts:464-470
- Sources: P03a-core-sse-codex-08, P03a-core-sse-grok-04
- Summary: The three cases `should use exponential backoff with factor`, `should cap delay with maxDelayMs`, and `should apply jitter to retry delay` only assert `fetchCount`. The first-retry exponent of `should clamp the final retry delay after applying a factor…` is 0 (`factor ** 0 === 1`), and the clamp value it asserts can be produced by the parser's `Math.min(…, 2_147_483_647)` alone, so it does not test factor either.
- Failure scenario: Some regression drops the SSE wiring of `factor`, `maxDelayMs`, and `jitter` entirely. Backoff degenerates to a constant delay, with no cap and no jitter, and CI stays fully green.
- Evidence:
  - Reviewer mutation probes, run on Node 26.11.1 and Bun 1.4.3. After each one, `git checkout -- packages/core/src/sse/transport/event_stream.ts` was run, and `git status --short` was empty.
  - M1: change `:470` to `computeReconnectDelay({ delayMs: 0, factor: 1, jitter: 0, maxDelayMs: 0 }, retryCount)`, and run only these four cases. Both Node and Bun are `1 failed | 3 passed | 112 skipped`: only the clamp case that asserts the timer value fails, and the three cases named after backoff parameters all pass.
  - M2: change only to `const factor = 1`, run the same four cases, result `4 passed | 112 skipped`, exit 0.
  - M3: `factor` fixed at 1, `maxDelayMs` fixed at `+Infinity`, and `jitter: 0` passed in, running the full core-server project. Node is `Test Files 90 passed (90)`, `Tests 1757 passed (1757)`, exit 0; Bun is also 1757 passed, exit 0.
  - Grepping `factor|jitter|maxDelayMs` in `sse.spec.ts`, `sse.fault.spec.ts`, and `sse.browser.spec.ts` finds nothing. `computeReconnectDelay` has a unit test only in `web_socket/reconnect.spec.ts`, and the SSE parameter wiring has no protection.
  - The test comment at `:1355` itself admits "we verify attempts work".
- Fix direction: Use fake timers to assert the scheduled delay of each retry: with factor 2 the second is longer than the first; with `maxDelayMs: 5` it is exactly 5; after fixing `Math.random`, verify that jitter really takes effect. Change the clamp case to the retry whose exponent is >= 1. Keep the existing count assertion as the budget check.
- Tags: runtime=both

#### F049

**The test that responseHook runs before the span ends cannot detect an inverted order**

- Review ID: P06-otel-server-04
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/opentelemetry-server/src/interceptor/http.spec.ts:409-425, packages/opentelemetry-server/src/test-utils.ts:130-154, packages/opentelemetry-server/src/interceptor/http.ts:63-64
- Sources: P06-otel-server-codex-05 (grok-03's Evidence also did the same mutation)
- Summary: The test's hook is an empty `vi.fn()`, and it only asserts that it was called and that `ended === true` after the interceptor returns. The mock span still accepts `setAttribute`/`addEvent` after `end()`, so the order the test name claims to lock is not actually locked.
- Failure scenario: Someone swaps the two lines at `http.ts:63-64`, so `setSpanHttpResponse` (which ends the span) runs before `responseHook`. The real SDK drops attributes written by a synchronous hook, but the whole OTel suite still passes in CI.
- Evidence: Mutation probe: python swaps `http.ts:63-64`, and the whole suite is run with `bunx vitest run --config vitest.config.ts --coverage.enabled=false`. Node exits 0, `Test Files 11 passed`, `Tests 288 passed` (log `scratch/mutation-swap-node.log`). Then `git checkout -- packages/opentelemetry-server/src/interceptor/http.ts` (exit 0), and `cmp` matches the backup. The real SDK does drop writes after the span ends; see `appAfter:null` in the P06-otel-server-02 probe.
- Fix direction: Inside the test's hook, assert `span.isRecording() === true`, or make the mock span reject writes after `end()` and assert that the attribute written by the hook exists. Rerun the same order mutation and confirm it makes the test fail.
- Tags: runtime=node

#### F050

**checkLinks treats a directory without index.html as a valid link target**

- Review ID: P08-doc-site-02
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/scripts/check-links.ts:41-44; doc/scripts/check-links.ts:46; doc/scripts/build.ts:13; doc/test/check-links.test.ts:6
- Sources: P08-doc-site-codex-03 (grok said in coverage "not observed in this artifact"; adjudicated)
- Summary: When the target path does not correspond to any resolved HTML page, the checker only does `existsSync(path)`. A directory satisfies existsSync, so it is let through, and the anchor check on line 46 is skipped as well.
- Failure scenario: An author writes a very natural link in MDX, for example `[Core API](/api/core)` or `/zh-Hans/docs/integrations`. These directories exist because they have child pages, but they themselves have no index.html. The build gate outputs "Documentation links verified"; after going live, both GitHub Pages (which does not serve directory listings) and `preview.ts` return 404. An anchor such as `/api/core#anything` is not checked either.
- Evidence:
  - Code: `check-links.ts:41` is `const target = [path, resolve(path, 'index.html')].find((candidate) => pages.has(candidate))`; lines 43-44 are `if (!existsSync(path)) failures.add(...)` followed by `continue`.
  - Fixture reproduction: `bun scratch/check-links-dir-probe.ts` exits 0. The fixture is `api/core/createclient/index.html` plus a page linking `/api/core` and `/api/core#anything`. Output `Documentation links verified across 2 generated pages` / `checker accepted /api/core and /api/core#anything (directory without index.html)`. The control `/api/nothing` is correctly rejected.
  - Real artifact: `bun scratch/dir-links-probe.ts` exits 0, scanning 2257 pages and 388876 same-origin links. No link currently points at such a directory, but the artifact has 231 directories without index.html, including `/api/core` and `/docs/integrations` under 11 languages, and `/api/search`.
  - `preview.ts`: under local Bun 1.4.3, `Bun.file(<dir>).exists()` is false (measured), so a directory request falls through to 404.
  - GitHub Pages not returning directory listings is well-known behavior and was not verified online this time.
  - The existing `check-links.test.ts` has no negative case of "directory exists, entry is missing". HEAD has no actual dead link, so this is P2.
- Fix direction: A non-page target must be a regular file (`statSync().isFile()`); a directory counts only when an `index.html` page exists. Add a negative case that "keeps the directory and removes the entry", covering both page links and anchor links.
- Tags: runtime=bun

#### F051

**After the search index fails to load the first time, it is cached forever and search fails silently**

- Review ID: P08-doc-site-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/app/components/search.tsx:16; doc/node_modules/fumadocs-core/dist/search/client/orama-static.js:40-47 (fumadocs-core@16.17.1); doc/node_modules/fumadocs-core/dist/use-search-Dy8lBrbN.js:29-35; doc/node_modules/fumadocs-ui/dist/components/dialog/search.js:229,272
- Sources: P08-doc-site-codex-01
- Summary: The site's `useStaticSearch({ locale, from: \`/api/search/${locale}.json\` })` depends on a module-level promise cache keyed by URL. After a load failure the cache entry is not deleted, and every later search in that language gets the same rejected promise.
- Failure scenario: The first time a reader opens search, `/api/search/en-US.json` (1.75 MB) returns 503, or the mobile network drops, or JSON parsing fails. After the network recovers, the reader keeps typing, closes and reopens the dialog, or changes pages through client routing, and the index is never requested again. The dialog shows no results, and it also does not show "No results found" or any error: `error` is not rendered, and the list is hidden when `items` is null. Only a full page refresh or switching language (which changes the cache key) recovers it.
- Evidence:
  - `orama-static.js:40-47` is `const cached = cache$1.get(cacheKey); if (cached) return cached; const result = loadDB(from, ...); cache$1.set(cacheKey, result); return result;`. No reject branch deletes the key. Lines 9-10 throw on a non-2xx.
  - `use-search-Dy8lBrbN.js:29-35` writes the error into `state.error`. `dialog/search.js:229` is `const items = itemsProp === void 0 ? data?.items ?? defaultItems : itemsProp`, and defaultItems is null; line 272 adds `hidden` when `!items`. The dialog source renders no `error`.
  - Reproduction: `bun scratch/search-failure-probe.mjs` and `node scratch/search-failure-probe.mjs` both exit 0. The probe runs on the en-US index built this time, calls the installed dependency's `staticClient` directly, and replaces only the boundary `fetch`: the first call returns 503, and later calls return the real index. Both runtimes output the same: `{"searchesIncludingRemount":4,"requestsBeforeFreshKey":1,"errors":4,"sameRejectedPromise":true,"freshCacheKeyResults":60}`.
  - The probe is adapted from codex's script of the same name. It was read, and only the path was changed.
  - The trigger requires the first index request to fail, which is a narrow boundary, so this is P2.
- Fix direction: Prefer an upstream fix, `cache.delete(from)` on reject. Alternatively wrap a loader in `search.tsx` that can retry after failure. Add a regression check: fail the first time, then succeed the second time on the same URL after recovery.
- Tags: runtime=both, upstream=fumadocs-core@16.17.1, needs-browser (UI presentation only; the cache semantics were reproduced at the engine layer)

#### F052

**API index filtering misses matches on uppercase I under the tr/az default locale**

- Review ID: P08-doc-site-03
- Verdict: PLAUSIBLE
- Severity: P2
- Category: correctness
- Location: doc/app/data/api-catalog.ts:11; doc/app/data/api-catalog.ts:14; doc/app/components/api-index.tsx:16; doc/test/api-catalog.test.ts:10
- Sources: P08-doc-site-grok-02
- Summary: Both the query and the entry name are lowercased by the host default locale. In an engine that implements ECMA-402, when the default locale is tr/az, U+0049 folds to U+0131, so a query whose case does not match fails to match.
- Failure scenario: Firefox or Safari's UI locale is tr-TR, and the user types `interceptor` in the API index. Entries such as `withInterceptors` and `createHttpInterceptor` fold to forms such as `withınterceptors` and disappear. Typing `CREATECLIENT` folds the query to `createclıent`, which does not match `createClient`. Of 168 catalog entries, 27 names contain an uppercase I (`withInterceptors`, `Infer`, `StructInput`, `StructIssue`, `ERR_TIMEOUT`, `createHttpInterceptor`, and so on).
- Evidence:
  - `api-catalog.ts:11` is `query.trim().toLocaleLowerCase()`, and line 14 is `entry.name.toLocaleLowerCase().includes(normalized)`.
  - Node 26 / V8 under `LC_ALL=tr_TR.UTF-8` yields `["ı","I","İ","tr-TR"]`, corresponding to `'I'.toLocaleLowerCase([])`, `'i'.toLocaleUpperCase()`, `'i'.toLocaleUpperCase([])`, and the default locale. That is, the path that follows the specification and uses the default locale folds to ı. But a no-argument `'I'.toLocaleLowerCase()` in the same process returns `"i"`. V8 has a fast path for undefined, so Chromium is unaffected.
  - ECMA-402 TransformCase uses DefaultLocale() when locales are not given. SpiderMonkey and JSC implement it that way. This is an inference and was not measured.
  - Local Bun (JSC) has a fixed default locale of en-US and cannot be switched. `bun scratch/tr-fold.ts` hits everything under en-US. grok's reproduction monkey-patches `toLocaleLowerCase` to force 'tr', which only proves the folding rule itself.
  - The existing unit test's query is `CREATE`, which contains no I; e2e `site.test.ts:82` does use `CREATECLIENT`, but it runs in the en locale. Neither catches this problem.
- Fix direction: Switch to locale-independent `toLowerCase()`, or pass `'en-US'` explicitly. Add a case whose query contains `I` and whose entry contains a lowercase `i`, for example a control in the test that calls `toLocaleLowerCase('tr')` directly.
- Tags: needs-browser (how to confirm: open `/api` in Firefox or Safari with a tr-TR UI locale, type `interceptor`, and expect `withInterceptors` to disappear)

### P3

#### F053

**Several docs treat every declared body as a JSON check and parse**

- Review ID: P09b-doc-api-04 (merged: P09a-doc-guides-03)
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/opentelemetry-server.mdx:99; packages/core/src/http/transport/fetch.ts:273; packages/core/src/internal/inbound_representation.ts:16; packages/opentelemetry-server/src/interceptor/http.ts:72; doc/content/en-US/docs/integrations/opentelemetry-server.mdx:164; packages/opentelemetry-server/README.md:95; doc/content/en-US/docs/errors.mdx:90-92; doc/content/en-US/docs/design-decisions.mdx:104-106; doc/content/en-US/docs/integrations/opentelemetry-server.mdx:71; packages/opentelemetry-server/README.md:273
- Sources: P09b-doc-api-codex-05
- Summary: The page says a declared `output` / `error` body records one WARN whenever the media type is not JSON, regardless of status code. In fact the media-type check runs only when the declaration selected a JSON representation; a `struct.string()`, blob/file, or arrayBuffer declaration reads a non-JSON body normally and does not log.
- Failure scenario: Declare `output: struct.string()` and the server returns 200 `text/plain`; or declare `error: struct.string()` and the server returns 404 `text/plain`. The page says there should be a WARN, but the LogRecord count is 0. If operations configures an alert or debugs from this text, the expectation is wrong.
- Evidence: The page's original text is "as does a declared `output` / `error` body whose media type is not JSON, whose read fails, or whose JSON does not parse, whatever the HTTP status". `inbound_representation.ts:16` returns `'text'` for `string`; `fetch.ts:273` throws `BodyFailure` only when `response.body && responseType === 'json' && !isJsonMediaType(contentType)`; the OTel interceptor calls `emitClientException` at `http.ts:72` only when `next` rejects. Review probe `/tmp/zen-audit/verified/P09b-doc-api/scratch/otel-nonjson.mjs` uses the newly built core and otel dist. Both Bun and Node exit 0 with the same output:
  ```text
  text output; content-type=text/plain; fault=null; value=hello; logs=0
  text error; content-type=text/plain; fault=HTTP_STATUS; value=undefined; logs=0
  json output; content-type=text/plain; fault=RES_MEDIA_TYPE_INVALID; value=undefined; logs=1
  ```
  The JSON control proves the injected logger works. Severity rationale: downgraded from P2 to P3. The actual behavior is correct, and the extra log the docs promise corresponds to a legal successful read, so it does not hide a real fault.
- Fix direction: Limit the two conditions "media type is not JSON" and "JSON failed to parse" to declarations that selected a JSON representation, and keep "read failed" as the general condition; change the same sentence in the guide and the OTel README together.
- Tags: cross-partition (`docs/integrations/opentelemetry-server.mdx:164` belongs to P09a, `packages/opentelemetry-server/README.md:95` belongs to P12), runtime=both

<details><summary>Review record of merged item P09a-doc-guides-03</summary>

##### P09a-doc-guides-03 Errors / Design decisions say the built-in Fetch JSON-parses every declared body, but interceptors actually see raw text/Blob/bytes

- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:90-92; doc/content/en-US/docs/design-decisions.mdx:104-106; packages/core/src/http/transport/fetch.ts:273; doc/content/en-US/docs/http.mdx:118-123
- Sources: P09a-doc-guides-grok-02 (the non-OTel part; the OTel part was merged into P09b-doc-api-04, see rejected)
- Summary: Both places say "The built-in Fetch transport already reads and JSON-parses a declared body … so interceptors see that parsed `body`". In fact only a JSON representation does the media-type check and JSON parse; a `struct.string()`, blob/file, or arrayBuffer declaration hands the raw value to the interceptor.
- Failure scenario: An author of an interceptor that applies to the whole transport assumes, from these two pages, that `response.body` on the chain is always a parsed JSON value, for example unwrapping `response.body.data`. For a command with `output: struct.string()`, it gets the raw string (`<p>hi</p>` under `text/html`, and the quoted `"hi"` under `application/json`), and the related logic fails silently.
- Evidence:
  - Implementation: `fetch.ts:273` is `if (response.body && responseType === 'json' && !isJsonMediaType(contentType))`, so the media-type check applies only to a JSON representation.
  - The authoritative description at `http.mdx:118-123`: "interceptors receive a response whose `body` is already the parsed JSON, text, `Blob`, or bytes".
  - Reproduction (probe.mjs, Bun/Node agree, exit 0):
    `STRING_OUTPUT {"contentType":"text/html","fault":null,"data":"<p>hi</p>","chainSaw":{"type":"string","body":"<p>hi</p>"}}`
    `STRING_OUTPUT {"contentType":"application/json","fault":null,"data":"\"hi\"","chainSaw":{"type":"string","body":"\"hi\""}}`
  - Severity note: the auditor reported P2, downgraded to P3 here. The HTTP guide is already correct; the error appears only in two summaries. Consistent with the grading of P09b-doc-api-04.
- Fix direction: Change both passages to the same representation-kind wording as `http.mdx:118-123`: a JSON representation does the media-type check and parse, and text/blob/bytes are handed to the interceptor unchanged.
- Tags: related P09b-doc-api-04 (the same "a declared body equals JSON" misstatement, on the OTel side), runtime=both

</details>

#### F054

**OTel docs say an execute timeout always records one log, but a timeout outside the chain is not recorded**

- Review ID: P12-project-docs-03
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/opentelemetry-server/README.md:95; doc/content/en-US/api/opentelemetry-server.mdx:99; packages/core/src/http/http.ts:247-249; packages/core/src/http/http.ts:300-303; packages/core/src/http/http.ts:372; packages/core/src/http/http.ts:436-441; packages/opentelemetry-server/src/interceptor/http.ts:70-73
- Sources: P12-project-docs-codex-03
- Summary: Core's deadline covers parse, the builder, the whole interceptor chain, and declared-body conversion after the chain, while OTel records a log only when `next` rejects. So when the timeout falls outside the transport, the command returns `NET_TIMEOUT` and there is no LogRecord.
- Failure scenario: An application interceptor still has async work after `await next(req)` (for example an audit write), execute sets `timeout: 20`, and the server returns 204 immediately. The command gets `NET_TIMEOUT`, and OTel records 0 logs, whether the OTel interceptor is ordered before or after. A builder/parse timeout or a struct conversion timeout after the chain is the same. Operations that counts or alerts on timeout logs according to the README misses these timeouts.
- Evidence:
  - Original text at README:95: "An execute timeout is a transport rejection and logs once."; API:99 says "An HTTP execute timeout is a rejection and logs once".
  - Source: the comment at `http.ts:247` says "The deadline covers parse, the builder, the transport, and declared-body conversion"; `:300-303` can return before the interceptor; `:372` waits for the whole chain with `awaitWithSignal(() => chainPromise, requestSignal)`; `:436-441` checks the deadline again when converting after the chain ends. OTel `interceptor/http.ts:70-73` calls `emitClientException` only in `next`'s catch.
  - My probe `scratch/timeout-after-next.ts` (real timers; `bun --tsconfig-override REPO/tsconfig.json …`, and `node` after `bun build --target=node`). Both Bun 1.4.3 and Node 26.11.1 exit 0, and both output `{"order":"otel-first","fault":"NET_TIMEOUT","logs":0}` and `{"order":"app-first","fault":"NET_TIMEOUT","logs":0}`, with an extra 80ms wait before the judgment.
  - Control `scratch/timeout-control.ts`: a timeout inside the transport gets `{"fault":"NET_TIMEOUT","logs":1}`, the same on both runtimes, which shows the logger itself is fine.
  - Re-running codex's `integration-probes.ts` (path retargeted at this clone, using Date.now to simulate synchronous elapsed time): `post_interceptor_conversion_timeout … logs:0` and `pre_interceptor_builder_timeout … logs:0, handleCalls:0`, the same on both runtimes.
  - Severity: codex reported P2, downgraded to P3 here. The README's "Transport span boundary" section already says the span reflects only the transport and suggests wrapping an application span around `client.execute`; the business result is unaffected. Consistent with the grading of P09b-doc-api-04 (another over-promise in the same passage).
- Fix direction: Change it to "a timeout rejection observed in the interceptor chain / transport records one log", and state that timeouts in the builder/parse phase, in interceptor work after `next()`, and in conversion after the chain are not recorded and have to be observed by an outer command.
- Tags: cross-partition (the API page belongs to P09b), runtime=both

#### F055

**The Simplified Chinese and Hong Kong Traditional OTel pages translate "a declared body is missing" as "undeclared"**

- Review ID: P10a-i18n-cjk-01
- Verdict: CONFIRMED
- Severity: P3 (review graded P2, adjusted at final review)
- Category: i18n
- Location: doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:71; doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:169; doc/content/zh-Hant-HK/docs/integrations/opentelemetry-server.mdx:71; doc/content/zh-Hant-HK/docs/integrations/opentelemetry-server.mdx:169; compared with doc/content/en-US/docs/integrations/opentelemetry-server.mdx:71 and 169; runtime basis packages/core/src/http/http.ts:487-504, packages/opentelemetry-server/src/interceptor/http.ts:58-79
- Sources: P10a-i18n-cjk-codex-01, P10a-i18n-cjk-codex-02 (grok did not report it; a miss)
- Summary: en-US says the failure "a declared body is absent (for example 204)" happens after the interceptor and is not logged; both Simplified Chinese and Hong Kong Traditional translate it as "an undeclared body", reversing the "declared" qualifier, and contradicting the same paragraph's sentence "a body that is not declared is never read".
- Failure scenario: The reader declares a JSON `output` on a GET, and the server returns a 204 with no body. The command gets `RES_DECODE_FAILED`, the OTel interceptor returns normally, the span is not `BodyFailure`, and there are 0 logs. From the Simplified Chinese / Hong Kong Traditional wording, the reader thinks this exception applies only to "an undeclared body", then applies the table row "a declared body fails to read, one WARN" to the 204, and wrongly believes this fault can be seen in the OTel logs.
- Evidence:
  - en-US:71: "Only Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body (for example 204) and the `HTTP_STATUS` conversion happen afterwards…"; en-US:169: "A body that is not declared is never read and cannot log. Only Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body such as 204, and the `HTTP_STATUS` conversion happen after the interceptor and do not log."
  - zh-Hans:71, rendered: "Only Struct validation (`RES_STRUCT_MISMATCH`), the case of an undeclared body (for example 204), and the `HTTP_STATUS` conversion happen afterwards…". Back-translation: "an undeclared body (e.g. 204)". zh-Hans:169 first says "an undeclared body is never read and therefore produces no log", then immediately writes "only … the case of an undeclared body (for example 204) … happens after the interceptor".
  - zh-Hant-HK:71/169, rendered: "Only Struct validation (`RES_STRUCT_MISMATCH`), a body that was not declared (for example 204), and the `HTTP_STATUS` conversion…". Back-translation: "not-declared body (e.g. 204)". The previous sentence in the same paragraph is "a body that was not declared is never read", so a reader can only take them as the same concept.
  - Other locales translated it correctly: zh-Hant-TW is "a declared body is absent (for example 204)", ja-JP is "when the declared body is absent", and ko-KR is "absence of a declared body".
  - Code basis: `http.ts:421-432` finishes immediately on the undeclared side and does not read the body, so there cannot be a "body-absent failure that happens later"; `if (absent) { … throw new TypeError('Response body is absent') }` at `http.ts:499-503` happens after the interceptor returns and is turned into `RES_DECODE_FAILED` at `http.ts:456`; OTel `interceptor/http.ts:59-69` returns normally once it has the response, and only the catch branch at `:73` emits a log.
  - Reproduction: in this clone, first `cd packages/core && bun --bun run build` (exit 0) and `cd packages/opentelemetry-server && bun --bun run build` (exit 0); then retarget codex's `absent-body.mjs` at this clone, save it as `/tmp/zen-audit/verified/P10a-i18n-cjk/scratch/absent-body.mjs`, and run `bun absent-body.mjs` (exit 0) and `node absent-body.mjs` (exit 0). Each scenario has 2 assertions, 6 in total, all passing. Key output: `{"runtime":"Bun 1.4.3","case":"declared output, absent body (204)","fault":"RES_DECODE_FAILED","logs":0,"steps":["interceptor returned status=204, body=undefined"]}`, and Node 26.11.1 is the same; the control "declared + 200 malformed JSON" is `RES_DECODE_FAILED`, `logs:1`.
  - Graded P2 rather than P1: the error only affects how the observability docs describe one narrow exception, and it does not make a user write wrong code; but it does reverse a technical condition, which matches the brief's rule "changing the technical meaning, then P2".
- Fix direction: Change lines 71 and 169 of both locales to "a declared body is absent (for example 204)", following zh-Hant-TW's "a declared body does not exist"; the runtime needs no change.
- Tags: runtime=both

#### F056

**The decode-result table does not hold for an SSE handshake error-struct mismatch**

- Review ID: P09a-doc-guides-02
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:79-81; doc/content/en-US/docs/errors.mdx:133-135; doc/content/en-US/docs/design-decisions.mdx:111-115; doc/content/en-US/docs/design-decisions.mdx:146; packages/core/src/sse/transport/event_stream.ts:596-606; packages/core/src/sse/sse.spec.ts:1158; packages/core/design.md:212; packages/opentelemetry-server/README.md:97
- Sources: P09a-doc-guides-grok-01
- Summary: Both tables write, with no transport qualifier, "The value is not that struct, then `RES_STRUCT_MISMATCH`". During an SSE handshake, when the JSON body of a declared `error` struct has the wrong shape, the public code is `RES_DECODE_FAILED` (cause `StructError`).
- Failure scenario: `defineEventStream({ …, error: struct.object({ reason: struct.string() }) })`, and the server returns 403, `application/json`, `{"reason":1}`. A branch written from the table as `fault.code === 'RES_STRUCT_MISMATCH'` does not hit, and the actual result is `RES_DECODE_FAILED`. An HTTP `error` of the same shape is `RES_STRUCT_MISMATCH`.
- Evidence:
  - Implementation: in `event_stream.ts:596-606`, `try { … decodeJson(handshakeError, raw) … } catch (error) { … throw new EventStreamFatalError('RES_DECODE_FAILED', …, { cause: error }) }`, with the comment "a declared handshake body that cannot be read is RES_DECODE_FAILED".
  - That behavior is locked by a test: `sse.spec.ts:1158` 'should report a declared handshake body that fails its struct as RES_DECODE_FAILED'.
  - Docs: `errors.mdx:81` and `design-decisions.mdx:115` do not qualify the transport; the SSE section at `errors.mdx:133-135` lists only non-2xx, media type, and missing body; `design-decisions.mdx:146` says an SSE handshake body "follows the same kind rule as an HTTP body".
  - `sse.mdx:32` ("a body that cannot be read as the declared kind is `RES_DECODE_FAILED`") is only partial coverage.
  - Reproduction (probe.mjs, Bun/Node agree, exit 0):
    `HTTP_ERROR_SHAPE {"code":"RES_STRUCT_MISMATCH","status":403,"cause":"StructError"}`
    `SSE_HANDSHAKE_SHAPE {"code":"RES_DECODE_FAILED","status":403,"cause":"StructError","stream":null}`
  - Severity note: the auditor reported P2, downgraded to P3 here. Reasons: the behavior is intentional and locked by a test; the SSE guide at `:32` already explains it roughly; the class prefix is still `RES`, and the cause is still `StructError`; the hit surface is only "SSE + a declared error struct + JSON that parses but has the wrong shape".
- Fix direction: Note on both tables that `RES_STRUCT_MISMATCH` applies only to HTTP; add a row in the SSE section of errors.mdx, "a declared handshake body fails to parse or fails its struct, then `RES_DECODE_FAILED`, with `StructError` on the cause".
- Tags: cross-partition (the behavior is in P03a), runtime=both

#### F057

**withTimeout JSDoc still names the nonexistent ABORTED/TIMEOUT**

- Review ID: P02-core-http-client-10
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/core/src/client/option.ts:49, packages/core/src/error/types.ts:31, packages/core/src/error/types.ts:33, doc/content/en-US/api/core/withtimeout.mdx:17
- Sources: P02-core-http-client-codex-07, P02-core-http-client-grok-08
- Summary: `option.ts:49` says "abort, then `ABORTED`, timer, then `TIMEOUT`", but `FaultCode` has only `NET_ABORTED`/`NET_TIMEOUT`.
- Failure scenario: A JS user writes `fault.code === 'TIMEOUT'` from the IDE hover docs, and that branch never hits.
- Evidence:
  - The original text at `option.ts:49` is as above.
  - The closed set at `error/types.ts:23-40` does not contain these two codes.
  - `withtimeout.mdx:17` has the correct `NET_*`.
  - Grepping this partition's non-spec sources, the old codes appear only here.
  - Downgraded from P2 to P3: the API page is correct; a TypeScript user comparing against the closed-set literals gets a type error immediately, and only a JS user is misled.
- Fix direction: Delete `ABORTED`/`TIMEOUT` and replace them with `NET_ABORTED`/`NET_TIMEOUT`.

#### F058

**The struct.object page says .alias reads by wire key**

- Review ID: P09b-doc-api-02
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/core/struct-object.mdx:16
- Sources: P09b-doc-api-grok-01
- Summary: The object page says "`.alias(name)` reads and writes the field under a different wire key." But the default `struct.parse` reads by the logical name, and only `{ aliases: true }` and the HTTP/JSON codecs read the wire key.
- Failure scenario: A reader defines `struct.object({ displayName: struct.string().alias('display_name') })` from the object page, then calls `struct.parse(User, { display_name: 'Ada' })`. The result is `missing_key`, path `displayName`.
- Evidence: Review probe `/tmp/zen-audit/verified/P09b-doc-api/scratch/alias-default.mjs`. Both Bun and Node exit 0:
  ```text
  bun 1.4.3 default: [ [ "missing_key", "displayName" ] ] undefined | aliases:true: null {"displayName":"Ada"}
  node 26.11.1 default: [ [ 'missing_key', 'displayName' ] ] undefined | aliases:true: null {"displayName":"Ada"}
  ```
  Other pages in the same partition got it right: `struct-parse.mdx:18` ("`options.aliases` defaults to `false`: object keys are read by their **logical** names"), `structmethods-type.mdx:20`, `api/struct.md:53`. Severity rationale: downgraded from P2 to P3. The sentence holds in a wire context, so it is misleading rather than explicitly wrong; the `struct.parse` page being called got it right; the failure shows immediately as `missing_key` with a path, and does not fail silently.
- Fix direction: Change the sentence to the same wording as the `StructMethods` page: `.alias(name)` sets the wire key, `struct.parse` reads the logical name by default, and only `{ aliases: true }` and the JSON codecs read the wire key.
- Tags: runtime=both

#### F059

**HttpRequestShape.body is miswritten as unknown on the module page**

- Review ID: P09b-doc-api-03
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/http.mdx:160; doc/content/en-US/api/core/httprequestshape-type.mdx:10; packages/core/src/internal/builder_types.ts:53
- Sources: P09b-doc-api-codex-04, P09b-doc-api-grok-02
- Summary: The same `HttpRequestShape` is written on the module page as `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`; the symbol page and the source are `... ? never : BodyValue`, and the latter is a restricted union of wire/JSON values.
- Failure scenario: A reader writes, from the module page, a POST builder helper that accepts `unknown` and returns `{ body: value }`, believing any value can be a body, and passes a class or `interface` instance without spreading it. The actually imported `HttpRequestShape<'/items', 'POST'>` reports TS2322.
- Evidence: The original text at `http.mdx:160` is `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`; `builder_types.ts:53` is `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : BodyValue`, and `BodyValue` is defined at `builder_types.ts:30-40`. Review `node_modules/.bin/tsc -p /tmp/zen-audit/verified/P09b-doc-api/scratch/tsconfig.body.json --pretty false`, against the newly built dist, exits 1. The only diagnostic is `http-body-signature.ts(8,12): error TS2322: Type 'unknown' is not assignable to type 'BodyValue | undefined'.`; the `{ body?: unknown }` version in the same file, written as the docs say, reports no error. Severity rationale: downgraded from P2 to P3. The canonical symbol page got it right, the deviation is discovered at compile time, and it does not cause a runtime error; this matches the P3 grading of P02-core-http-client-10 (API page correct, a side description wrong).
- Fix direction: Change the module page to `BodyValue` and link to the symbol page's value description, or delete this handwritten signature and only link the `HttpRequestShape` symbol page.

#### F060

**The OTel README lists server.port as a required attribute**

- Review ID: P12-project-docs-04
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/opentelemetry-server/README.md:230-232; packages/opentelemetry-server/README.md:267; packages/opentelemetry-server/src/telemetry/url.ts:22; packages/opentelemetry-server/src/interceptor/http.ts:39; packages/opentelemetry-server/src/telemetry/metrics.ts:112-114
- Sources: P06 verifier side note (neither auditor filed it separately)
- Summary: The README's span attribute list writes `server.port` unconditionally. The metrics table marks `defjs.operation`, `http.response.status_code`, and `error.type` as optional, but does not mark `server.port`. The implementation does not write this attribute for a default port (such as `https://host`, `https://host:443`, `http://host`).
- Failure scenario: The application endpoint is `https://api.example.com`. Operations groups a dashboard or an alert dimension by `server.port` according to the README, and the attribute is on neither the span nor `http.client.request.duration`.
- Evidence:
  - `url.ts:22` is `serverPort: Number.parseInt(parsed.port) || undefined` (a WHATWG URL returns `''` for a default port); `http.ts:39` is `...(serverPort ? { 'server.port': serverPort } : {})`; `metrics.ts:112-114` is `if (serverPort) { attributes['server.port'] = serverPort }`.
  - The existing test `http.spec.ts:536` "should set server.address and server.port from URL" asserts only `server.address`; `:545` asserts the port only for `:8443`.
  - The API page `api/opentelemetry-server.mdx:91` says "`server.port` (when known)", and the integration guide at :99 says "server address/port when available", which matches the implementation. The README is the only exception.
  - My probe `scratch/server-port-probe.ts` exits 0 on both Bun and Node: `server.port` is `null` for `https://api.example.com`, `https://api.example.com:443`, and `http://api.example.com`, and `8443` for `https://api.example.com:8443`.
- Fix direction: Note at README:232 "only when the URL has an explicit non-default port", and mark `server.port` optional in the metrics table at :267, consistent with the API page.
- Tags: runtime=both

#### F061

**The Errors guide says data.status passing a struct proves it came from the backend**

- Review ID: P09a-doc-guides-04
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:124-126; packages/core/src/http/http.ts:436; packages/core/src/http/http.ts:462-467
- Sources: P09a-doc-guides-codex-02
- Summary: Struct validation only proves the body shape matches the declaration. It cannot prove the origin. A same-shaped body generated by a gateway, proxy, or CDN passes as well.
- Failure scenario: The gateway never reaches the backend and returns 502 and `{"status":429,"retryAfter":5}` directly, matching the discriminated union in `narrow-by-status.ts`. The caller gets `HTTP_STATUS`, with `fault.data.status === 429`. A reader who treats it, as the docs say, as a rate-limit signal already proven to come from the backend trusts a value generated by a middle layer.
- Evidence:
  - Original text: "`fault.status` is the HTTP-layer number, which a proxy, gateway, or CDN can rewrite; `data.status` was decoded from the body your `error` struct asserted, so reaching it is proof the backend produced it."
  - The implementation has no origin check: `http.ts:436` only calls `decodeDeclaredBody(struct, settledResponse, requestSignal)`, `:466` is `const decodedResponse = { ...meta, body: decoded }`, and `:467` is `return fail(createHttpStatusFault(decodedResponse))`.
  - Reproduction (probe.mjs, Bun/Node agree): `PROVENANCE {"code":"HTTP_STATUS","status":502,"dataStatus":429,"backendCalls":0}`.
  - Severity note: the auditor reported P2, downgraded to P3 here. The docs' advice itself (prefer the body for discrimination) is still reasonable, and the error is only the origin assertion in "proof"; it does not touch the library's security boundary.
- Fix direction: Change "so reaching it is proof the backend produced it" to "it passed the error struct you declared", and also warn that a middle layer can generate a matching body too.
- Tags: runtime=both

#### F062

**A heartbeat ACK dispatched synchronously inside send is overwritten by a timeout created afterward**

- Review ID: P03b-core-ws-07
- Verdict: CONFIRMED
- Severity: P3
- Category: correctness
- Location: packages/core/src/web_socket/heartbeat.ts:69; packages/core/src/web_socket/heartbeat.ts:78-82; packages/core/src/web_socket/heartbeat.ts:37-40; packages/core/src/web_socket/web_socket.ts:758-766
- Sources: P03b-core-ws-codex-03
- Summary: The heartbeat creates `ackTimer` only after `socket.send(serialized)` returns; if the handle dispatches the ACK synchronously inside `send`, `markAck()` clears a timer that does not exist yet, and the timeout created afterward still judges a healthy session as error.
- Failure scenario: Inject a handle that synchronously echoes `"pong"` inside `send` (typically an in-process loopback test double), `heartbeat: { intervalMs: 5, timeoutMs: 10, message: () => 'ping', isAck: (m) => m === 'pong' }`; `isAck` is called once and returns true, and 10 ms later `closed` is `{ kind: 'error', cause: Error('WebSocket heartbeat timeout') }`.
- Evidence: `heartbeat.ts:69` `socket.send(serialized)`; a string frame is decoded synchronously at `web_socket.ts:743`, `:760-765` runs `heartbeat.markAck()` on the same call stack, and at `heartbeat.ts:37-39` `ackTimer` is undefined at that moment; after send returns, `:78-81` creates a new timeout. Review probe: `PROBE SYNCACK node=26.11.1 acks=1 sent=1 closed=error cause=WebSocket heartbeat timeout`; bun=1.4.3 is the same. Severity note (codex reported P2, downgraded to P3): a platform WebSocket's message event is dispatched asynchronously per task, and browsers, undici, Bun, and `ws` never echo synchronously inside send. The trigger is limited to a custom synchronous double, and it is deterministically exposed on the first heartbeat period.
- Fix direction: Establish this period's ACK deadline before send (and clear it if send throws), or record "this period is already acknowledged" with a period index, so an already acknowledged period is not timed again.
- Tags: runtime=both

#### F063

**injectClient() misreports that the plugin is not installed when it errors outside the injection context**

- Review ID: P07-react-vue-01
- Verdict: CONFIRMED
- Severity: P3
- Category: correctness
- Location: packages/vue/src/core.ts:44-48 (primary); packages/vue/src/core.ts:37 (JSDoc `@throws If no client was provided (plugin not installed)`); packages/vue/test/core.spec.ts:16-18 and packages/vue/src/core.browser.spec.ts:284-303 (they lock only the "plugin not installed" path)
- Sources: P07-react-vue-grok-01 (codex judged it "not an adapter error" in H3 of coverage.md; the dispute is adjudicated here)
- Summary: `injectClient()` throws the same sentence whenever `inject(HTTP_CLIENT)` returns `undefined`, so "the plugin is installed, but the call is outside the injection context" is also described as "forgot to call `app.use(createClientPlugin(client))`".
- Failure scenario: The application has already run `app.use(createClientPlugin(client))`, but the following three spellings call `injectClient()` outside the injection context: a handwritten `async setup() { await x; injectClient() }`; a call inside an event handler, a watch callback, or a callback after mount; a call at module scope. Then Vue's `inject()` returns `undefined`, and the adapter throws "Did you forget to call app.use(createClientPlugin(client))?". A development build also prints Vue's own correct warning; a production build deletes that warning, and the only text left in a production error report points debugging the wrong way.
  - These spellings are unaffected: a synchronous `setup()`; after a top-level `await` in `<script setup>` (the compiler restores the instance with `withAsyncContext`); `app.runWithContext(() => injectClient())`.
- Evidence: Source `packages/vue/src/core.ts:44-48`:
  ```ts
  export function injectClient(): Client {
    const client = inject(HTTP_CLIENT)
    if (!client) {
      throw new Error('No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?')
    }
  ```
  My probe is `/tmp/zen-audit/verified/P07-react-vue/scratch/vue-context-probe.mjs`. It was copied to `packages/vue/.audit-tmp/` at runtime and deleted after use. The environment is Vue 3.5.43, Bun 1.4.3, and Node 26.11.1, and every mode was run on Bun and Node, in development and under `NODE_ENV=production`.
  - `outside` (plugin installed, called outside a component): Bun and Node agree, both `"thrown":"No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?","blamesPlugin":true,"inRunWithContext":true`. The development build's `warnings` is `["[Vue warn]: inject() can only be used inside setup() or functional components."]`, and the production build is `[]`.
  - `asyncAfter` (handwritten `async setup`, called after `await`): the SSR HTML on both runtimes and both builds is `<p>No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?</p>`.
  - `scriptSetupAwait` (a `<script setup>` actually compiled with `vue/compiler-sfc`, called after a top-level `await`): both runtimes and both builds are `<p>APP</p>`, with no warning.
  - `sync`: `<p>APP</p>`.
  - React-side control (`scratch/react-context-probe.mjs`, Bun and Node each exit 0): calling `useClient()` outside a component, React first prints "Invalid hook call", then throws a TypeError related to `dispatcher.useContext`, `outsideIsAdapterMessage:false`. React never reaches the adapter wording, so this problem exists only in Vue.
  - Why this is P3: the supported usages (synchronous setup, `<script setup>`) behave correctly; a development build gets the correct diagnosis from Vue; the contract docs at `doc/content/en-US/api/vue/injectclient.mdx:12` already require use where `inject` is allowed. The problem is only the diagnostic quality of the error message on misuse, especially in production.
- Fix direction: Change the single-cause error text so it names both causes, for example "must be called synchronously inside setup(), and confirm the plugin is installed or `provide(HTTP_CLIENT, …)` was run", and change the JSDoc `(plugin not installed)` at the same time. Do not introduce `hasInjectionContext()` directly: v3.0.0's `apiInject.ts` does not have this function, and using it would break the declared `vue >=3.0.0` peer range unless the minimum version is raised at the same time.
- Tags: runtime=both

#### F064

**Four documentation links in the Struct README are dead, and a constructor-table row is duplicated**

- Review ID: P01-core-struct-08
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/core/src/struct/README.md:383; packages/core/src/struct/README.md:392-393; packages/core/src/struct/README.md:56; packages/core/src/struct/README.md:60
- Sources: P01-core-struct-codex-09, P01-core-struct-grok-06
- Summary: The README still links `../../../../doc/core/{http,errors,struct,commands}.md`, and those files no longer exist after the Fumadocs rebuild. Also, constructor-table lines 56 and 60 are both "binary values | `blob`, `file`, `arrayBuffer`".
- Failure scenario: A reader of this source-contract README who clicks "HTTP docs", "error docs", `doc/core/struct.md`, or `doc/core/commands.md` opens a file that does not exist.
- Evidence:
  - **Link targets:** checking each file, `doc/core/http.md`, `errors.md`, `struct.md`, and `commands.md` are all MISSING; the corresponding `doc/content/en-US/docs/{http,errors,struct,commands}.mdx` all exist.
  - **Duplicate rows:** line 56's note is "browser platform values", and line 60 is "value Structs. Sent as bytes when used as a body root; select the corresponding representation when used as an inbound declaration".
  - **Downgrade rationale (both auditors' P2 to P3):** this README is for maintainers, there is no wrong behavioral description, and the fix is only cleanup.
- Fix direction: Delete line 56 and merge its note into line 60; point the four links at `../../../../doc/content/en-US/docs/{http,errors,struct,commands}.mdx`.

#### F065

**DESIGN-builder.md still calls itself the current contract and contradicts the code**

- Review ID: P12-project-docs-05
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: DESIGN-builder.md:3; DESIGN-builder.md:403; DESIGN-builder.md:415; DESIGN-builder.md:98; DESIGN-builder.md:106; packages/core/src/internal/builder_types.ts:29-40; packages/core/src/internal/builder_types.ts:53; packages/core/src/http/transport/body.ts:36-38
- Sources: P12-project-docs-codex-07, P12-project-docs-grok-08 (partial)
- Summary: This design draft used to be maintained as a living contract: the commit message of `77a75294` says "See DESIGN-builder.md … for the full contract and rationale", and `43081465` (2026-10-10) updated it along with the contract. Later `c0024006` (2026-10-12) changed body to `BodyValue` without syncing it. Its status line, the promise that body is `unknown`, and the FormData Content-Type rule now all disagree with HEAD.
- Failure scenario: A maintainer follows section 5.3 of the draft and has a POST builder return `{ body: user }` directly (`user: User` is an interface). The draft expects that to pass, but the current type check reports TS2322, and it must be changed to `{ ...user }`. Someone who sets `content-type` on FormData according to section 3.4 thinks the header is kept, but it is deleted.
- Evidence:
  - Original text: :3 is "Status: implemented (worktree uncommitted; codex round-fifteen audit Ready, `bun run verify` passed)"; :403 is `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`; :415 is "`body` is `unknown`: … a precise `JsonValue` would reject the user's own `interface User`"; the FormData row at :98 says "same as above" and has no clear-header exception; :106 is "Override content-type: declare `content-type` in `headers`".
  - Current code: `builder_types.ts:53` is `body?: … : BodyValue`, and the JSDoc at `:29` says "An `interface` value or class instance needs `{ ...value }`"; `body.ts:36-38` is `if (isFormData(body)) { headers.delete('Content-Type'); return }`.
  - My type probe `scratch/body-type/`, through the public `defineRequest` builder: `CLAUDECODE= bun check --project …/tsconfig.interface.json --no-pretty --all` exits 1, reporting `Type 'User' is not assignable to type 'BodyValue | undefined' … Index signature for type 'string' is missing in type 'User'`; the spread version exits 0, `No type errors in 77 files`.
  - History: `git log -S'BodyValue' -- builder_types.ts` points at `c0024006`; `git log -- DESIGN-builder.md` has only `77a75294` and `43081465`.
  - Current references: `git grep DESIGN-builder` has no reference in tracked files, only the commit messages above.
  - Severity: the file is not in the tarball, current docs do not link it, and the reader is a maintainer, so P3.
  - Related: P09b-doc-api-03 (the API page also writes body as `unknown`).
- Fix direction: Mark at the top of the file that this is a historical design record from 2026-09-28, and point at `packages/core/design.md`; delete the "worktree uncommitted" status line; change section 5.3's body type and section 3.4's FormData exception to the current rules, or mark them explicitly as superseded.
- Tags: —

#### F066

**The root README's Codecov badge is stuck on the 2025-03-14 snapshot**

- Review ID: P12-project-docs-06
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: README.md:12; .github/workflows/ci.yml:10-19
- Sources: P12-project-docs-grok-07 (codex listed the same hypothesis as insufficient evidence and did not file it)
- Summary: `6e9f1aa6` (2026-06-13) deleted the Codecov upload from this branch's CI, but the badge remains. Data on Codecov stopped at 2025-03-14, covering only 13 files and 619 lines.
- Failure scenario: A reader judges the project's test status from the badge, clicks through, and sees a 2025 report of 13 files that is unrelated to the current codebase, and no CI run will refresh it. The number the badge shows (100%) happens to equal the current enforced 100% threshold, so what is wrong is the freshness of the data and the link target, not the number itself.
- Evidence:
  - `README.md:12` is `<a href="https://codecov.io/gh/defjs/defjs"><img src="https://img.shields.io/codecov/c/gh/defjs/defjs…`.
  - HEAD's `ci.yml` has only `bun ci`, installing Playwright, and `bun run verify`; the most recent `git log -S'codecov' -- .github/workflows/ci.yml` is `6e9f1aa6`.
  - A read-only request to `https://api.codecov.io/api/v2/github/defjs/repos/defjs/` returns `"updatestamp":"2025-03-14T18:45:42Z"`, `"files":13`, `"lines":619`, `"coverage":100.0`; the shields badge is `<title>coverage: 100%</title>`.
  - The current thresholds are at `packages/core/test/shared.ts:20-25` (all four are 100).
- Fix direction: Delete the badge line at README.md:12. If coverage should be shown, restore the upload in `ci.yml` and then add it back.
- Tags: —

#### F067

**The Hong Kong Traditional interceptors guide has a whole sentence left in English**

- Review ID: P10a-i18n-cjk-02
- Verdict: CONFIRMED
- Severity: P3
- Category: i18n
- Location: doc/content/zh-Hant-HK/docs/interceptors.mdx:83; compared with doc/content/en-US/docs/interceptors.mdx:86
- Sources: P10a-i18n-cjk-codex-03
- Summary: The lead-in sentence of the "Reference" section, "Factories return tagged transport values:", only replaced the colon with a fullwidth one and otherwise kept the English unchanged; the other four locales are all translated.
- Failure scenario: When a Hong Kong Traditional reader reaches the Reference section, this sentence (factory functions return values tagged with a transport) can be understood only in English. The technical meaning does not change, and the code list immediately after it is complete.
- Evidence: `grep -n Factories` results: zh-Hant-HK:83 is `Factories return tagged transport values：`; zh-Hant-TW:85, rendered, is `Factories return tagged transport values:`; ja-JP:85, rendered, is `Factories return tagged transport values.`; ko-KR:86, rendered, is `Factories return tagged transport values.` I scanned the full body of all five locales with a self-written `scratch/english.py`. The only other hits are two Hong Kong Traditional bullets that are all-English term phrases: "logical session + startup connection snapshot" at `docs/design-decisions.mdx:63` and "Fetch fail / cancel / timeout" at `docs/start.mdx:125`. They are noun phrases and match the Hong Kong Traditional pages' general practice of keeping English terms, so they are not counted in this item.
- Fix direction: Translate line 83 into a Hong Kong Traditional explanatory sentence, following line 85 of zh-Hant-TW.
- Tags: —

#### F068

**Equal in types.type.test.ts accepts any**

- Review ID: P04-core-infra-07
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/error/types.type.test.ts:5, packages/core/src/error/types.type.test.ts:119, packages/core/src/error/types.type.test.ts:120, packages/core/src/error/types.ts:47
- Sources: P04-core-infra-grok-08
- Summary: `Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false` holds in both directions for `any`, and `FaultClass` is asserted only in this file.
- Failure scenario: If the public type `FaultClass<FaultCode>` degenerates to `any`, the `ClassCases` and `NetworkClass` assertions still pass, consumers lose the narrowing of the class-name union, and no test raises an alarm.
- Evidence:
  - Mutation 1: change `types.ts:47` to `C extends string ? any : never`, run `CLAUDECODE= bun check --no-pretty --project tsconfig.json`, result `✓ No type errors in 265 files`, exit 0.
  - Mutation 2: change it to `C extends string ? string : never`, result TS2344 at `types.type.test.ts(119,26)` and `(120,28)`, exit 1.
  - After each mutation, `git checkout -- packages/core/src/error/types.ts` was run; after restore it is clean, exit 0, 265 files.
  - `git grep FaultClass` shows no other assertion besides this test.
  - Reason for downgrading from P2 to P3: only degeneration to `any` can slip past the check; the same repository's `interceptor.type.test.ts` already has `StrictEqual`/`IsAny` that reject any, and they can be reused directly.
- Fix direction: Replace this file's `Equal` with a comparison that rejects any. Reuse `StrictEqual`, or switch to `expectTypeOf<FaultClass<FaultCode>>().toEqualTypeOf<…>()`.

#### F069

**The ignored discriminatedUnion guard has no test**

- Review ID: P05-core-tests-03
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/struct/constructors.ts:314-317; packages/core/src/struct/constructors.discriminated_union.spec.ts
- Sources: P05-core-tests-codex-05 (grok coverage H7 held "reachable only by a type lie, so not recorded"; this item adjudicates that too)
- Summary: The guard marked `/* istanbul ignore next -- type-safe */` is reachable both by a JavaScript caller and by a caller who bypasses the types with `as`, but no test locks it, and coverage will not flag it because of this comment.
- Failure scenario: Someone deletes this "unreachable" branch, taking the comment at its word. After that, a JS user calling `struct.discriminatedUnion('type', [struct.string()])` no longer gets the actionable `discriminatedUnion options must be object structs`, but `undefined is not an object (evaluating 'optionDef.cache.declaredDescriptors')`. If it is changed to `return undefined as never`, the definition returns `undefined` directly.
- Evidence:
  - Reachability: at the type level, string, `struct.or(a,a)`, and `struct.intersection(a,b)` as an option are all TS2322 (`scratch/tsdu/du.ts`, tsc 7 exit 1). At runtime, `bun scratch/du-runtime.ts` throws the guard's TypeError for all three inputs.
  - After deleting the guard, the same script outputs `TypeError undefined is not an object (evaluating 'optionDef.cache.declaredDescriptors')`.
  - Full core-server (Bun): m5a (throw changed to `return undefined as never`) is `exit=0 passed=1757`; m5b (delete the whole if) is `exit=0 passed=1757`.
  - Control m5c: deleting the adjacent literal guard also marked "type-safe" is `exit=1`, and what fails is `constructors.discriminated_union.spec.ts > rejects discriminator field that is not literal`. The ignore comment and the actual test coverage disagree.
  - Downgraded to P3: a natural regression (deleting the guard) still throws TypeError at definition time, only the error message gets worse, and the impact is limited to JS or misuse that bypasses the types.
- Fix direction: Delete the `istanbul ignore next` comment at `constructors.ts:314`, and add a case in `constructors.discriminated_union.spec.ts` where a non-object option throws that TypeError.
- Tags: cross-partition (P01), runtime=both

#### F070

**Five Content-Length tests only assert duplex**

- Review ID: P02-core-http-client-11
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/http/transport/fetch.spec.ts:467, packages/core/src/http/transport/fetch.spec.ts:495, packages/core/src/http/transport/fetch.spec.ts:518, packages/core/src/http/transport/fetch.spec.ts:540, packages/core/src/http/transport/fetch.spec.ts:563, packages/core/src/http/transport/fetch.ts:207
- Sources: P02-core-http-client-codex-08
- Summary: All five case names promise to verify length parsing, but the only assertion is `init.duplex === 'half'`. The `Infinity` case does not even set `uploadProgress`.
- Failure scenario: Change the length passed at `fetch.ts:207` to `0`, and all five cases still pass.
- Evidence:
  - Mutation probe (already restored):
    - `-t "Content-Length"` on Node: `Tests 5 passed | 31 skipped (36)`, exit 0.
    - `bun --bun` is also `5 passed`.
  - Running the full core-server under the same mutation (Node): `Tests 3 failed | 1754 passed (1757)`. What fails are the three "should call uploadProgress for a … body" cases in `fetch.streaming.spec.ts`. So the behavior itself has other protection, and `utils.spec.ts` also unit-tests `getContentLength`.
  - Downgraded from P2 to P3: no regression would be missed because of this. The problem is only that these five case names do not match what they do, and the boilerplate is duplicated.
  - Restore: `git checkout -- packages/core/src/http/transport/fetch.ts` exit 0, `git status --short` empty.
- Fix direction: Delete these five duplicate cases, or merge them into one table-driven case that reads the wrapped stream and asserts `loaded`/`total`/`lengthComputable`.
- Tags: runtime=both

#### F071

**The documentation build fingerprint does not include dependency versions, so an old artifact is still judged fresh after an upgrade**

- Review ID: P08-doc-site-04
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/scripts/build-state.ts:3-12; doc/package.json:42-48; package.json:20-31 (root `workspaces.catalog`); doc/e2e/*.test.ts (the `assertFreshBuild` call sites)
- Sources: P08-doc-site-grok-01 (the catalog/lockfile part); the SITE_URL part of the same item and P08-doc-site-codex-02 are in rejected
- Summary: The fingerprint hashes only `{app,content,examples,public}/**` plus seven named files inside `doc/`. Documentation dependencies are all written as `"catalog:"`, and the real versions exist only in the root `package.json` catalog and `bun.lock`, neither of which is in the fingerprint.
- Failure scenario: A maintainer bumps `fumadocs-ui`, `fumadocs-core`, or `react-router` one version in the root catalog, runs `bun install`, then runs `bun run --cwd doc test:site` directly without rebuilding. Every e2e's `assertFreshBuild` judges the build fresh, so the tests pass against an artifact built with the old dependencies and give the wrong conclusion "the upgrade has no regression". CI's `verify` and the release docs job both build before accepting, so it is caught eventually, hence P3.
- Evidence:
  - The input list at `build-state.ts:3-12` does not include `../package.json` or `../bun.lock`.
  - `doc/package.json:42-48` is `"fumadocs-core": "catalog:"` and similar spellings.
  - `bun scratch/fingerprint-probe.ts` (exit 0) shows the fingerprint on the current artifact is `ab7615af…8833` and is accepted by `assertFreshBuild`. The dependency part is inferred directly from the input list; the version was not actually changed and rebuilt, because that needs `bun install`, which was forbidden this time.
  - Other tracked files inside doc are fully covered: outside the glob, `git ls-files` has only these seven named files, plus `check-site-url.ts` and `preview.ts`, which do not affect the artifact.
- Fix direction: Include the dependency versions the documentation build resolves in the fingerprint, for example a content hash of the root `package.json` catalog section or of `bun.lock`; add a case to `build-state.test.ts` that "the fingerprint must change when only a dependency version changes".
- Tags: runtime=bun

#### F072

**exports.test.ts is blind to type-only exports such as export type ***

- Review ID: P08-doc-site-05
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/test/exports.test.ts:13-37; doc/test/exports.test.ts:53-55
- Sources: P08-doc-site-grok-07 (codex held there is no omission today and did not report it; the two conclusions do not conflict)
- Summary: `sourceExports` recognizes only brace exports, `export type|interface|class|enum|function|const` declarations, and `export * from`. Type-only `export type * from`, `export type * as ns from`, and `export declare namespace` appear in neither the scan result nor the runtime namespace, so the three bidirectional assertions always pass for them.
- Failure scenario: A package's public entry adds `export type * from './types'`, which exports the type `Hidden`. The catalog is missing `Hidden`, and the test "catalog matches its public exports, in both directions" still passes.
- Evidence:
  - `bun scratch/exports-scan-probe.ts` (exit 0) takes the `sourceExports` function body from lines 13-37 of the test file and runs it unchanged. The fixture `index.ts` contains `export type * from './types'`, `export declare namespace Ns {...}`, `export type * as T2 from './types'`, and `export { visible } from './types'`. Output `scanner names: ["visible"]`.
  - HEAD currently has none of this syntax: in `packages/{core,react,vue,opentelemetry-server}/src` the only match is `export let` at `opentelemetry-server/src/test-utils.ts:97`, and that file is not a public entry. `bun test ./test` is 49 pass.
  - The test comment itself admits that the runtime namespace can only catch value exports.
  - Brief H3 explicitly allows reporting this class of fragility as P3.
- Fix direction: Make the scanner fail closed: an `export` statement it cannot recognize errors immediately, instead of being skipped silently. Note that the repository's TypeScript is native 7.0.2, `node_modules/typescript/lib` has only a `tsc.js` wrapper and no JS compiler API, so the `getExportsOfModule` grok suggested cannot be used directly.
- Tags: runtime=bun

#### F073

**A process-level miss log makes an in-process rerun of http.e2e report a false failure**

- Review ID: P05-core-tests-04
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/test/e2e-routes.ts:12-23; packages/core/test/http.e2e.spec.ts:651; packages/core/test/http.e2e.spec.ts:665; packages/core/test/http.e2e.spec.ts:680; packages/core/test/http.e2e.spec.ts:690
- Sources: P05-core-tests-grok-01
- Summary: Hits on `/e2e/miss/` are recorded in an array in the globalSetup process that is never cleared, and two cases assert that the filtered list is "exactly one" using a fixed control path, so a second run inside the same globalSetup lifetime necessarily fails.
- Failure scenario: A developer uses `vitest --repeats`, or reruns `http.e2e.spec.ts` in watch mode (globalSetup starts the server only once). The product behavior is completely correct, but the control path's historical hits become two, `toEqual` fails, and it looks as if the request reached a place it should not.
- Evidence:
  - `bun --bun vitest run --config vitest.config.ts --project core-server --coverage.enabled=false --repeats=1 test/http.e2e.spec.ts -t "does not reach the server"` exits 1, `Tests 2 failed | 20 skipped`, the diff is `+ "GET /e2e/miss/build-failed-control"`, and the other case `input-invalid-control` has one extra the same way.
  - Without `--repeats` it exits 0, `2 passed`.
  - The browser cases of the same fixture (`sse.browser.spec.ts:114`, `http.upload_progress.browser.spec.ts:120`) already generate a unique path with `Date.now()` to avoid this, and the server spec does not.
  - Downgraded from P2 to P3: CI runs once, it does not affect the product or CI, and it only affects a local rerun.
- Fix direction: Add a suffix unique to each run on the control paths of the two server cases too (reuse the browser cases' `Date.now()` approach), without changing the server fixture.
- Tags: runtime=both

#### F074

**Teardown port probing reports a false failure when the port is rebound by another process**

- Review ID: P05-core-tests-05
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/test/setup.ts:653-659; packages/core/test/setup.ts:692-714; packages/core/test/regression/hono-test-server.spec.ts:37-42
- Sources: P05-core-tests-grok-04 (codex coverage H6 treated it as a static risk but did not submit it)
- Summary: After the `server.close()` callback succeeds, `assertLoopbackPortClosed` connects to that port once more and throws as soon as the connection succeeds. This step cannot tell whether what connected is its own server or another process that just bound the same port.
- Failure scenario: When the machine has many parallel processes (this audit had 24 agents in parallel, and `_shared.md` section 2.2 also mentions this phenomenon), some process binds the same port after the server closes and before the probe connects. Every test passes, but Vitest ends with `Test server teardown failed` and exit 1.
- Evidence:
  - `node scratch/g4-port-race.mjs` starts a real `bun --bun vitest run --config vitest.config.ts --project core-server ... test/make_fake_handler.spec.ts`, reads the port from stdout, then starts another process that tries `listen` on the same port every 1ms, simulating port reuse on a busy machine.
  - Output: `BINDER took port 58292`, `VITEST exit 1`, `Tests 4 passed (4)`, `AggregateError: Test server teardown failed`, `Loopback port close verification failed: Loopback port 58292 still accepts connections`.
  - This step has limited detection value: the `server.close()` callback itself already means the listening socket finished closing.
  - `hono-test-server.spec.ts:38-40` uses `connect` after close and expects `ECONNREFUSED`, with the same false-failure window.
  - Two full baseline runs this time did not hit it naturally, so it is graded P3.
- Fix direction: Delete `assertLoopbackPortClosed` and its calls, and rely on the `server.close()` callback. If it is kept to guard a Bun compatibility issue, a successful connection must not be judged a failure directly; first confirm the peer really is this server (for example by requesting a marker route only this server has).
- Tags: runtime=both

#### F075

**Three path boundaries in preview.ts disagree with static hosting**

- Review ID: P08-doc-site-06
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/scripts/preview.ts:8; doc/scripts/preview.ts:10; doc/scripts/preview.ts:13
- Sources: P08-doc-site-grok-03, P08-doc-site-grok-04, P08-doc-site-grok-05 (codex did not report it because "no current impact"; adjudicated and merged into one P3)
- Summary: `startPreview` is the server e2e uses to simulate GitHub Pages, but three behaviors differ from static hosting:
  - Line 8 calls `decodeURIComponent` on a malformed `%`, throws an uncaught URIError, and returns 500;
  - Line 10's `relative(root, path).startsWith('..')` judges a legal file named `..hidden.txt` under the root as 403;
  - Line 13's `(await file.exists()) && file.size` treats a 0-byte file as missing and returns 404.
- Failure scenario: Request the following paths under a temporary root:
  - `/empty.js` returns 404 and the 404 page content (GitHub Pages would return 200 with an empty body);
  - `/..hidden.txt` returns 403;
  - `/%` returns 500 and a Bun error page.

  The current build has 5 zero-byte JS chunks (`assets/{search,sitemap,mdx,index,full}-BvRk9kiK.js`), all corresponding to resource routes with `hasDefaultExport:false`. The client does not import these chunks, so there is no impact on readers or the current e2e.

- Evidence:
  - `bun scratch/preview-edges-probe.ts`: port 0, the same as `doc/test/preview.test.ts`. Output `/empty.js 404 "not-found-page"`, `/..hidden.txt 403 "Forbidden"`, `/% 500 "<!doctype html>…"`, `/%2e%2e/etc/passwd 404` (directory traversal is still stopped).
  - The process exits 1 because Bun.serve records the uncaught URIError in the handler; all four responses were already printed.
  - Local `Bun.file(<dir>).exists()` is false, so the `file.size` check is not what excludes directories, and deleting it does not affect the `index.html` fallback.
- Fix direction: On a decode failure, return 400 or fall through to the 404 page; change the out-of-bounds check to `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)`; use only `exists()` for existence.
- Tags: runtime=bun

#### F076

**The fillUrl branch that takes the first array item is unreachable on the public execution path**

- Review ID: P04-core-infra-06
- Verdict: CONFIRMED
- Severity: P3
- Category: over-engineering
- Location: packages/core/src/internal/url.ts:17, packages/core/src/internal/url.spec.ts:33, packages/core/src/internal/outbound_request.ts:270, packages/core/src/internal/transport_request.ts:56, packages/core/src/web_socket/build.ts:20
- Sources: P04-core-infra-codex-06, P04-core-infra-grok-09
- Summary: In production `fillUrl` has only two callers, `transport_request.ts:56` and `web_socket/build.ts:20`, and both pass the product of `materializePath` (`outbound_request.ts:270-287`), `{ [key: string]: string }`. `materializePath` already rejects null and any object (including arrays), so the "take only the first item of an array" branch at `url.ts:17-26`, and the non-scalar check after it, can be reached only by a direct unit test. `url.spec.ts:33-38` also locks this silent truncation as expected behavior.
- Failure scenario: There is no user-visible failure. The cost is maintenance: two opposite rules coexist (the public chain rejects arrays, the lower-level test requires truncation); if a future caller bypasses `materializePath`, it gets silent truncation instead of an error.
- Evidence: The non-test results of `git grep -n "fillUrl("` are only the two places above. `outbound_request.ts:282-283` throws `path value for "${key}" must be a scalar` for an object. `misc.mjs` outputs `public path array {"code":"REQ_BUILD_FAILED","msg":"path value for \"id\" must be a scalar"}` on both runtimes.
- Fix direction:
  - Delete the array branch at `url.ts:17-26`, and the truncation assertion at `url.spec.ts:33-38`.
  - Narrow the `params` type of `fillUrl` and `createWebSocketRequest` to `{ [key: string]: string }`.
  - Keep the checks for an empty segment, a dot segment, and a missing parameter.
  - The Headers branch and the tuple branch of `appendRecordToHeaders` pass through `materializeHeaders` unchanged and are genuinely reachable. Do not delete them.
- Tags: cross-partition

#### F077

**The @types/react-dom version is pinned independently in two places**

- Review ID: P11-ops-05
- Verdict: CONFIRMED
- Severity: P3
- Category: over-engineering
- Location: package.json:34-35; packages/react/package.json:27-28; bun.lock:683; bun.lock:1559
- Sources: P11-ops-grok-03
- Summary: `@types/react-dom` in the catalog is `19.2.3`, and `packages/react` bypasses the catalog with `^19.3.0`, so the lockfile resolves both `@types/react-dom@19.3.0` and `doc/@types/react-dom@19.2.3`.
- Failure scenario: There is no failure today (the baseline typecheck and the frozen dry-run both pass). This is two version sources maintained for the same types package, and the React DOM types of the doc and react packages may diverge later.
- Evidence: Read `package.json:34-35` (`"@types/react": "19.3.0"`, `"@types/react-dom": "19.2.3"`), `packages/react/package.json:27-28` (both are `^19.3.0`), `bun.lock:683`, and `bun.lock:1559`. `bun install --frozen-lockfile --dry-run` exits 0.
- Fix direction: Delete the two hardcoded versions in `packages/react/package.json` and change them to `catalog:`; bump `@types/react-dom` in the catalog to `19.3.0`, and `doc/@types/react-dom@19.2.3` in the lockfile then disappears.

## Appendix A: Final-Review Adjudications

##### Dispute adjudications

- **P04-core-infra-05 and P02 rejected grok-07 (an HTTP interceptor resolves to a non-`HttpResponse`)**
  - Adjudication: keep the P04 reviewer's conclusion, CONFIRMED P2 (F022).
  - Reason: `errors.mdx:145` unconditionally promises that HTTP "execute promise settles once, with the tuple". The "can still throw" at README:46 means the interceptor itself can throw, which the same table turns into `EXT_INTERCEPTOR_FAILED`, and it does not allow execute to reject. SSE/WS collect the same kind of misuse into `EXT_INTERCEPTOR_FAILED`. Also, a native `Response` is misreported as the server's `RES_STRUCT_MISMATCH`, which P02's rejection did not address.
  - Not raised to P1: a TypeScript user is stopped at compile time.
- **P03a-core-sse-01 and P04-core-infra-03**
  - Adjudication: keep them as two items (F003, F012), do not merge.
  - Reason: they are two data structures in different modules (the `errorOpenInfoMap` WeakMap and the transport-origin WeakSet), the symptoms differ (returning someone else's response snapshot across requests vs an interceptor-fault classification flipping), and the consequence levels differ (P1 vs P2). Fixing one does not fix the other.
  - Both are placed in the same systemic theme in the summary, and the recommendation is to fix them in one change.

##### Cross-partition merges (primary-entry choice)

| Merged in          | Primary                  | Reason                                                                                                                                            |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01-core-struct-01 | P03b-core-ws-01 (F010)   | Both are `codec.ts:11` missing `rejectNonJson`; the primary covers the queue and heartbeat paths.                                                 |
| P01-core-struct-02 | P04-core-infra-02 (F007) | The same message chain; the primary also covers the Node parser fragment of `RES_DECODE_FAILED`, and `api/errors.mdx:63`.                         |
| P09b-doc-api-01    | P03a-core-sse-02 (F009)  | The same `retryCount` semantics; the reference-page locations are merged into the primary.                                                        |
| P09a-doc-guides-05 | P11-ops-04 (F042)        | The same statement that "a deleted gate is still called verification"; the primary covers the release notes, the published README, and the guide. |
| P09a-doc-guides-03 | P09b-doc-api-04 (F053)   | The same "a declared body equals JSON" misstatement; the fix is the same, adding the JSON-representation premise.                                 |

##### Not merged (related but separate)

- **P03b-core-ws-02 and P03a-core-sse-02**: two independent implementations; the WS item also has evidence that the `factor` JSDoc contradicts the implementation. Listed separately, but a joint decision on budget semantics is recommended.
- **P03a-core-sse-05 and P09a-doc-guides-02**: the triggers differ. The former is a non-2xx reconnect handshake, the latter is an error-struct mismatch on the startup handshake.
- **P12-project-docs-03, P09b-doc-api-04, P10a-i18n-cjk-01**: three different conditions in the same OTel log paragraph, best handled in one documentation change.
- **P05-core-tests-02 and P11-ops-03**: CI and the release pipeline, respectively.
- **P01-core-struct-08 and P12-project-docs-01**: the source README for maintainers, and the README published with npm, respectively.
- **P02-core-http-client-06**: locations from the P04-01 review side note and the P03a review side note are merged in, appending extra_locations only.

##### Severity confirmations and adjustments

- **P0 confirmed: F001.** `_shared.md` section 5 explicitly lists "a published artifact is non-compliant" as P0, and the problem already appears in the published `0.4.0-beta.1`. Zero runtime impact, and the fix is one line.
- **P1 confirmed:**
  - **F002**: not raised to P0, because the trigger needs a path the developer wrote or an interceptor rewrite, and an untrusted value in a placeholder is encoded; but it bypasses the only same-origin defense the docs declare.
  - **F003**: not raised to P0, because the leak requires the caller to read or log the third slot, and what leaks is response metadata; the category stays contract, and the summary notes the privacy impact.
  - **F004**: the docs declare that the default handle is the global fetch, and a replacement after import having no effect is a behavioral deviation under common usage.
  - **F005**: it breaks the README's promise that timeout/abort can bound the work, and it causes memory amplification or a call that never returns.
  - **F006**: a combination the docs explicitly promise necessarily fails.
- **Adjustments:**
  - **P10a-i18n-cjk-01: P2 to P3 (F055).** Same class as P09b-doc-api-04 and P12-project-docs-03: a documentation deviation of an OTel log condition in a narrow scenario, the runtime is correct, and it does not make a reader write wrong code. Take the lower level by "same class, same level".
  - **The F042 merge group is graded P2** (P09a-doc-guides-05 was originally P3): the statement appears in the README published with npm, the release notes, and the guide in 11 languages, and it claims a guarantee that no longer exists.
- **Considered but not adjusted:**
  - **P03a-core-sse-02 and P03b-core-ws-02 are not raised to P1**: the docs do not promise "reset after success", both reviewers explicitly rejected P1, and the lower of the two levels is taken. They rank near the front of P2.
  - **P03b-core-ws-01 stays P2**: both auditors originally reported P1, and the reviewer downgraded it because "the WS docs explicitly write the `JSON.stringify` mechanism".
  - **P11-ops-02 stays P2**: it is not live yet, and only one inferred type degenerates.
  - **P12-project-docs-02 stays P2**: it is governance documentation, but the process is completely unusable.
  - **P06-otel-server-05 is kept**: the project explicitly supports multiple copies (`parse.protocol.spec.ts:771`).
  - **P08-doc-site-03 is kept at P2 as PLAUSIBLE**, marked needs-browser.

##### Global calibration rules

- **Documentation class**: an authoritative page (API/guide) is wrong, and a reader who follows it writes wrong code or misses a failure, is P2. The following are P3:
  - the authoritative page is correct and only a side summary or JSDoc is wrong;
  - the deviation is exposed at compile time;
  - the file is only for maintainers;
  - the file is a historical record.
  - `design.md` is treated as a narrative contract by `_shared.md` section 4, and being stale is P2.
- **Test class**: a realistic regression that can escape the full suite and has a user-visible consequence is P2. If the full suite still catches it, it only degenerates into a worse error message, it only affects a local rerun, or the regression path is extremely narrow, it is P3.

##### Deletions

- None. All 82 items are kept as primary entries or merged entries.

## Appendix B: Findings Removed at Final Review

| Review ID | Disposition | Reason                                                                                                       |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| —         | —           | This phase deleted no review entry; all 82 are kept as primary entries or merged into others (see plan.tsv). |

## Appendix C: Candidates Rejected at Review

### P01-core-struct

#### P01-core-struct rejected items

| Source                              | Title                                                                                              | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01-core-struct-codex-07            | Escaping `_errors` in `format()` collides with a field whose real name is `\_errors`               | Escaping is behavior the public docs state (`api/core/formattedstructerror-type.mdx:15`: "A path segment literally named `_errors` is stored as `\_errors`"). The collision needs two conditions at once: the field name is literally `\_errors`, and a hand-built multi-issue `StructError` exists. `struct.parse` is fail-fast and produces only one issue. The reproduction is real, but there is no realistic failure scenario.                                                                                           |
| P01-core-struct-grok-05             | The `struct.date` API page says `new Date(value)`, but the runtime returns the same Date reference | The same reference is by design, locked by two tests: `expect(v1).toBe(d)` at `constructors.primitives.spec.ts:60` and `constructors.browser.spec.ts:88`. The sentence at `struct-date.mdx:12` describes the timestamp/string conversion, and the "the input is not modified" promise at `struct-parse.mdx:21` still holds. The difference shows only if the input Date is mutated after parse, which is not a realistic defect. Codex also rejected the same point in H2, and this dispute is handled by codex's conclusion. |
| P01-core-struct-grok-04 (sub-point) | A non-string truthy value returned by errorMap is written into `message`                           | The public type of `ErrorMap` is `string \| undefined`, and only a callback that bypasses type checking returns this way. The empty-string body of this item was merged into P01-core-struct-06.                                                                                                                                                                                                                                                                                                                              |

### P02-core-http-client

| Sources                      | Title                                                                                                            | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P02-core-http-client-grok-07 | When an interceptor resolves to a non-`HttpResponse`, execute throws TypeError or classifies it as `HTTP_STATUS` | The phenomenon was reproduced: `undefined` causes a reject, `{}` gets `HTTP_STATUS`, on both runtimes. But this is the interceptor violating the type contract and the docs contract: `interceptors.mdx` says "you must return the expected result type", `interceptor.type.test.ts:110` locks the return value with types, and `README.md:46` says "custom interceptors … can still throw". A TS user is stopped at compile time, and a JS user gets an explicit reject, not a silent error. This matches codex's rebuttal of H7a. |

### P03a-core-sse

#### P03a-core-sse rejected candidates

| Source                                                       | Title                                                                              | Reason                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinator cross-item (b), corresponding to P03b-core-ws-04 | `maxDelayMs` takes effect before jitter, so the actual SSE wait can exceed the cap | Not filed separately on the SSE side. `docs/sse.mdx:62` states "`maxDelayMs` caps the base", which matches the runtime; `withssereconnect.mdx:34` and `clientsseoptions-type.mdx:36` do not promise a hard cap. The only inconsistent SSE JSDoc is `client/config.ts:107`, already listed in the Location of P03b-core-ws-04, so it is a duplicate. |

No auditor finding was fully rejected. Severity adjustments: P03a-core-sse-grok-01 was downgraded from P1 to P2 (merged into 03). P03a-core-sse-grok-03's category was changed from docs to contract, severity stays P2 (that is 02), consistent with P03b-core-ws-02.

### P03b-core-ws

#### P03b-core-ws review: rejected candidates

The two auditors in this partition submitted 10 items in total (codex 5, grok 5), merged by root cause into 7 candidates, all CONFIRMED, with no rejected candidate.

Items adjusted rather than rejected (recorded):

- P03b-core-ws-codex-01 / P03b-core-ws-grok-01: P1 to P2 (the WS docs explicitly write the `JSON.stringify` mechanism, so there is no violation of a written contract; a narrow boundary).
- P03b-core-ws-codex-03: P2 to P3 (only a custom synchronous double can trigger it, and it is exposed on the first heartbeat period).
- P03b-core-ws-codex-04 and P03b-core-ws-grok-05: both are the test gap in `connectOnce` physical-attempt cleanup, merged into P03b-core-ws-03.
- P03b-core-ws-codex-05 and P03b-core-ws-grok-04: the same `design.md:237` documentation problem, merged into P03b-core-ws-06.

Hypotheses both auditors already rejected, and the reviewer spot-checked and agreed not to file (not candidates, kept only for reference): H2 (WS reconnect parameters are validated before start at `reconnect.ts:20-35`), H8 (`validateWebSocketClose` uses `Number.isInteger` and a `TextEncoder` byte count, `web_socket.ts:1329-1336`), H9 (URL construction reuses the HTTP rules), H10 (headers/body are not passed to the constructor, and the docs already say so), H11 (raw frames and the parse queue are limited by count separately, and the docs do not promise a combined or byte cap), H12 (the execute-level heartbeat payload is constrained by types).

### P04-core-infra

#### P04-core-infra rejected candidates

| Source ID                                                              | Title                                                                                                                            | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P04-core-infra-codex-03 (the lost-reason part), P04-core-infra-grok-06 | The caller's abort reason is replaced by the shared sentinel `ERR_ABORTED`, and the sentinel is mutable and affects later faults | Documented design: `err-aborted-type.mdx:12` states "Shared `cause` and message value for caller cancellation", and `errors.mdx:171` lists "Abort reason and stack" as usually absent/sensitive. The caller still holds `signal.reason` (`misc.mjs`: `reasonStillOnSignal: "UserNavigatedAway"`). The "mutable singleton" scenario requires user code to mutate a shared constant the library exports, and no realistic caller was given.           |
| P04-core-infra-grok-02                                                 | `makeResponse({ request })` copies the request's credential headers and Content-Type into response headers                       | Documented behavior locked by tests: `makeresponseoptions-type.mdx:19`, the JSDoc at `http_response.ts:58`, and `http_response.spec.ts:65-86`. `makeresponse.mdx:14` and `interceptors.mdx:56` require setting content-type explicitly for JSON, and once headers are set they are not copied. `errors.mdx:177` already lists response headers as sensitive. The official examples never pass `request`. Codex rejected it too.                     |
| P04-core-infra-grok-04                                                 | Illegal UTF-8 is replaced with U+FFFD rather than `RES_DECODE_FAILED`, and charset is ignored                                    | Identical to platform Fetch's `Response.json()`/`text()`, which is also WHATWG's non-fatal UTF-8 decode and ignores charset. `utf8-platform.mjs` outputs the same `[99,97,102,65533]` on both runtimes. No document promises fatal decoding or decoding by charset; the WebSocket docs state that it is read as UTF-8. Codex rejected it too.                                                                                                       |
| P04-core-infra-grok-07                                                 | When several `set-cookie` values are supplied as a Headers instance, only the last is kept                                       | `Set-Cookie` is a response header, a forbidden request-header name in the Fetch specification, browsers drop it, and it has no HTTP meaning as a request header. Other header names are given as the combined value in `Headers.forEach`, and `set` does not drop information. The "replace" semantics of a Headers instance and the "append" semantics of a tuple are already written in `withheaders.mdx`. There is no concrete failure scenario. |

### P05-core-tests

| Source IDs              | Title                                                                               | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P05-core-tests-codex-02 | The generative intersection test allows zero samples into the encode comparison     | The claimed regression does not survive the full suite: codex's mutation (always return StructError at `introspection.ts:54`) fails 107 items on the full Bun core-server; a finer intersection mutation (`utils.ts:50` makes a non-empty array merge fail) fails 22 items. The "rejected" channel is backed by many deterministic intersection cases, and the single-file weakness has no observable consequence.                                                                                                                                                                                                                         |
| P05-core-tests-codex-03 | A bidirectional assignability Equal check accepts a public type degenerating to any | Duplicate: the `error/types.type.test.ts` part was already reported by P04-core-infra-07 (P3, CONFIRMED); the `client.type.test.ts` part is already recorded in the P02 map, and the strict type of its return tuple is locked by `http.type.test.ts`. Not filed again in P05.                                                                                                                                                                                                                                                                                                                                                             |
| P05-core-tests-grok-02  | The Firefox macOS directory workaround is not locked by a test                      | The test name only claims "isolate env, the non-macOS branch is unchanged", and both are locked. Deleting `mkdirSync` does survive the full suite (g2: exit 0, 1757 passed), but the consequence chain (Firefox reports "Could not find profile folder." because the directory does not exist) can be confirmed only by running a browser on macOS, and it was not reproduced. The directory persists across runs in `tmpdir()`, and this is a temporary development workaround the brief lists as known-by-design, with a deletion list, and it does not affect users of the published package. There is no confirmable failure scenario. |
| P05-core-tests-grok-03  | Running the server config alone does not start the test server                      | Intentional design: commit c0024006 moved `globalSetup` from `vitest.config.server.ts` to the aggregate config so the server and browser projects share one server. `package.json`'s `test`, the root verify, and CI all go through the aggregate config. No current document or script runs that project file alone, only historical plan commands in `docs/superpowers/` that predate the commit. grok's proposal of "one copy per project" would start two servers on a full run, overturning a design just made, with no realistic consumer who benefits.                                                                              |

### P06-otel-server

| Sources                              | Title                                                                  | Reason                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P06-otel-server-codex-02 (sub-point) | An attribute written by an async HTTP responseHook after await is lost | Documented behavior: line 15 of the HTTP options page states "the hook is not awaited, so only its synchronous part can still change the span". The remaining problem, that a rejection is not recorded, was merged into P06-otel-server-02.                                                                  |
| P06-otel-server-grok-03 (sub-point)  | A rejection from the HTTP requestHook is not recorded                  | Depends on timing. In this probe, a requestHook that rejects immediately was recorded on both Node and Bun; it is lost only when the hook rejects after await and `next()` also returns in the same turn (a short circuit or a mock handle). Under a real network round trip it is not a user-visible defect. |
| P06-otel-server-codex-01 (severity)  | An outer retry makes the span parent-child relationship wrong (P1)     | Not a rejection, a downgrade to P2: the trace id does not change, the downstream parent-child relationship is correct, metrics and logs are unaffected, and only the client-side tree is wrong, with no data loss.                                                                                            |
| P06-otel-server-codex-02 (severity)  | The promise about an async responseHook is not kept (P1)               | Not a rejection, a downgrade to P2: the business result is unaffected, what is lost is only diagnostic information from the application's own hook, and the HTTP options page already limits async customization.                                                                                             |

### P07-react-vue

| Source ID              | Title                                                                                  | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P07-react-vue-codex-01 | The declared minimum React/Vue peer versions are not in the compatibility verification | There is no concrete failure scenario (the original finding itself says "it does not claim the current minimum versions already fail at runtime"). I checked the built `packages/react/dist/index.d.ts` with `tsc`; the types come from @types/react 18.3.23 and it exits 0; the reversed control (changing the ReactNode-era assertion to react19) exits 1, which shows the sandbox really uses the version-18 types. The v3.0.0 source already has the non-generic `Plugin`, `InjectionKey<T>`, `inject`, and `app.provide`, which is everything the adapter runtime and declarations use; the React runtime uses only `createContext`/`createElement`/`useContext`, all of which React 18 has. What remains is only that the CI process does not cover the minimum versions, which is not a defect.                                                |
| P07-react-vue-grok-02  | A top-level `provide()` in the Vue README does not hand the client to the subtree      | Putting this code into `<script setup>` unchanged is the correct spelling, and `doc/examples/vue/inject-and-override.vue:2-16` uses the same lines. My probe compiled the `<script setup>` version with compiler-sfc, and on Bun and Node, in development and production, child components all get the override client (`OTHER`) and siblings still get the app client (`APP`), matching the description at README `:96`. Putting it outside a component is misuse of Vue's `provide()` API, and a Vue development build warns `[Vue warn]: provide() can only be used inside setup().`; the heading "For a subtree override" itself means use inside a component. There is no failure scenario that follows the documented usage. It can be a P12 wording polish (switch to a `vue` code block and add the `<script setup>` wrapper), not a finding. |

### P08-doc-site

#### P08-doc-site rejected candidates

| Source IDs                                                                      | Title                                                                                     | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P08-doc-site-codex-02; P08-doc-site-grok-01 (the SITE_URL part)                 | The build fingerprint does not include SITE_URL, so an old artifact is still judged fresh | There is no scenario of "a wrong result goes undiscovered". `siteUrl` reads the process environment under bun test (measured: when `SITE_URL=https://docs.example.test`, `siteUrl` is that value), and `e2e/site.test.ts:74` compares the llms origin with it, so e2e fails when the build and the test disagree on SITE_URL. The other e2e assertions do not depend on the origin. The release docs job fully rebuilds with SITE_URL every time. The dependency-version part of grok-01 is kept as P08-doc-site-04. |
| P08-doc-site-grok-06                                                            | Each language's search index embeds whole-page Markdown, 1.7-2.5 MB per file              | A full-text index is a design tradeoff. Codex measured 0.40-0.52 MB after gzip, and no perceptible delay or failure was measured. The suggested "title plus excerpt" would downgrade full-text search to title search, which is not redundancy that can simply be deleted. It is a product choice.                                                                                                                                                                                                                   |
| (codex coverage, not a finding) the official build's "Port 0 is already in use" | Documentation prerender cannot start the Vite preview                                     | A sandbox artifact. This time `bun run --cwd doc build` in the clone exits 0, prerender finishes, and the link check covers 2257 pages; `bun test ./test` is 49/0, including `preview.test.ts`, which binds port 0. grok's environment is also 49/0.                                                                                                                                                                                                                                                                 |

### P09a-doc-guides

| Source                                  | Title                                                                                                            | Reason                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P09a-doc-guides-codex-03                | The SSE guide says a post-open reconnect non-2xx ends with `HTTP_STATUS`                                         | duplicate of P03a-core-sse-05 (the same `docs/sse.mdx:64`)                                                                                                                                                                                                                                                                                                           |
| P09a-doc-guides-codex-04                | The reconnect guide does not say attempts is a cumulative budget of the logical resource                         | duplicate of P03a-core-sse-02 (SSE, `docs/sse.mdx:62`) and P03b-core-ws-02 (WS, `docs/web-socket.mdx:52`)                                                                                                                                                                                                                                                            |
| P09a-doc-guides-grok-03                 | The attempts budget spans the whole logical stream or session, and a successful reconnect does not reset it      | duplicate of P03a-core-sse-02 / P03b-core-ws-02. Extra location for the coordinator to add to P03a-core-sse-02: `doc/content/en-US/recipes/consume-sse.mdx:22`                                                                                                                                                                                                       |
| P09a-doc-guides-grok-05                 | A path-placeholder name consumes up to the next slash, and the docs do not write the grammar                     | duplicate of P04-core-infra-04 (already lists `docs/http.mdx:22` and `docs/commands.mdx:44`)                                                                                                                                                                                                                                                                         |
| P09a-doc-guides-grok-02 (the OTel part) | The OTel integration page writes every declared body as a JSON check/parse                                       | duplicate of P09b-doc-api-04 (already lists `integrations/opentelemetry-server.mdx:164`). Extra location: `:71` also omits the JSON-representation premise. `:169` holds when read as a JSON declaration, so it is not added. The non-OTel part (errors.mdx:90, design-decisions.mdx:104) is kept as P09a-doc-guides-03                                              |
| P09a-doc-guides-grok-04                 | design-decisions:142 divides bodies by a JSON.stringify criterion, and an iterable object literal does not match | No realistic failure scenario. Only a plain object literal with `Symbol.iterator` triggers it (an iterable class instance with `toJSON` encodes as usual); when it triggers, the request fails closed before send and gives an actionable `REQ_BUILD_FAILED` message (probe `ITERABLE_LITERAL` was reproduced). The precise rule is already written at `http.mdx:86` |

### P09b-doc-api

| Sources                                                          | Title                                                                                           | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P09b-doc-api-codex-01                                            | The `withEndpoint` page claims a relative base is supported, but all three transports reject it | Duplicate of P02-core-http-client-07: the locations are the same `api/core/withendpoint.mdx:14` and the `client/option.ts` JSDoc, and the root cause is the same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P09b-doc-api-grok-03                                             | The WebSocket reconnect formula describes `maxDelayMs` as the final wait cap                    | Duplicate of P03b-core-ws-04: the same `withwebsocketreconnect.mdx:26` and `backoff.ts:11-12`, and the root cause is the same.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P09b-doc-api-codex-03, P09b-doc-api-grok-04 (the WebSocket part) | WebSocket `attempts` is a cumulative budget for the whole session, and the docs do not say so   | Duplicate of P03b-core-ws-02 (a partial duplicate). The SSE part is kept as P09b-doc-api-01. This partition has three more same-root WS locations not listed in P03b-core-ws-02, and adding them is recommended: `api/core/clientwebsocketoptions-type.mdx:34`, `api/core/websocketexecuteoptions-type.mdx:30`, `api/web-socket.mdx:106`.                                                                                                                                                                                                                                                                                                                                              |
| P09b-doc-api-codex-02                                            | `struct.parse`'s "Invalid input never throws" misses getter and errorMap exceptions             | By design, and there is no scenario in which a reader would be misled by it. Exception propagation is already listed in `_shared.md` section 4 and locked by `parse.protocol.spec.ts:526-560`. The paths that throw are only the caller's own code: an `errorMap` the caller passed, or an object the caller constructed with a throwing getter. Core has no public custom decode hook. Every validation failure returns `[StructError, undefined]` as the page describes. "invalid input" in that sentence means a validation failure, and it does not give the reader a wrong expectation about an exception in their own callback. Only codex reported this; grok did not touch it. |

### P10a-i18n-cjk

| Source                                            | Title                                                                                                                                                                                                                                                                                                                                  | Rejection reason                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| grok coverage #2 / codex coverage                 | Two comment lines inside inline ts fences in zh-Hans `docs/http.mdx` and `docs/struct.mdx` were translated                                                                                                                                                                                                                             | Only the comments were translated, and the code bytes are the same. "root anonymous: sends id" and "root with a type, the row field declared an alias: sends wire_id" match the English meaning. Listed as a map exception by the brief, not a finding                                           |
| grok #3 / codex coverage                          | Two links in `api/core/withwebsockethandle.mdx` (ja-JP, ko-KR, zh-Hans, zh-Hant-TW) are swapped in order                                                                                                                                                                                                                               | Word-order adjustment (a modifier moved in front) changes the order; the target set and the anchor text agree, and each link points at the correct page                                                                                                                                          |
| codex coverage ("trailing slash on 5 home pages") | The home link `/` in `docs/index.md` corresponds to `/<locale>`                                                                                                                                                                                                                                                                        | It is actually 1 page times 5 locales; mapping en-US `/` to `/<locale>` is the expected localization target, not a difference                                                                                                                                                                    |
| grok #4                                           | ko-KR `recipes/cancel-http.mdx` is missing one `NET_TIMEOUT`; zh-Hans has an extra `HTTP_STATUS`                                                                                                                                                                                                                                       | The former is a false positive from `\b` matching Hangul in the script, and the code spans are actually all present (my independent script did not report it); the latter is at zh-Hans `api/core/executehttpcommand.mdx:24`, mentioning the same `HTTP_STATUS` once more, with the same meaning |
| grok #5 / codex coverage                          | Japanese and others add numbers (68 pages in total, `1` times 108, and so on)                                                                                                                                                                                                                                                          | My independent script confirms none of the 5 locales deleted any number from en-US; the added 2/3/4/10 all have a corresponding number word in en-US (two/three/four/decimal), and no value was changed                                                                                          |
| grok #7                                           | Bullets 4 and 5 of zh-Hant-HK/TW `api/core/withssereconnect.mdx` are swapped in order                                                                                                                                                                                                                                                  | Both bullets are present, the defaults `1000`, `1`, `0` and the 0-1 range all agree, and only the adjacent order differs                                                                                                                                                                         |
| grok #12 / codex coverage                         | ja-JP and zh-Hans `api/core/structerror-type.mdx` translate the placeholder `<first message>`                                                                                                                                                                                                                                          | The angle brackets were already an explanatory placeholder, and the prefix `N struct issues:` is unchanged; the message format generated at runtime by `packages/core/src/struct/errors.ts` matches the docs                                                                                     |
| grok #13                                          | zh-Hans `docs/interceptors.mdx:34` drops the `` `Headers` `` code mark                                                                                                                                                                                                                                                                 | "clone before changing headers" is still the same operational rule, and the meaning is unchanged                                                                                                                                                                                                 |
| grok #14                                          | `docs/errors.mdx` splits `` `fault.cause instanceof StructError` `` into two spans (ko and the three zh variants)                                                                                                                                                                                                                      | The sentence is still "narrow `fault.cause` to `StructError` before calling format/flatten/prettify", and the meaning is unchanged                                                                                                                                                               |
| grok #5 incidental                                | ja-JP/ko-KR `api/core/websocketdefinition-type.mdx` writes the default `0` twice                                                                                                                                                                                                                                                       | The default is still `0`, and `0` means no queueing, consistent with en-US                                                                                                                                                                                                                       |
| grok #15                                          | zh-Hant-HK and zh-Hant-TW have 8 files with identical bytes                                                                                                                                                                                                                                                                            | All of them are `meta.json`, and the titles are spelled the same in both places; per the brief this is informational only                                                                                                                                                                        |
| Candidate added during verification               | ja-JP `docs/integrations/opentelemetry-server.mdx:73` is missing the `` `close` `` code mark                                                                                                                                                                                                                                           | It is only that "before close" has no backticks, and the Bun/Node 1006 behavior description is complete and correct                                                                                                                                                                              |
| Candidate added during verification               | 67 pages add to the inline-code multiset (`statusText`, `HttpExecuteOptions`, `request`, `bigint`, `builder`, `attempts`, `Content-Type`, `TRACE`/`Tracer`, `error.type`, `JSON.parse`, `outgoing`, `FaultCode`, `kind`, `export`, `execute`, `close`, `output`/`error`, `invalid_type`, `Error`/`path`, `binaryType`/`'arraybuffer'`) | I compared each against the original en-US sentence (`scratch/show.py`). All of them mention an existing identifier once more, add a code mark to an English word already in the source, or split an expression; no wrong identifier, default, or fault code was added                           |
| Candidate added during verification               | In ko-KR, zh-Hant-TW, and zh-Hant-HK `api/http.mdx:16`, "optional `output`/`error`/`operation`" writes "optional" only once, before `input`                                                                                                                                                                                            | The coordinate structure is ambiguous, but line 76 of en-US is written the same way; line 21 of the same page explicitly says "omitting one side means that body is not read"; the type system also prompts, so this is not a reversal of meaning                                                |
| brief Part 1 #2                                   | The root `meta.json` is missing `title`                                                                                                                                                                                                                                                                                                | en-US is missing it too; `title` is an optional field in the Fumadocs schema (codex already checked `fumadocs-core/dist/source/schema.js`)                                                                                                                                                       |
| brief Part 1 #12                                  | Simplified and Traditional characters mixed                                                                                                                                                                                                                                                                                            | My independent script `scratch/variant.py` counts: 0 pages in zh-Hans contain Traditional-only characters; 0 pages in zh-Hant-TW and zh-Hant-HK contain Simplified-only characters                                                                                                               |
| Already CONFIRMED elsewhere                       | At the en-US layer, the `docs/sse.mdx:64` HTTP_STATUS wording, the cumulative reconnect budget, `sse.mdx:99` "repository-validated", `maxDelayMs` "capped", and the `withEndpoint` relative base                                                                                                                                       | No auditor in this partition reported them as i18n findings; even if one had, they are problems inherited from en-US and are rejected as i18n duplicates                                                                                                                                         |
| codex coverage                                    | `preview.test.ts` in `bun test ./test` (doc) reports `EADDRINUSE`                                                                                                                                                                                                                                                                      | An environment problem, out of this partition's scope, and not an i18n finding                                                                                                                                                                                                                   |
| grok #1, #6, #8, #9, #10, #11                     | File-set drift, SSE/WS defaults swapped, a security recommendation reversed, the Struct matrix swapped, and so on                                                                                                                                                                                                                      | grok already rejected them, and my review agrees: the file set is consistent; inline code and numbers align with en-US; the key paragraphs I sampled in zh-Hant-HK `docs/sse.mdx` and the full zh-Hans OTel page have the same meaning                                                           |

### P10b-i18n-other

#### P10b-i18n-other rejection list

Neither auditor has a formal finding ID. Candidates are listed below by mechanical-check category, with the source written as "auditor:check item".

| Source                                                                          | Candidate                                                                                                                                                                                                                                                                                                                                                                                  | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| grok:inline-code times 39; codex:inline-code 39 pages                           | Inline-code multiset differences (ar 15, de-DE 4, es-ES 4, fr-FR 10, ru-RU 6)                                                                                                                                                                                                                                                                                                              | Only backticks were added or removed, or the wording was rewritten equivalently, and identifiers and values did not change. The highest-risk items were spot-checked: on the es-ES OTel page, `HTTP_STATUS` gained backticks in the table on body line 162 and on line 169, with the same meaning; ar `docs/http.mdx:130` and fr-FR `docs/http.mdx:137` translate the interceptor `throw` as a verb, and the `EXT_INTERCEPTOR_FAILED` exception and the `ERR_ABORTED`/`ERR_TIMEOUT` to `NET_ABORTED`/`NET_TIMEOUT` exception are both kept; the extra `cause` at ar `docs/http.mdx:144` corresponds to the English "the cause message"; the extra `jitter` at ru-RU `docs/web-socket.mdx:58` is "SSE jitter" with backticks added, and the default-value line is verbatim (`jitter: 0`, `0.2` to `0.8x`-`1.2x`); fr-FR `faultclass-type.mdx:12` names `FaultCode` again; ar `docs/errors.mdx:113` translates `code` as "error code"; ar `recipes/get-declared-404.mdx:22` and fr-FR line 22 replace `error` with a pronoun, and the same sentence still states that `error.data` is `undefined` and the body is not read |
| grok:number times 1 + number-section times 1; codex:numbers 1 page              | ar `docs/errors.mdx:77` is missing one digit `0`                                                                                                                                                                                                                                                                                                                                           | The English "no status-0 response" is written "لا توجد استجابة بحالة صفر", back-translated as "there is no response whose status is zero", same meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| grok:number times 1 + number-section times 1; codex:numbers 1 page              | ar `docs/interceptors.mdx:66` is missing one digit `0`                                                                                                                                                                                                                                                                                                                                     | Same as above, "وليس استجابة بحالة صفر" back-translates as "and not a response whose status is zero"; the `NET_*` attribution sentence is kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| codex:link-target times 5                                                       | Five languages translate `/` at `docs/index.md:8` to `/<locale>`                                                                                                                                                                                                                                                                                                                           | `localePrefix(locale)` in `doc/app/lib/i18n.ts` is `/${locale}`, which is exactly the canonical home route of that language; the page does not point at the English page or another language                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| grok:untranslated-frontmatter times 6                                           | The titles of ar and ru-RU `api/opentelemetry-server.mdx`, `api/react.mdx`, and `api/vue.mdx` are the same as English                                                                                                                                                                                                                                                                      | The title is the package name `@defjs/...`, kept by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| codex:frontmatter-identical (8 non-identifier items)                            | ar and ru-RU `docs/integrations/{opentelemetry-server,react,vue}.mdx` and `index.mdx`                                                                                                                                                                                                                                                                                                      | These are the product names OpenTelemetry/React/Vue/Defjs. Another 171 ar items and 172 ru-RU items are API identifier titles. None of the five languages has a description identical to en-US (a page-by-page `grep` comparison is 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| codex:leftover-english times 8; grok:leftover-english times 5 (the two overlap) | ar `api/client.mdx:99`, `opentelemetryserveroptions-type.mdx:24`, `opentelemetryservertransportoptions-type.mdx:17`; ru-RU `fetchhandler.mdx:12`, `websocketrequestshape-type.mdx:21`, `opentelemetryserveroptions-type.mdx:24`, `opentelemetryservertransportoptions-type.mdx:17`, `docs/client.mdx:36`, `docs/design-decisions.mdx:78`, `docs/integrations/opentelemetry-server.mdx:105` | All are local sentences, and the high ASCII ratio is only because they contain terms such as Fetch, WebSocket, and W3C. The credential advice was checked (ru/ar `websocketrequestshape-type.mdx:21`: credentials go in `beforeConnect` or the interceptor), and it matches en                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| verify:extra-parity strong                                                      | Bold-count differences: `api/errors.mdx` (ar/de-DE/fr-FR/ru-RU add bold), `docs/design-decisions.mdx` (ar/de-DE/fr-FR add bold), the OTel page "Options and hooks" section (ar/de-DE/es-ES/fr-FR drop the bold on `**not**`)                                                                                                                                                               | Only the emphasis style differs. The negation in that OTel sentence is still present in all four languages: "ولا يوقف العملية" / "stoppt die Operation nicht" / "sin detener la operación" / "sans arrêter l'opération"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| verify:extra-parity untranslated titles/cells                                   | The title "OpenTelemetry server" and the cell "W3C Trace Context + Baggage" in ar `api/opentelemetry-server.mdx`; the cell on the same ru-RU page; the cell "HTTP XSRF cookie → header" in ru-RU `docs/client.mdx`; the title "Server-Sent Events" in ru-RU `docs/sse.mdx`                                                                                                                 | All are protocol, specification, or technical names, which is a known design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### P11-ops

- **P11-ops-grok-04 - the four packages' `npm publish` has no provenance / `id-token: write`.** Rejection reason: this is a hardening suggestion, and HEAD has no defect or failure scenario. The auditor already confirmed the token does not leak (printf uses single quotes, and npm expands it at runtime). The rubric's P3 means cleanup or over-engineering, and does not include hardening items. If hardening is wanted, the concrete change is: add `permissions: { contents: read, id-token: write }` to the four package jobs and switch to `npm publish --provenance`, or switch to npm trusted publishing (`repository.url` in dist is `defjs/defjs`, consistent with the upstream remote). Codex also explicitly treated it as optional hardening and did not report it.
- **(Dedup check requested by the coordinator) P05-core-tests-02 (CI runs tests only on Bun).** Neither P11 auditor reported the same problem, this partition has no duplicate entry, and no merge is needed.

### P12-project-docs

| Source ID                                           | Title                                                                                                         | Rejection reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P12-project-docs-codex-01, P12-project-docs-grok-01 | The deleted packed-consumer / ES2022 gate is still written as current verification                            | duplicate of P11-ops-04 (`docs/releases/0.4.0.md:66` and `packages/core/README.md:65` are already in its Location). Extra P12 locations: `packages/core/README.md:71-74`, "the repository-tested command is: `bun run dist/index.js`" is executed by no tracked file, and the deleted gate ran `runtime-smoke.ts` at the time. The 10 locales' `docs/sse.mdx:99` that grok listed belong to P09a-doc-guides-05 / P10                                                                                                                                                                                                                                 |
| P12-project-docs-codex-02                           | The OTel README describes every declared response as a JSON media check                                       | duplicate of P09b-doc-api-04 (README:95 is already a known location). Extra P12 location: `packages/opentelemetry-server/README.md:273` (the same wrong premise in the Transport span boundary section). I reran the probe: `struct.string()` with `text/html`, fault=null and logs=0 on 200, `HTTP_STATUS` and logs=0 on 502                                                                                                                                                                                                                                                                                                                        |
| P12-project-docs-codex-04                           | The SSE docs classify every non-2xx handshake error as HTTP_STATUS                                            | duplicate of P09a-doc-guides-02 (the same root cause: a declared `error` body failing on an SSE handshake gets RES_*, and the docs do not say so), related to P03a-core-sse-05. Extra P12 locations: `packages/core/design.md:212` ("a non-2xx startup is `HTTP_STATUS`"; the HTTP section on the same page already states the condition, and the SSE section says "the same by kind", so the actual deviation is only the struct-mismatch item); `packages/opentelemetry-server/README.md:97` is only a clause, and its claim "always records one log" holds when measured (RES_DECODE_FAILED / RES_MEDIA_TYPE_INVALID handshakes each have logs=1) |
| P12-project-docs-codex-08                           | The Content-Type general rule omits the exception that FormData must clear the header                         | Rejected: `design.md:152` and `http.mdx:77` already state in the same table that FormData clears `Content-Type`, and the general sentence summarizes "the detected result"; the same adjudication as P02 H4 (both auditors and the P02 verifier rejected it consistently); a handwritten Content-Type on FormData would lack the boundary, which is exactly the case the clearing behavior protects, and there is no realistic failure scenario                                                                                                                                                                                                      |
| P12-project-docs-codex-09, P12-project-docs-grok-06 | THIRD_PARTY_NOTICES points at an SSE parser path that no longer exists                                        | Merged into P11-ops-01: its Location already contains `packages/core/THIRD_PARTY_NOTICES.md:5`, the Evidence states the old path, and the Fix direction says "correct the source path inside it". Not filed separately                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P12-project-docs-grok-04                            | The OTel docs write paths that do not exist on GitHub's default branch as clickable links                     | Rejected: the brief requires checking GitHub links against tracked paths on this branch, and these paths all exist on HEAD (the anchor `#logs-and-third-party-loggers` in `doc/content/en-US/docs/integrations/opentelemetry-server.mdx` is correct, and `doc/examples/opentelemetry-logging` is tracked). A 404 on `main` is only the transient state of feat/up (171 commits ahead) not being merged yet, and it resolves after the merge                                                                                                                                                                                                          |
| P12-project-docs-grok-08 (partial)                  | DESIGN-builder.md cites the deleted `internal/request_builder.ts:463` and `doc/guide/design-decisions.md:137` | This part is rejected: these citations are in section 1 "Problem" and describe the old `build` implementation this design replaced, so they are historical coordinates and not misleading. The status line and the FormData part were merged into P12-project-docs-05                                                                                                                                                                                                                                                                                                                                                                                |
| P12-project-docs-grok-09                            | The hotspot analysis still requires git-applying already merged patches onto the current tree                 | Rejected: the banner at `hotspot-analysis.md:5` states "all 10 patches have been applied to the worktree … sections 1-8 keep the first-round original text". Section 7 is dated first-round original text, no tracked file links `docs/perf/` (`git grep 'hotspot-analysis\|docs/perf' -- . ':!docs/perf'` finds nothing), which matches the rule in `_shared` section 4 and the brief that historical records are not reported                                                                                                                                                                                                                      |
| P07 verifier side note                              | `provide()` at `packages/vue/README.md:88-94` is missing the `<script setup>` wrapper                         | Rejected (wording polish only): `provide()` being callable only inside setup is Vue's own documented rule, and the `app.use` snippet in the same README is also a snippet; consistent with the P07 verifier's adjudication                                                                                                                                                                                                                                                                                                                                                                                                                           |
