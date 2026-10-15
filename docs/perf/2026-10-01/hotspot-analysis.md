# @defjs/core 热点与优化分析（2026-10-01）

对象是当前工作区（`feat/up`，含未提交改动）中的 `packages/core`。所有结论都附带可复现的测量，所有改动都以 patch 形式提供，每个 patch 都单独通过了项目门禁。本次分析没有修改任何源码。

> **第二轮更新（2026-10-01）**：10 个 patch 已全部应用到工作区，N1–N8、D1–D5 也已逐项实施或经评估后保留，并在 Chromium、Firefox、WebKit 真实浏览器里完成测量。最终结果、新发现和对本报告前文的修正见**第 9 节**；第 1–8 节保留第一轮原文。

## 结论

| 优先级 | 问题                                                                                    | 结果                                                                                                                                                      | Patch      |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **P0** | `deadline.release` 被挂到请求信号上后从不移除，导致 HTTP、SSE、WebSocket 请求被常驻引用 | Node 下只设 `timeout` 时每 6 万次请求泄漏 +97 MB，Bun +21 MB；修复后基本持平                                                                              | 0001       |
| P1     | HTTP 每请求都在组合信号上反复 `race`                                                    | 单项：Node `get-small` 约 −27%（0002 内三步连乘），`withTimeout` 再 −22%（0009）。全部 patch 合计：Node 小请求 −36%～−43%，Bun −9%～−24%；Promise 81 → 51 | 0002、0009 |
| P1     | SSE 和 WebSocket 每条消息都经过 `awaitWithSignal`                                       | 吞吐约翻倍（Node −50%，Bun −52%/−49%）                                                                                                                    | 0006、0007 |
| P1     | 出站 body 每次调用都重建 encode 计划                                                    | 50 项订单 POST 单项：Node −28%，Bun −41%；合计分配 534 → 241 KiB                                                                                          | 0004       |
| P1     | `client.execute` 静态 import 了全部传输层                                               | 只用 HTTP 的应用 bundle 从 80.1 KB 降到 50.2 KB（−37%，gzip 24.6 KB → 15.4 KB）                                                                           | 0008       |
| P2     | V8 下 `Object.create(null)` 创建的是字典模式对象                                        | V8：解码对象常驻内存 246 → 62 B/对象，读取 −24%；JSC：decode +3%～+8%。需要决策                                                                           | 0010       |
| P2/P3  | endpoint base URL 每请求解析两次；parse tag 用 `defineProperty`                         | Node −6%；重 tag 输入 −6%                                                                                                                                 | 0003、0005 |

全部 10 个 patch 合并后：

- core 测试从 1485 个增加到 1492 个，全部通过，覆盖率保持 100%。新增的 7 个测试中，有 4 个先在未打 patch 的代码上跑过，用来确认锁定的是原有行为。
- 整仓 `bun run verify` 通过，包括 lint、fmt、release、四个包的测试（含 Chromium 和 Firefox）、build、packed consumer。

## 1. 方法与环境

- **环境**：Apple M1 Max，32 GiB 内存，macOS。Node v26.10.0（V8 14.6）；Bun 1.4.2（JSC）。
- **场景**：走完整的 `client.execute` 链路，用 mock fetch handle 直接返回 `Response`，把网络排除在外。另设一个 `raw-fetch-json` 场景（mock handle + `res.json()`）作为"手写客户端"的下限。所以这里测的是**客户端自身的 CPU 和内存开销**；真实延迟以网络为主，这部分开销影响的是 SSR 或服务端吞吐、移动端 CPU 占用，以及流式消息吞吐。场景定义在 `bench/scenarios.mjs`。
- **耗时**：主要用同进程 A/B 交替测量（`bench.sh pair`）：两份构建各 12 轮、每轮 200 ms，交替先后顺序，报告 B/A 比值的中位数和 p25–p75。单进程的前后测量噪声有 ±10%～20%，只作参考。
- **分配**：`node --expose-gc`，新生代设为 512 MiB，保证测量窗口内不触发 GC，读 `heapUsed` 的增量。
- **常驻与泄漏**：同一个长期 signal 连续发数万次请求，每轮之后跑 6 次 GC（让 FinalizationRegistry 有机会清理），看堆是否线性增长。
- **链路计数**：hook `async_hooks` 统计 Promise，并包装 `AbortSignal.any`、`add/removeEventListener`、`Promise.race`、`new URL/Request/Headers` 等调用，按每次操作计数。
- **热点**：Node `--cpu-prof`，采样间隔 50µs，用 `bench/analyze.py` 把 bundle 行号映射回源文件；Bun 用 `--cpu-prof-md`。
- **体积**：`bun build --minify --target=browser`，对比全量、只用 HTTP、只用 struct 三种入口。

原始数据在 `results/`；变更编号与 patch 的对应关系见 `results/legend.txt`。

## 2. 基线画像

### 2.1 框架开销

| 场景                                      | Node                  | Bun     |
| ----------------------------------------- | --------------------- | ------- |
| `raw-fetch-json`（下限）                  | 2.5 µs                | 0.52 µs |
| `get-small`（GET，path 参数，5 字段输出） | 31.6 µs               | 33.7 µs |
| `post-json`（8 字段 JSON body）           | 42.0 µs               | 50.3 µs |
| `sse-2000-events`                         | 6.1 ms（3.1 µs/事件） | 5.2 ms  |
| `ws-2000-messages`                        | 3.8 ms（1.9 µs/消息） | 3.3 ms  |

