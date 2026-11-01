---
title: "AI 辅助开发"
description: "安装 Defjs skill，让助手编写类型化的 GET 端点，并按项目已安装的 SDK 核对结果。"
---

让助手编写 Defjs 代码，与从应用调用 AI 服务，是两件不同的事。本页是助手工作流。[调用 AI API](/zh-Hans/docs/ai-api) 是应用侧的工作流。支持 Skill 的助手可以在相关任务中加载它；是否自动加载取决于所用工具。

## 安装 skill [#install]

skills CLI 需要 Node.js 22.20 或更高版本。这个要求属于安装器，不是 `@defjs/core` 的运行时。运行时见[快速开始](/zh-Hans/docs/start)。

在需要使用 Skill 的项目里运行下面的命令。CLI 默认安装到当前项目，可能自动检测当前 Agent，也可能让你选择；可用 `-a` 明确指定。

```sh
npx skills add defjs/defjs --skill defjs
```

发布之后，可以在 [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md) 阅读 skill 说明。GitHub 上的源码是默认分支，可能与项目里已安装的 `@defjs/core` 版本不同。

## 提出一个端点 [#prompt]

给助手一个任务。下面这段提示要求一个类型化的 `GET /users/:id`，并且 client 留在应用里：

```txt
Use @defjs/core to define GET /users/:id.
The input is { id: number }; a successful response is { id: number, name: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## 核对结果 [#verify]

把定义和应用分开读。定义导出操作，不创建 client。应用创建 client 并调用操作，例如 `getUser(client, { id: 1 })`。声明了 `input` 时，`builder` 是显式的同步纯函数。只有 error 槽为空时才使用成功值。

然后运行该项目自己的类型检查，以及真正执行这份契约的测试。依赖安装和 CI 规则留在那个项目里。

## 给助手的英文 Markdown [#resources]

本站的指南、操作示例和 API 概览是写给人看的，每种语言都有自己的正文。下面三个地址只从英文页面生成。它们没有语言前缀，也不是你正在读的这页的译文。

- [英文页面索引](/llms.txt) 列出英文页面并链接到对应网页。
- [汇编后的英文指南](/llms-full.txt) 把这些页面合成一个文件。
- [快速开始的 Markdown](/llms.mdx/docs/start/content.md) 是其中一页的英文正文。其他英文页面使用同样的形状：`/llms.mdx/…/content.md`。

要看本语言的指南，读[快速开始](/zh-Hans/docs/start)。要让助手对齐 API，把 Markdown 地址交给它。助手仍须遵守项目里已安装的 `@defjs/core` 版本：站点文档可能与已安装的版本不同，应核对该版本的 API。文档的 GitHub 源码也是默认分支，同样可能与已安装版本不同。向 AI 工具提供代码或上下文之前，先移除密钥并确认项目的数据使用政策。
