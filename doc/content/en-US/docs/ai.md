---
title: "AI-assisted development"
description: "Install the Defjs skill, ask for a typed GET endpoint, and check the result against the installed SDK."
---

Asking an assistant to write Defjs code and calling an AI service from an application are different tasks. This page is the assistant workflow. [Calling AI APIs](/docs/ai-api) is the application workflow. A supported assistant may load the installed skill when relevant; activation depends on the tool.

## Install the skill [#install]

The skills CLI requires Node.js 22.20 or later. That requirement belongs to the installer. It is not the `@defjs/core` runtime. The runtime is described in [Quick start](/docs/start).

Run the command in the project that should receive the skill. The CLI installs to the current project by default and may detect the current agent or ask you to choose one; use `-a` to select an agent explicitly.

```sh
npx skills add defjs/defjs --skill defjs
```

After publication, the skill instructions can be read at [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). The GitHub source is the default branch and may not match the `@defjs/core` version installed in a project.

## Ask for one endpoint [#prompt]

Give the assistant a task. This prompt asks for a typed `GET /users/:id` whose client stays in the application:

```txt
Use @defjs/core to define GET /users/:id.
The input is { id: number }; a successful response is { id: number, name: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Check the result [#verify]

Read the definition and the application separately. The definition exports the operation and does not create the client. The application creates the client and calls the operation, for example `getUser(client, { id: 1 })`. Where `input` is declared, `builder` is an explicit synchronous pure function. The success value is used only after the error slot is empty.

Then run that project's typecheck and the tests that cover the contract. Dependency installation and CI rules stay with that project.

## English Markdown for assistants [#resources]

The guides, examples, and API overviews on this site are written for people and exist in every locale. These three addresses are generated from the English pages only. They have no locale prefix, and they are not translations of the page you are reading.

- [English page index](/llms.txt) lists English pages and links to their website URLs.
- [Compiled English guides](/llms-full.txt) joins those pages into one file.
- [Quick start as Markdown](/llms.mdx/docs/start/content.md) is the English text of one page. Every other English page uses the same shape, `/llms.mdx/…/content.md`.

Read [Quick start](/docs/start) when you want that guide in this locale. Point the assistant at the Markdown address when it should follow the API. The assistant still has to obey the `@defjs/core` version installed in the project: this site's documentation can differ from the installed release, so verify the APIs against that version. The GitHub source of the documentation is the default branch and may not match that installed version either. Remove secrets and check your project's policies before sharing code or context with an AI tool.