在 Node 上，一个最简单的 GET 花在框架上的时间约为下限的 12 倍。

### 2.2 CPU 热点（Node，`get-small`）

- `node:abort_controller` 占 14.3%～15.5%，`node:event_target` 6.0%～6.9%，`SafeWeakRef`（primordials）3.9%～4.1%，`abort_listener` 1.2%。**两次采样中，25%～28% 的 CPU 花在 AbortSignal 机制上**（`results/profile-node-get-small-baseline.txt`）。`refreshCompositeSignal`、`followCompositeSignal`、`SafeWeakRef` 都排进了自耗时前十，它们来自往 `AbortSignal.any` 生成的组合信号上挂和摘 listener 时的强引用登记。
- 库自身代码中，`executeHttpCommand` 的包含时间占 36.5%，`fetchHandler` 26.5%，`createFetchRequest`（undici `Request`）20.1%，`awaitWithSignal` 9.0%，`mergeAbortSignals` 8.9%，`resolveRequestUrl` 7.4%。

**Bun（`get-small`）**：原生 `read` 的自耗时占 **39.3%**，来自 `parseFetchResponse` 里的 reader 循环。其余是 `addEventListener` 4.6%，以及 `Request`、`URL` 构造。

### 2.3 每次请求的调用链

`get-small` 一次请求（完整数据见 `results/primitives-per-op.txt`）：

| 计数                                       | 基线                   | 全部 patch 后 |
| ------------------------------------------ | ---------------------- | ------------- |
| Promise                                    | 81                     | 51            |
| `Promise.race`（`awaitWithSignal`）        | 5                      | 2             |
| `AbortSignal.any`                          | 1（设 timeout 时为 2） | 0             |
| `addEventListener` / `removeEventListener` | 8 / 7（**不配平**）    | 5 / 5         |
| `throwIfAborted`                           | 15                     | 11            |
| `new URL`                                  | 3                      | 2             |

基线里 5 次 `awaitWithSignal` 的来源：

1. 外层对 interceptor chain 的 race（`http/http.ts:351`）
2. `fetchWithSignal`
3. body 读取循环，每个 chunk 一次；小 body 是 2 次（`http/transport/fetch.ts:278`）
4. declared body 的 decode（`http/http.ts:479`）

其中 `fetchWithSignal` 和 chunk race 挂在组合信号 `transportAbort` 上（`http/http.ts:309`），在 Node 里每次挂和摘 listener 都要做强引用登记。

### 2.4 内存

- **每次操作的分配**（Node，`results/alloc.txt`）：`get-small` 42.2 KiB，`post-json` 60.3 KiB，`post-order-50` 534 KiB，`get-list-1000` 1207 KiB。
- **泄漏**：详见 P0。

### 2.5 体积

只用 HTTP 的应用，其 bundle 是全量 bundle 的 97%（80.1 KB 对 82.6 KB）。其中 SSE 和 WebSocket 专属模块占 30.3 KB（37.8%），原因是 `client/client.ts:7-18` 静态 import 了三个 executor。

## 3. 发现与方案

每一项的格式都是：证据 → 根因 → 方案 → 实测 → 风险。实测是"只加这一项"的配对 A/B，取中位数，方括号内是 p25–p75。

### P0 · deadline listener 泄漏（0001）

**证据**：`bench.sh leak`，每轮 6 次 GC 后的堆增长。

| 场景（2 万 / 6 万次请求）             | Node 基线            | Node 全部 patch           | Bun 基线            | Bun 全部 patch   |
| ------------------------------------- | -------------------- | ------------------------- | ------------------- | ---------------- |
| HTTP `{ timeout }`                    | +28.9 / **+97.3 MB** | −1.4 / −1.4 MB            | +6.9 / **+20.6 MB** | ≈0 / ≈0          |
| HTTP `{ signal }`（长期 signal）      | +22.8 / +66.5 MB     | +1.2 / +2.3 MB            | +3.6 / +10.5 MB     | +0.13 / +0.14 MB |
| HTTP `{ signal, timeout }`            | +36.1 / +107.6 MB    | +0.5 / +4.1 MB            | +6.9 / +20.6 MB     | ≈0 / ≈0          |
| SSE `{ signal }`（5 千 / 1.5 万个流） | +5.6 / +17.0 MB      | +0.2 / −3.5 MB（GC 抖动） | +0.95 / +2.65 MB    | +0.08 / +0.10 MB |

基线下，Node 每请求泄漏约 1.1～1.8 KB，Bun 约 0.17～0.34 KB；SSE 每条流约 1.1 KB（Node）。都随请求数线性增长，GC 无法回收。原始数据见 `results/leak.txt`。只应用 0001 时，Node 的 HTTP 三行在 2 万次请求下分别为 +1.9、+2.1、+0.6 MB。

**根因**：`http/http.ts:247`、`sse/sse.ts:261`、`web_socket/web_socket.ts:307` 三处都执行了 `requestSignal.addEventListener('abort', deadline.release, { once: true })`，而且从不移除。

