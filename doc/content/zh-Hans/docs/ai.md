---
title: "Skill"
description: "安装 Defjs skill，让助手编写带类型的 GET 操作，并按项目已安装的 SDK 核对结果。"
---

# Skill

Defjs skill 让助手了解 SDK 定义与应用执行的契约。支持 Skill 的助手可以在相关任务中加载它；是否自动加载取决于所用工具。

## 安装 skill [#install]

在需要使用 Skill 的项目里运行下面的命令。CLI 默认安装到当前项目，可能自动检测当前 Agent，也可能让你选择；可用 `-a` 明确指定。

```sh
bunx skills add defjs/defjs --skill defjs
```

发布之后，可以在 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) 阅读 skill 说明。GitHub 上的源码是默认分支，可能与项目里已安装的 `@defjs/core` 版本不同。

## 提出一个操作 [#prompt]

给助手一个任务。下面这段提示要求一个带类型的 `GET /orders/:id`，并且 Client 留在应用里：

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 核对结果 [#verify]

分别阅读定义和应用。定义导出操作，不创建 Client。应用创建 Client 并调用操作，例如 `getOrder(client, { id: 1 })`。声明了 `input` 时，`builder` 是显式的同步纯函数。只有 error 槽为空后才使用成功值：调用处在调用后立即检查 `if (err)`，并在该块内部返回；可能失败的辅助函数返回自己的 `[err, value]` 元组，而不是记录日志或返回 `undefined`。

然后运行该项目自己的类型检查，以及真正执行这份契约的测试。依赖安装和 CI 规则留在那个项目里。
