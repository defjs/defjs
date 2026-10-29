# CPU Profile

| Duration | Samples | Interval | Functions |
| -------- | ------- | -------- | --------- |
| 4.31s    | 24521   | 100us    | 397       |

**Top 10:** `read` 39.3%, `addEventListener` 4.6%, `Request` 2.8%, `releaseLock` 2.5%, `URL` 2.3%, `getReader` 1.9%, `removeEventListener` 1.7%, `parse` 1.6%, `Response` 1.6%, `AbortController` 1.4%

## Hot Functions (Self Time)

| Self% |    Self | Total% |   Total | Function                      | Location                                                                                     |
| ----: | ------: | -----: | ------: | ----------------------------- | -------------------------------------------------------------------------------------------- |
| 39.3% |   1.69s |  39.4% |   1.70s | `read`                        | `[native code]`                                                                              |
|  4.6% | 198.8ms |   4.6% | 198.8ms | `addEventListener`            | `[native code]`                                                                              |
|  2.8% | 121.1ms |   2.8% | 123.9ms | `Request`                     | `[native code]`                                                                              |
|  2.5% | 111.5ms |   2.5% | 111.5ms | `releaseLock`                 | `[native code]`                                                                              |
|  2.3% | 102.5ms |   2.5% | 110.0ms | `URL`                         | `[native code]`                                                                              |
|  1.9% |  84.2ms |   2.6% | 112.5ms | `getReader`                   | `[native code]`                                                                              |
|  1.7% |  77.1ms |   1.7% |  77.1ms | `removeEventListener`         | `[native code]`                                                                              |
|  1.6% |  72.4ms |   1.6% |  72.4ms | `parse`                       | `[native code]`                                                                              |
|  1.6% |  72.0ms |   1.6% |  72.0ms | `Response`                    | `[native code]`                                                                              |
|  1.4% |  63.9ms |   1.4% |  63.9ms | `AbortController`             | `[native code]`                                                                              |
|  1.2% |  53.0ms |   1.2% |  53.0ms | `async parseFetchResponse`    | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/http/transport/fetch.ts:250`      |
|  1.1% |  50.2ms |   1.1% |  50.2ms | `any`                         | `[native code]`                                                                              |
|  1.1% |  50.1ms |   1.1% |  51.1ms | `async executeHttpCommand`    | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/http/http.ts:246`                 |
|  1.1% |  47.9ms |   1.1% |  47.9ms | `race`                        | `[native code]`                                                                              |
|  1.0% |  45.2ms |   1.1% |  51.3ms | `fillUrl`                     | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/url.ts:36`               |
|  0.9% |  39.1ms |   1.2% |  54.6ms | `async awaitWithSignal`       | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/abort.ts:93`             |
|  0.9% |  38.9ms |   0.9% |  42.4ms | `async awaitWithSignal`       | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/abort.ts:84`             |
|  0.8% |  37.5ms |   0.8% |  37.5ms | `createEndpointDirectoryBase` | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/url.ts:199`              |
|  0.8% |  34.7ms |   0.8% |  37.1ms | `parseObjectValue`            | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/struct/parse.ts:246`              |
|  0.7% |  31.4ms |   0.7% |  31.4ms | `Error`                       | `[native code]`                                                                              |
|  0.7% |  30.2ms |   9.1% | 392.8ms | `async awaitWithSignal`       | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/abort.ts:83`             |
|  0.6% |  27.8ms |   0.6% |  27.8ms | `get`                         | `[native code]`                                                                              |
|  0.6% |  27.1ms |   0.6% |  27.1ms | `entries`                     | `[native code]`                                                                              |
|  0.6% |  26.5ms |   0.6% |  26.5ms | `drain`                       | `[native code]`                                                                              |
|  0.6% |  26.4ms |   0.6% |  26.4ms | `createEndpointDirectoryBase` | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/url.ts:195`              |
|  0.5% |  25.5ms |   0.5% |  25.5ms | `abort`                       | `[native code]`                                                                              |
|  0.5% |  25.2ms |   0.5% |  25.2ms | `Headers`                     | `[native code]`                                                                              |
|  0.5% |  22.6ms |   0.5% |  22.6ms | `cloneObject`                 | `[native code]`                                                                              |
|  0.4% |  20.6ms |   0.4% |  20.6ms | `set`                         | `[native code]`                                                                              |
|  0.4% |  20.6ms |   0.4% |  20.7ms | `Promise`                     | `[native code]`                                                                              |
|  0.4% |  20.4ms |   0.4% |  20.4ms | `encodeObjectNode`            | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/outbound_request.ts:387` |
|  0.4% |  19.7ms |   1.6% |  71.9ms | `handler`                     | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/http/http.ts:309`                 |
|  0.4% |  19.4ms |   0.4% |  19.4ms | `defineStructTag`             | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/struct/guide.ts:71`               |
|  0.4% |  19.3ms |   0.4% |  19.3ms | `decode`                      | `[native code]`                                                                              |
|  0.4% |  18.7ms |   0.4% |  18.7ms | `createResolvedRequestUrl`    | `/Users/munmunmiao/Documents/web/zen-kit/packages/core/src/internal/url.ts:139`              |
|  0.3% |  16.1ms |   0.3% |  16.1ms | `asyncFunctionDrive`          | `[native code]`                                                                              |