- 没设 timeout 时，这是一个空操作的 listener，但照样会挂上去。
- 按 DOM 规范，**带 abort listener 的组合信号，在它的源信号还存活时不能被回收**。只要调用方持有一个长期 signal，每个请求的组合信号及其闭包就会被一直钉住，这在任何遵守规范的运行时里都成立。
- Node 的实现（`lib/internal/abort_controller.js`）把带 listener 的组合信号登记在模块级 `gcPersistentSignals` 集合里，直到它的所有源信号都被回收才移除。而 `deadline.release` 这个闭包本身就引用着 deadline 的 controller，也就是源信号之一。于是形成以全局集合为根的环：哪怕只设 `timeout`、组合里全是请求自己的信号，也永远不会被回收。而客户端级的 `withTimeout` 恰恰是最常见的生产配置。Bun 的内部机制不同，但实测同样泄漏（见上表）。

**方案**：在共享边界修复。`armTransportDeadline` 新增 `releaseOnAbort(signal)`：只有确实布设了 timer 才挂 listener，`release()` 时自己摘掉。三个传输层统一改为调用 `deadline.releaseOnAbort(...)`。改动在 `internal/abort.ts`，约 +13 行。

**测试**：`abort.spec.ts` 新增 3 个测试：没有 deadline 时不挂 listener、release 时移除 listener、signal abort 时 release。

**剩余风险**：Node 的 `AbortSignal.any` 本身会在长期源信号上残留弱引用记录。纯复现中每个组合信号约 17 B；打全部 patch 后，HTTP 复用长期 signal 的残留约 40～70 B/请求（Node）；Bun 下 6 万次请求总计 ≤0.14 MB。要彻底消除，得对调用方 signal 改成手动转发并显式移除（见 N7）。

### P1 · HTTP 信号管线（0002、0009）

**根因与方案**：

1. **transport 信号重复组合**（`http/http.ts:309`）。`mergeAbortSignals(transportController.signal, [requestSignal, nextRequest.abort])` 里，`nextRequest.abort` 通常就是 `requestSignal`，所以每请求都要构造一个含重复源的组合信号。之后 fetch 读取、body 读取的 listener 都挂在它上面。而 `transportController` 本来就通过 `abortTransport` 跟随 `requestSignal`，只有 interceptor 换掉了 signal 时才需要组合。

   方案：此时直接复用 `transportController.signal`。实测：Node **−22.7%** [−29.7, −20.1]，Bun −3.2%。

2. **body 读取每个 chunk 一次 race**（`http/transport/fetch.ts:278`）。改为整个循环只挂一个 abort listener，触发时 `reader.cancel(reason)`。按 Streams 规范，cancel 会让挂起的 `read()` 立即以 `done: true` 返回，循环随后抛出 abort。原有的"abort 时取消源、释放锁、不等 cancel 结束"的测试合同全部保持。实测：Node −4.3% [−5.5, −4.1]，Bun −4.2%。

3. **同步 decode 也套了 race**（`http/http.ts:479`）。只有 Blob body 的读取是异步且不可取消的，其他 body 在默认 transport 里已经是解析好的值。

   方案：只对 Blob 做 race，其余路径先 `throwIfAborted`，再同步 decode，decode 之后原本就有取消检查。实测：Node −1.6%。Bun 的 decode 失败路径 **−42%**；推测原因是异步栈变浅后，Error 捕获栈的成本降低，这一点尚未单独验证。

4. **只有 deadline 时仍组合一个永不 abort 的信号**（`http/http.ts:246`）。`controller` 从不 abort（`http/http.ts:235`），与 deadline 组合没有意义。

   方案：只有 deadline 时，直接用 deadline 自己的信号作为 `requestSignal`。调用方传入的 signal 仍然走组合，避免把 listener 留在调用方的对象上。实测：`get-small-timeout` Node **−22.3%** [−33.7, −20.2]，Bun −2.6%。这一项在 0009。

**风险**：一处可观察差异。原先 `AbortSignal.any` 的组合信号会在源信号的 listener 执行之前就被标记为已 abort；现在 transport 信号在 `abortTransport` 这个 listener 里才 abort。两者都是同步完成、reason 相同。全量测试（含浏览器、deadline 边界和 interceptor 生命周期的回归测试）全部通过。

**新增测试**：`fetch.response.spec.ts` 新增一例，覆盖 cancel 被拒绝时的 abort 路径，并已在基线上验证通过。

### P1 · SSE 每事件路径（0006）

**证据**：基线 Node profile 中，`refreshCompositeSignal` 占 9.2%，`awaitWithSignal` 的包含时间约 20%，每事件的 `TextDecoder.decode` 占 12.4%，每事件的 undici header 校验约 3%。

**根因**：

- `sse/transport/event_stream.ts:360`：每个事件都执行一次 `awaitWithSignal(transformMessage)`，而它挂在组合信号 `attemptAbort` 上。
- `sse/sse.ts:337`：`transformMessage` 外面包了两层 async。
- `event_stream.ts:348`：每收到一个 `id:` 就执行一次 `headers.set('last-event-id')`，而这个 header 只有下一次重连才用得到。
- `sse/transport/parser.ts:143`：每一行都要 `await onLine`；`parser.ts:179` 的 message parser 是 async 函数，每行都产生一个 Promise。
- `parser.ts:207`：每一行都用 decode 字段名的方式来判断字段类型。

