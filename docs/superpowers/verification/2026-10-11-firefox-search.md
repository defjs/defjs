# Firefox 搜索等待条件修复

日期：2026-10-11。工作区：`/Users/munmunmiao/Documents/web/zen-kit`。本次只调整文档站的 hydration 标记和浏览器测试，保留工作区已有的 Fumadocs 迁移与 OpenTelemetry Logger 改动。

## 根因及证据

### 1. 网络空闲不代表快捷键监听器已经安装

原测试在 `page.goto(..., { waitUntil: 'networkidle' })` 后立即发送 `Control+k`。Firefox 复现记录显示：页面时钟 786 ms 和 826 ms 时分别收到 Control 与 k，此时注册的 `keydown` 监听器数为 0；到 1,080–1,092 ms 才完成监听器安装。第一次快捷键丢失，搜索对话框等待超时。在同一页面稍后再次按键，对话框正常打开。

这证明测试误把网络状态当作 React hydration 和 passive effects 完成的信号。该行为也符合 [Playwright 官方 hydration 说明](https://playwright.dev/docs/navigations#hydration)。诊断监听器计数只用于取证，不作为正式测试的等待条件。

修复：`doc/app/root.tsx` 在 Layout 的 `useEffect` 中设置 `body[data-hydrated="true"]`；整站交互测试先等待该标记。当前 SearchProvider 是 Layout 的同步子树，其快捷键 effect 在 Layout effect 之前安装。静态 HTML 和无 JavaScript 阅读不受该标记影响。

原始证据：`.superpowers/sdd/2026-10-11-firefox-search/04-search-keys.log`。

### 2. 搜索跳转断言在原页面就已成立

旧 `waitForURL` 只判断语言前缀；例如 `/zh-Hans/docs/start` 在搜索前就符合条件。Fumadocs 选择结果后会立即关闭对话框，目标页面 loader 此时可能仍在请求中。两个等待条件都通过不代表导航已完成。

回归测试拦住选中结果对应的 `.data` 请求：浏览器仍停留在 `/docs/start`，旧 helper 已完成，`expect(finished).toBe(false)` 实际收到 `true`。

修复：从 `aria-selected` 搜索结果读取准确目标 URL，发送 Enter 后等待该 URL。回归测试要求 loader 被阻塞时 helper 保持 pending，释放后导航到选中的目标。

原始证据：`.superpowers/sdd/2026-10-11-firefox-search/06-search-red.log`。

### 3. 旧错误记录会丢失诊断信息

原测试收到 console 事件后异步 `evaluate` 参数，整页导航可能先销毁这些 JSHandle，因此出现次生的 `Execution context was destroyed`。此外，Firefox 的原生 `Error.stack` 只有调用帧，单独选择 stack 会丢失 message；新增诊断测试实际复现了这一差异。

修复：在页面内部同步把 Error 的 name、message、stack 转成字符串，再由 Playwright 收集并立即输出到测试日志，后续断言超时也不会丢掉这些信息。两浏览器回归验证刷新后仍保留原始错误消息和命名函数调用帧。首次完整 verify 中 React Router 异常的原始内容已经丢失，不能据此推断具体 React/Fumadocs 缺陷，也不能声称已还原那个异常。

原始证据：`.superpowers/sdd/2026-10-11-firefox-search/08-regressions-green.log`（5 通过、Firefox 诊断用例 1 失败）。

## 验证

| 检查                              | 结果                                               | 日志                       |
| --------------------------------- | -------------------------------------------------- | -------------------------- |
| 修复前 Firefox 搜索回归           | 2 失败，分别命中缺失 hydration 信号与导航提前完成  | `06-search-red.log`        |
| 文档重新构建                      | 退出 0；2,279 页链接检查通过                       | `07-build.log`             |
| Chromium + Firefox 搜索与诊断回归 | 退出 0；6 通过、0 失败、20 断言                    | `09-regressions-green.log` |
| 完整 `bun run verify`             | 退出 0；文档浏览器测试 21 通过、0 失败、2,240 断言 | `10-verify.log`            |

完整验收同时通过 lint、格式检查、Core 1,780 / OpenTelemetry 274 / React 12 / Vue 14 项测试及各库 100% 覆盖率、32 项文档单元测试、根项目 257 和文档项目 160 个文件的类型检查、1,062 个完整示例（86 个不同上下文）、库与文档构建、2,279 页链接检查。原 Firefox 整站用例实际完成，用时 36.47 秒；全部文档浏览器测试用时 122.47 秒。最终诊断测试额外检查命名函数调用帧，纳入这次完整验收。

独立代码审查确认 effect 时序与准确 URL 等待；发现的请求等待超时、Firefox message 丢失及堆栈断言缺口均已处理。最终修改文件的定向 lint、格式检查与文档项目类型检查也通过。

日志均位于本地 `.superpowers/sdd/2026-10-11-firefox-search/`。没有新增固定延时、自动重试、强制点击、错误过滤或浏览器跳过；保留原测试超时与覆盖范围。没有新增依赖或修改 OTel 库实现。

未执行远程 CI、提交、推送或部署。
