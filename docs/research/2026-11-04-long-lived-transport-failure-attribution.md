# 长连接传输失败归因修正

- 日期：2026-11-04。
- 对象：多端点负载均衡 PR，原基线 `964e96c3`。
- 范围：修正 SSE 和 WebSocket 的最终传输反馈，并同步公开说明；不新增策略、配置、故障码或依赖。
- 本记录说明本轮采用的行为选择，不重写此前设计与实践记录，也不把研究建议冒充原有契约。

## 1. 现场问题

两个真实后端 A/B，B 正常提供业务数据。A 每次握手成功、调用方消费第一条消息后异常断开，但保持监听。

- SSE 在 Node 26 和 Bun 1.4.4 中都会重新选台，却仍连续三次选 A。其 `done` 保留握手的 `status: 200`，没有向默认 pick-first 提供失败条件。
- Bun WebSocket 在该场景只有 `close(1006, wasClean: false)`，没有原生 `error`；原分类只检查 `opened` 和 `cause`，也把该次尝试记成非失败。Node 在相同实验中产生 `error`，随后能够到 B。
- 公开 SSE 指南称重连 URL 保持不变，但实际 base endpoint 可以重选。客户端指南又把 `done` 描述为包含最终读体失败，与旧 SSE 握手快照规则矛盾。

这些观察不等于所有异常关闭都证明后端持续不健康，也不等于每次断连都必须重连。物理失败样本、重连资格与最终逻辑会话结果应分别处理。

## 2. 联网核验的依据

### 2.1 WebSocket：关闭握手与应用关闭码不同

[RFC 6455 §7.1.4](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.1.4) 把完成 WebSocket 关闭握手之后的 TCP 关闭定义为 clean；[§7.1.5](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.1.5) 与 [§7.4.1](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1) 将没有 Close 帧的异常关闭表示为本地状态 1006。1006 不得由对端写入 Close 帧。