**方案**：

- transform 返回同步值时直接入队，只有返回 Promise 时才 race。
- `transformStreamMessage` 在事件合法时同步返回，只有非法事件需要等待 `onInvalidEvent`。
- `Last-Event-ID` 标记为 dirty，在下一次连接开始时再写入 header。
- 行 parser 只在回调真的返回 Promise 时才 await。
- 字段名按字节比较。为保持与原先 `TextDecoder` 行为一致，会跳过一个前导 BOM。

**实测**：Node **−55.0%**，Bun **−52.5%**。

**新增测试**（均已在基线上验证通过）：

- 字段名按字节匹配、BOM、形近字段名被忽略
- 空 `id:` 之后重连时会去掉 `Last-Event-ID`

**风险**：`onInvalidEvent` 回调的触发时机变了：原先总是晚一个 microtask，现在和消息处理同步进行。回调仍然是 fire-and-forget 语义，现有测试全部通过。

### P1 · WebSocket 接收路径（0007）

**根因**：`web_socket/web_socket.ts:736`，每条消息都执行一次 `awaitWithSignal(transformWebSocketMessage)`，而这个 transform 函数本身是 async。

**方案**：新增同步的 `decodeWebSocketMessage`：text 和 byte 帧同步解码，只有 Blob 帧返回 Promise，也只对 Blob 做 race。原来导出的 `transformWebSocketMessage` 保留（改为包一层 async），它的单元测试不用改。

**消息顺序**：由既有的串行 message pump 保证（`rawMessages` 队列，逐条 `await handleMessage`），相关回归测试继续通过（"preserve physical message arrival order when Blob decodes finish out of order"）。

**实测**：Node −49.9%，Bun −49.6%。

### P1 · 出站编码计划（0004）

**证据**：`post-order-50`（50 项数组 body）的 profile 中，`encodeObjectNode` 和 `writeWireGroups` 占主要部分。每个对象节点每次调用都要新建 `Set` ×2、`Map`、`order` 数组、`WireGroup` 对象，并且对每个字段调用一次 `guideTag`。

**根因**：`internal/outbound_request.ts:383` 的 `encodeObjectNode` 是为多成员（intersection、record、passthrough）设计的通用路径，而最常见的情况只有一个 object struct。

**方案**：单个 object struct 走快速路径。它的 wire key 已经唯一（由 `assertUniqueWireKeys` 保证），所以每个字段就是一次普通写入。字段 key 集合和 wire key 集合用 `WeakMap` 按 struct 的已缓存字段表来缓存。这条路径与通用路径逐条等价（分析见 patch），多成员仍走原来的通用路径。

**实测**：

| 场景            | Node       | Bun        |
| --------------- | ---------- | ---------- |
| `post-order-50` | **−27.6%** | **−40.6%** |
| `post-json`     | −7.8%      | −6.8%      |

合并其他 patch 后，`post-order-50` 的分配从 534 降到 241 KiB。

**新增测试**：`union-equivalence.spec.ts` 补一例多成员 object 的 extra key、`undefined` 和 wire alias 冲突。快速路径分流后，原来由单 object 测试覆盖到的这些分支不再被覆盖，需要这个测试补上。已在基线上验证通过。

### P1 · 传输层可 tree-shake（0008）

**根因**：`client/client.ts:7-18` 静态 import 了 `executeHttpCommand`、`executeEventStreamCommand`、`executeWebSocketCommand`。

**方案**：command 通过 `Symbol.for('defjs.command.execute')` 携带自己的 executor，由 `defineRequest`、`defineEventStream`、`defineWebSocket` 在创建 command 时写入。`client.execute` 仍然先校验三种 command 类型，校验通过再调用对应 executor。公共 API 和类型签名不变。

**实测**：

| 入口      | 基线                    | 打 patch 后                                  |
| --------- | ----------------------- | -------------------------------------------- |
| 只用 HTTP | 80,113 B（gzip 24,621） | **50,189 B（gzip 15,445）**                  |
| 全量      | 82,570 B                | 84,161 B（+1.9%，为全部 10 个 patch 的合计） |

**风险**：command 对象多了一个 symbol 键属性。项目中没有测试对 command 做 `toEqual` 结构比较，React、Vue 插件也只依赖 `Client` 类型。

### P2 · 快速 null-prototype 对象（0010，需要决策）

**证据**：

- V8 中 `Object.create(null)` 创建的对象是字典模式（`%HasFastProperties === false`）。改成 `{}` 再 `Object.setPrototypeOf(o, null)`，对象保持 fast properties，原型仍然是 `null`，`__proto__` 键仍然是普通的自有数据属性。

| 引擎               | 解码后读取字段 | decode 本身 | 常驻内存/对象     | `struct-decode-1000` 分配 |
| ------------------ | -------------- | ----------- | ----------------- | ------------------------- |
| V8（Node、Chrome） | **−23.8%**     | −1.8%       | **246 → 62 B**    | 975 → 639 KiB             |
| JSC（Bun、Safari） | +3.1%          | +7.5%       | 74 → 75 B（不变） | —                         |

**方案**：struct 定义了 key 的对象节点改用 `nullObject()`，涉及 parse、intersection 合并、encode 输出。record 继续用 `Object.create(null)`，因为 key 任意，字典模式更合适，也能避免隐藏类爆炸。安全合同（输出原型为 `null`）不变，`parse.security.spec.ts` 通过。

JSC 的微基准里，`setPrototypeOf` 对象的字段读取在不同运行之间有 5～17 ns 的波动（`results/null-prototype-objects.txt`），所以 JSC 一侧以端到端配对结果为准：单项 +3.1%，全部 patch 后 +4.2%。

**决策点**：这是用 JSC 下 decode 慢 3%～8% 换 V8 下常驻内存降到约四分之一、读取快 24%。建议面向浏览器和 Node 的用户群采用。它排在系列最后，可以直接跳过，不影响其他 patch。

### P2/P3 · 其余小项

- **0003 endpoint base URL 缓存**：`internal/url.ts:187` 每请求执行 `new URL(base)` 加三次 setter，外加一次 `new URL(path, base)`。改为按 endpoint 字符串做单条目缓存；`new URL(path, base)` 只读取 base，所以可以共享。另外空查询串时跳过 `url.search = ''`。实测 Node −6.4% [−8.9, −6.1]，Bun 不显著。
- **0005 tag 普通赋值**：parse 过程中给自己新建的 null-proto 节点打 tag，用 `obj[STRUCT] = tag` 代替 `Object.defineProperty`。两者产生的属性特性完全相同（可枚举、可写、可配置）。`attachPassthroughGuides` 仍然用 `defineStructTag`，因为它可能作用在调用方自己的对象上。实测：重 tag 的 `post-order-50` 在 Node 下 −6.1%，Bun 不显著。

## 4. 未实施项

这些项有证据支撑，但需要做合同层面的决策，或者收益不足以支撑改动。

| 编号 | 发现                                                                 | 证据                                                                                                                                                                                 | 建议                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | Bun 下 reader 循环读 body 很慢                                       | `read` 自耗时 39%；真实 loopback HTTP 上，reader 循环比 `res.text()` 多 7～12 µs（小 body）或 98～104 µs（70 KB）；Node 的差异在噪声范围内（`results/body-read-and-primitives.txt`） | 没有 `downloadProgress` 时改用 `response.arrayBuffer()` 一次读完，可以消除这部分开销。但这会违反"abort 时取消源、释放锁"的测试合同（`fetch.response.spec.ts`，stalled body 用例），因为对忽略 signal 的自定义 handle 无法再取消 body。**需要合同决策**；如果 Bun 服务端是重要目标，可以只对 `fetch` 原生 Response 放行 |
| N2   | struct parse 开销约等于 `JSON.parse`                                 | `get-list-1000` 中 struct parse 占 41.9%，`JSON.parse` 占 40.3%；每个字段都要分配一个 `success()` 结果对象，`parseChildValue` 有 path push/pop 加 try/finally                        | 改成哨兵返回值加失败槽位，预计 parse 部分快 20%～30%，但要重写 `parse.ts`（529 行）和 primitive 的 `decode` 钩子。适合单独立项，并以 bench 作为门禁                                                                                                                                                                    |
| N3   | SSE 行扫描是逐字节的 JS 循环                                         | 打完 0006 后，`createLineParser` 占 SSE CPU 的 19%                                                                                                                                   | 用 `Uint8Array#indexOf` 做原生查找，预计约 10%。P3                                                                                                                                                                                                                                                                     |
| N4   | `fetch(request)` 时会再构造一次 Request                              | 规范要求 fetch 内部执行 `new Request(input)`，Node 下每次约 3 µs                                                                                                                     | 要避免，就得改为向 `FetchHandle` 传 `(url, init)`，这会改变自定义 handle 收到的参数。不建议                                                                                                                                                                                                                            |
| N5   | fault 和 StructError 都是 Error，要捕获栈                            | decode 失败时会创建两个 Error                                                                                                                                                        | 这是设计取舍（可调试性），保留                                                                                                                                                                                                                                                                                         |
| N6   | Headers 复制了两次（`createFetchRequestInit` 一次，undici 内部一次） | 每次约 0.3 µs                                                                                                                                                                        | 收益太小，跳过                                                                                                                                                                                                                                                                                                         |
| N7   | Node `AbortSignal.any` 在长期源信号上的残留                          | 纯复现约 17 B/组合信号                                                                                                                                                               | 只有当"同一个调用方 signal 被复用上百万次"是真实用法时，才值得改成手动转发加显式移除                                                                                                                                                                                                                                   |
| N8   | SSE 仍有嵌套的组合信号                                               | `sse/sse.ts:333` 的 `[requestSignal, req.abort]` 含重复源，`event_stream.ts:247` 又组合一层                                                                                          | 打完 0001 后已不再泄漏，每事件的成本也已被 0006 移走，剩下的只是每条流一次的开销。P3                                                                                                                                                                                                                                   |

## 5. 代码量与重复

这些不是性能问题，属于体积和维护成本，列出供后续清理参考。都不在 patch 范围内。