[WHATWG WebSockets 固定快照 `7f25d7dc`](https://websockets.spec.whatwg.org/commit-snapshots/7f25d7dc8c2598ebca795ce4af68909d913a3888/) 分别定义 error 与 close 事件，以及 `wasClean`、`code`。不能把所有非 1000 关闭码当成传输失败；RFC §7.4 明确把对关闭原因采取何种动作留给应用。

[engine.io-client 6.6.0](https://github.com/socketio/engine.io-client/blob/a17cbc5418d3c2d6043b38e8b5d5d19fbefb0c3e/lib/transports/websocket.ts#L82-L88) 独立处理 close 与 error，并保留 CloseEvent。这支持不只依赖 error 事件，但其重连层并未定义 Defjs 的端点健康策略，不能照搬成任意关闭码的驱逐规则。

### 2.2 SSE：释放负载不代表流已成功结束

[Linkerd `release/v2.372.0` 的 EOS 分类](https://github.com/linkerd/linkerd2-proxy/blob/a901f208c336bf16a993fd80997d6119ceb912c6/linkerd/app/core/src/classify.rs#L170-L202) 在正常 EOS 保留暂存的 HTTP 分类，而 EOS error 进入独立的 `Class::Error`；该类在 [同文件的失败判据](https://github.com/linkerd/linkerd2-proxy/blob/a901f208c336bf16a993fd80997d6119ceb912c6/linkerd/app/core/src/classify.rs#L239-L243) 中属于失败。

[Linkerd 的负载释放](https://github.com/linkerd/linkerd2-proxy/blob/a901f208c336bf16a993fd80997d6119ceb912c6/hyper-balance/src/lib.rs#L105-L116) 与上述分类分开。[tower 0.5.2 的 `CompleteOnResponse`](https://github.com/tower-rs/tower/blob/7dc533ef86b02f89f3dc5fe64644dd1a5dc3b37d/tower/src/load/completion.rs#L88-L95) 仅释放负载 handle 并返回响应，不提供“后续流错误应忽略”的依据。

[Azure fetch-event-source 2.0.1](https://github.com/Azure/fetch-event-source/blob/1589ec1f49d96450f3bae9adb20ab4a5b3deb204/src/fetch.ts#L94-L139) 区分取消、正常完成和错误重试；其通用 catch 也接收应用回调异常。因此不能把所有 catch 错误直接转换为端点失败，必须在 [`reader.read()` 边界](https://github.com/Azure/fetch-event-source/blob/1589ec1f49d96450f3bae9adb20ab4a5b3deb204/src/parse.ts#L22-L28) 保留错误来源。

这里借鉴的是机制分离，不是声称 Linkerd 默认 SSE 换台政策与 Defjs 相同。没有沿 Linkerd 的全部 breaker 接线验证默认驱逐行为。

## 3. 本轮采用的规则

### SSE

- 成功握手后的响应流读取拒绝，属于本次物理尝试的传输反馈。普通读取失败报告 `done({ attempted: true, code: "NET_UNREACHABLE" })`，不附 status；已知取消、截止和离线边界沿用既有映射与优先级。
- `end` 仍在响应头到达时释放负载，已经发送的状态不被后续错误修改。`open` 继续保留握手元数据。
- 只观察读取边界，不从 `getReader`、解析、结构验证、队列上限、transform/observer、onopen/onclose 或重连政策回调自身的失败生成新的网络失败样本。
- 真实读取失败发生后，后续重连政策拒绝或抛错不撤销、也不重复已发生的物理失败。
- 正常 EOF 保留原状态并终止；不将 EOF 改成无限订阅，不扩大流请求体或非幂等方法的重放资格。

这有意改变此前“所有读体错误都保留握手快照”的规则。自定义 balancer 所见的 `done`、默认 pick-first 后续选台和被动健康计数会相应变化。有限 HTTP body 的 `NET_BODY_INCOMPLETE` 及默认排除规则不变。

### WebSocket

优先保留手工关闭、调用方取消/截止和握手超时的原映射。对于仍可归因的已打开连接：

- 原生 cause 继续按既有规则分类。
- `code === 1006` 或明确 `wasClean === false` 的关闭，即使没有原生 error，也报告 `NET_UNREACHABLE`。1006 本身是异常标记；缺失 `wasClean` 不能当成 false。
- 干净的 1000、1001、1005、1011、1012、1013 或应用 4xxx 关闭，不因码值本身增加失败样本。
- 本地取消/close 优先于其伴随的异常关闭事件。error 与 close 同时出现仍只记一次。

该规则修正 balancer 反馈，不合成第二个 DOM error，不改 `shouldReconnect`、每次中断的预算或最终 `session.closed.kind` 政策。一次失败只按既有 pick-first/健康策略处理，不代表立即永久摘除端点。

## 4. 不变的边界

- 默认重连开关、次数、退避、抖动、open 后预算重置、HTTP retry budget 及失败阈值不变。
- start/end/done 的一次性责任、p2c 的 headers/open 负载完成点、首个 next 与改址归因不变。
- 调用方继续拥有取消与资源关闭责任；逻辑 closed 不等于所有物理 TCP 已结束。
- 跨副本事件日志、cursor 适用性、origin 相关认证与应用去重仍由应用保证，不提供 exactly-once。
- SSE builder/interceptor 每逻辑调用一次，后续重连复用 method、相对 path/query、headers/body；仍归因时重新选择 base endpoint，所以完整 URL/origin 可以改变。

## 5. 验证要求

回归必须先在旧实现上出现行为断言失败，再验证新实现；不能用编译错误、夹具错误或等待超时替代红灯。正例覆盖成功握手后断流的默认选台恢复与一次性反馈；负例覆盖正常 EOF/干净关闭、调用方取消/截止、应用/解析错误、离线与改址。

真实网络验证使用消费消息后的故障注入，并同时运行 Node 与 Bun。公开 TSDoc、当前手册与 11 个 locale 指南同步，生成 API 数据后按仓库六道闸门验收。历史设计与原实践记录保留，不改写其当时结论。