| 项目                             | 位置                                                                                                                                           | 说明                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 两份几乎一样的 `fetchWithSignal` | `http/transport/fetch.ts:190`，`sse/transport/event_stream.ts:539`                                                                             | 可以合并到 `internal/`                                                                       |
| 三份"字节 → 文本/JSON"读取逻辑   | `http/http.ts:493` `bytesToText`，`web_socket/codec.ts:27`，`event_stream.ts:617` `readHandshakeBody`（外加 `utils.ts` 的 `parseBytesBody`）   | 另外有 7 处每次调用都 `new TextDecoder()`，而 `http/transport/utils.ts:3` 已经有一个共享实例 |
| 两套媒体类型解析                 | `http/transport/utils.ts:32` `isJsonMediaType`（只校验 essence）；`event_stream.ts:674` `parseMediaTypeEssence`（约 105 行，完整实现参数语法） | 严格程度不同，合并需要先统一语义                                                             |
| 重复的类型守卫                   | `internal/outbound_request.ts:726-744` 和 `http/transport/body.ts:89-95`、`fetch_init.ts:6`                                                    | 可以共享                                                                                     |
| 永远不会 abort 的 `controller`   | `http/http.ts:235`                                                                                                                             | 0009 之后只在没有任何信号源时才会用到                                                        |

## 6. 汇总：基线 vs 全部 patch

同进程配对测量，中位数加 p25–p75（原始数据见 `results/pair-baseline-vs-all-patches.txt`）。

| 场景                           | Node                                     | Bun                          |
| ------------------------------ | ---------------------------------------- | ---------------------------- |
| `ping-no-decl`                 | 18.9 → 10.8 µs **−42.1%**                | 7.0 → 5.2 µs −23.8%          |
| `get-small`                    | 31.6 → 19.9 µs **−37.1%** [−38.5, −34.4] | 33.7 → 27.2 µs −19.7%        |
| `get-small-timeout`            | 37.5 → 21.8 µs **−42.6%**                | 45.0 → 36.7 µs −15.7%        |
| `get-small-2-interceptors`     | 33.4 → 20.3 µs −39.1%                    | 54.8 → 49.3 µs −8.8%         |
| `get-query`（decode 失败路径） | 41.8 → 27.8 µs −33.9%                    | 210.7 → 52.6 µs **−75.3%**   |
| `post-json`                    | 42.0 → 25.8 µs −38.2%                    | 50.3 → 39.9 µs −20.3%        |
| `post-order-50`                | 163 → 95 µs −41.3%                       | 158 → 91 µs −41.2%           |
| `error-404-declared`           | 36.0 → 23.1 µs −35.7%                    | 47.4 → 38.4 µs −16.0%        |
| `get-list-1000`                | 810 → 772 µs −3.6%                       | +6.9% [−7.7, +8.6]（噪声内） |
| `struct-decode-1000+read`      | 579 → 445 µs −24.1%                      | +4.2%                        |
| `sse-2000-events`              | 6.12 → 3.01 ms **−50.1%**                | 5.17 → 2.46 ms −52.1%        |
| `ws-2000-messages`             | 3.77 → 1.99 ms **−46.5%**                | 3.32 → 1.70 ms −48.5%        |

每次操作的分配（Node，KiB，`results/alloc.txt`）：

| 场景                 | 基线 | 全部 patch 后 |
| -------------------- | ---- | ------------- |
| `get-small`          | 42.2 | 30.9          |
| `get-small-timeout`  | 44.3 | 31.5          |
| `post-json`          | 60.3 | 39.7          |
| `error-404-declared` | 42.1 | 31.1          |
| `post-order-50`      | 534  | 241           |
| `get-list-1000`      | 1207 | 858           |

## 7. 如何应用与复现

patch 需要按顺序应用。每个 patch 都在前一个的基础上单独通过了门禁：core 测试含浏览器、覆盖率 100%、typecheck、lint、fmt。

```sh
cp -R packages/core/src "${TMPDIR:-/tmp}/core-src-before"   # 保留一份基线，用于对比
git apply docs/perf/2026-10-01/patches/*.patch             # 全部应用；不要 0010 的话把它从列表里去掉
bun run verify
```

- **只修泄漏**：单独应用 0001，它直接作用在当前代码上。单独应用时，Node 下 2 万次请求的 HTTP 泄漏已从 +22.8/36.1/28.9 MB（`signal`、`signal+timeout`、`timeout`）降到 +2.1/0.6/1.9 MB，剩余部分由 0002 和 0009 消除。
- **跳过 0010**：直接去掉即可，前 9 个 patch 不依赖它。
- **依赖关系**：其他 patch 修改的是同一批文件，不保证可以乱序单独应用。

复现测量（在仓库根目录执行，需要 node ≥ 26、bun ≥ 1.4）：

```sh
B=docs/perf/2026-10-01/bench/bench.sh
$B pair "${TMPDIR:-/tmp}/core-src-before" packages/core/src          # 基线 vs 当前，配对 A/B
$B pair "${TMPDIR:-/tmp}/core-src-before" packages/core/src get-small sse-2000-events
$B run packages/core/src get-small post-json                        # 单次耗时加分配
$B count packages/core/src get-small                                # 每次请求的平台原语计数
$B leak packages/core/src                                           # 共享 signal 的常驻测试
$B profile packages/core/src get-small                              # CPU profile 摘要
```

## 8. 局限

- 所有耗时都在同一台机器上测得。真实网络延迟会掩盖这里的差异；这些数字衡量的是客户端 CPU 和内存。
- （第一轮）浏览器只做了功能测试，没有做 benchmark。这一条已在第二轮补上，结论有修正，见第 9 节。
- `get-list-1000` 这类 GC 较重的场景，配对测量的离散度约 ±5%，报告里标成"噪声内"的结论都来自这类场景。
- 0006 改变了 `onInvalidEvent` 的调用时机（从晚一个 microtask 变为同步）。当前的公共合同没有约束这一点，但如果有下游依赖这个时序，需要留意。

## 9. 第二轮：实施、真实浏览器验证与修正

### 9.1 做了什么

执行方式：lead 负责拆任务、派发和独立验收。实现交给外部 agent（copilot 配额耗尽、cursor 账单受阻后，改用 codex gpt-6-astra xhigh），每个 agent 在独立克隆里工作。lead 按顺序集成，每次集成后都跑门禁，并自己复测性能，不直接采用 agent 的自报数字。

| 项                                             | 结果                                                                                                      | 依据                                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| patch 0001–0010                                | 已应用                                                                                                    | 改动前的完整工作区备份在 `refs/backup/perf-before-2026-10-01`                                                                                                |
| 0006/0007 测试加固                             | 新增 66 个测试，每个都做过反向验证（改坏代码时确实失败）                                                  | 发现 0006 的两处回归：transform 同步 abort 后再返回 reject 的 Promise，会产生未处理的 rejection；同步 abort 后返回的值仍会被投递。**两处已修复**，并补了测试 |
| N1 默认 handle 整块读 body                     | 实施，只对库的默认 handle 生效（按函数身份识别）                                                          | 44 个用例的共享套件在 Bun、Chromium、Firefox 各跑一遍，并用真实服务器做差分测试                                                                              |
| N2 struct parse 协议重写                       | 实施                                                                                                      | 66 个特征测试（65 个在旧解析器上也通过）；57 个变异体全部被杀死                                                                                              |
| N3 原生 `indexOf` 行扫描                       | **未采用**                                                                                                | 已实现并做了 6 次配对测量：Node 慢 4%～10%，Bun 快 3%～6%，不满足"更快才保留"                                                                                |
| N4 默认 handle 不再二次构造 `Request`          | 实施                                                                                                      | 同 N1 的套件。副作用：修复了一个 Firefox 老问题（旧代码经 `request.body` 取消上传流，而 Firefox 的 `Request.body` 为 `undefined`，所以从未取消）             |
| N5 fault 保持为 Error                          | 保留                                                                                                      | 设计取舍，需要栈信息来调试                                                                                                                                   |
| N6 Headers 写时复制                            | 保留                                                                                                      | 会改变 `init.headers` 的对象身份，属于可观察的行为变化                                                                                                       |
| N7 去掉 `AbortSignal.any`，改为显式转发 + 释放 | 实施                                                                                                      | 12 个生命周期测试，检查调用方 signal 上 listener 的 add/remove 配平                                                                                          |
| N8 SSE 组合信号去重                            | 实施                                                                                                      | 同上                                                                                                                                                         |
| D1–D4 去重                                     | 实施：共享 `internal/fetch.ts`、`bytes.ts`、`media_type.ts`、`media_type_parameters.ts`、`type_guards.ts` | 第一版把 SSE 专用的参数语法校验拉进了 HTTP 路径，HTTP-only 包 +973 B（任务书的问题）；返工后，参数校验成为只有 SSE 引用的独立模块                            |
| D5 http.ts 基础 controller                     | 保留                                                                                                      | 请求既没有调用方 signal 也没有 timeout 时，它就是该请求自己的 signal，并不是死代码                                                                           |
| 真实浏览器 bench                               | 新增 `bench/browser/run.mjs`（`pair` 和 `memory`，基于 Playwright）                                       | 相同源码的对照组比值在 ±1% 左右                                                                                                                              |

门禁：core 测试从 1492 个增加到 **1774 个**，覆盖率 100%；整仓 `bun run verify` 通过（EXIT=0，含文档站构建和 packed consumer）。生产代码改动 30 个文件，测试改动 17 个文件（+2913 行）。

### 9.2 最终对比：原始代码 vs 全部改动

同进程配对测量，取中位数。原始数据见 `results/round2/`。

| 场景                                   | Node                   | Bun        | Chromium        | Firefox    | WebKit          |
| -------------------------------------- | ---------------------- | ---------- | --------------- | ---------- | --------------- |
| `ping-no-decl`                         | −38.3%                 | −21.7%     | −17.7%          | +0.5%      | −23.7%          |
| `get-small`                            | **−37.0%**             | −18.2%     | −6.9%           | −21.6%     | −17.8%          |
| `get-small-timeout`                    | **−42.4%**             | −12.7%     | −11.4%          | −19.3%     | +1.0%（噪声内） |
| `get-small-2-interceptors`             | −37.6%                 | −21.7%     | −4.3%           | −21.0%     | −23.9%          |
| `get-query`（decode 失败路径）         | −35.1%                 | **−81.2%** | −16.0%          | −21.5%     | −21.7%          |
| `post-json`                            | −37.7%                 | −17.4%     | −10.1%          | −21.9%     | −21.0%          |
| `post-order-50`                        | −43.5%                 | −51.9%     | −33.6%          | −19.2%     | −43.2%          |
| `error-404-declared`                   | −35.7%                 | −13.7%     | −11.1%          | −22.6%     | −26.6%          |
| `get-list-1000`                        | −6.0%                  | −32.7%     | −26.8%          | −7.7%      | −30.2%          |
| `struct-decode-1000`                   | −7.9%                  | **−50.2%** | +1.1%           | −10.4%     | −45.5%          |
| `struct-decode-1000+read`              | −27.6%                 | −48.1%     | −34.4%          | −15.6%     | −43.1%          |
| `sse-2000-events`                      | −57.4%                 | −57.3%     | −60.2%          | **−90.4%** | −59.7%          |
| `ws-2000-messages`                     | −47%～−82%（两次运行） | −53.2%     | −55.3%          | −59.6%     | −59.0%          |
| `net-get-small`（真实 loopback）       | −12.3%                 | −25.6%     | −3.1%           | 0.0%       | +0.9%           |
| `net-get-list`（真实 loopback，85 KB） | **+4.6%**              | −30.4%     | +2.5%（噪声内） | −3.3%      | −9.0%           |

常驻内存（6 万次请求 / 1.5 万个 SSE 流，每轮之后多次 GC）：

| 场景                       | Node 原始 → 最终                                           | Bun 原始 → 最终     | Chromium（CDP）原始 → 最终 |
| -------------------------- | ---------------------------------------------------------- | ------------------- | -------------------------- |
| HTTP `{ timeout }`         | +94.4 MB → +23 KB                                          | +20.6 MB → +28 KB   | **+77.8 MB** → +1.2 MB     |
| HTTP `{ signal }`          | +69.5 MB → +1.3 MB（12 万、20 万次时封顶并回落，不是泄漏） | +10.5 MB → +0.17 MB | +46.1 MB → +0.8 MB         |
| HTTP `{ signal, timeout }` | +107.6 MB → −1.4 MB                                        | +20.6 MB → +32 KB   | +81.2 MB → +0.3 MB         |
| SSE `{ signal }`           | +17.0 MB → +0.35 MB                                        | +2.7 MB → +0.11 MB  | +11.6 MB → +1.3 MB         |
| 解码对象常驻 / 个          | 246 → 62 B                                                 | 74 → 75 B           | 144 → 52 B                 |

Chromium 修复后的 0.3～1.3 MB 在对照组的噪声带（±1.4 MB）之内。

包体积（`bun build --minify --target=browser`，字节）：

| 入口        | 原始                  | 最终                              |
| ----------- | --------------------- | --------------------------------- |
| 只用 HTTP   | 80,113（gzip 24,614） | **50,873（gzip 15,809），−36.5%** |
| 全量        | 82,570（gzip 25,264） | 84,630（gzip 26,349），+2.5%      |
| 只用 struct | 17,647                | 17,794，+0.8%                     |

每次请求（`get-small`）：Promise 81 → 55，`Promise.race` 5 → 2，`AbortSignal.any` 1 → 0，listener 的 add/remove 从 8/7（不配平）变为 5/5，`new URL` 3 → 2。

### 9.3 对前文的修正

1. **P0 泄漏不是 Node 特有。** 前文说"浏览器下长期 signal 也会泄漏"是推断；实测 Chromium 下，**只设 `timeout`** 6 万次请求就泄漏 +77.8 MB，范围比推断的更大。第 3 节 P0 的根因描述仍然成立：永不移除的 listener 让组合信号被常驻引用。
2. **V2（0010）在浏览器里的收益与 Node 不同。** 单独衡量时，Chromium 解码 +5.2%、Firefox 解码 +11.2%；"解码后读取"在 Chromium 只快 2.6%，远不到 Node 的 24%。内存收益在 Chromium 成立（144 → 52 B）。合并 N2 之后，三个浏览器的解码都是持平或更快，所以 V2 保留。
3. **N1 在 Node 下，大 body 场景有轻微代价**（`net-get-list` +4.6%；A 任务自测为 +0.4%～+3.2%）。小 body 在 Node 下 −12%；Bun 下大、小 body 都是 −26%～−30%；浏览器里由网络耗时主导，基本持平。
4. 0006 的 `onInvalidEvent` 时序变化现在有测试锁定（同步处理，异步回调会阻塞后续事件）；0006 的两处回归已修复。

### 9.4 复现

```sh
cp -R packages/core/src "${TMPDIR:-/tmp}/core-src-before"   # 或者用 git archive refs/backup/perf-before-2026-10-01 取出原始代码
docs/perf/2026-10-01/bench/bench.sh pair <before-src> packages/core/src [scenario...]
docs/perf/2026-10-01/bench/bench.sh pair <before-src> packages/core/src net-get-small net-get-list
node docs/perf/2026-10-01/bench/browser/run.mjs pair <before-src> packages/core/src [--browsers chromium,firefox,webkit] [scenario...]
node docs/perf/2026-10-01/bench/browser/run.mjs memory <before-src> packages/core/src
docs/perf/2026-10-01/bench/bench.sh leak packages/core/src
```

WebKit 列使用 Playwright 1.63 对应的 WebKit 构建 2359（WebKit 26.6），原始数据见 `results/round2/pair-webkit-2359.txt`；`pair-browsers.txt` 中较早的 WebKit 数据来自构建 2336，两次结果一致。测量期间机器负载在 6～10（有其他任务并行），`get-list-1000` 这类场景在浏览器里的 p25–p75 较宽。
