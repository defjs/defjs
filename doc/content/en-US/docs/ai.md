---
title: "Skill"
description: "Install the Defjs skill, ask for a typed GET operation, and check the result against the installed SDK."
---

The Defjs skill gives an assistant the SDK definition and application execution contract. A supported assistant may load it for a relevant task; automatic activation depends on the tool.

## Install the skill [#install]

Run the command in the project that should receive the skill. The CLI installs to the current project by default and may detect the current agent or ask you to choose one; use `-a` to select an agent explicitly.

```sh
bunx skills add defjs/defjs --skill defjs
```

After publication, the skill instructions can be read at [skills/defjs/SKILL.md](https://github.com/defjs/defjs/blob/main/skills/defjs/SKILL.md). The GitHub source is the default branch and may not match the `@defjs/core` version installed in a project.

## Ask for one operation [#prompt]

Give the assistant a task. This prompt asks for a typed `GET /orders/:id` whose client stays in the application:

```txt
Use @defjs/core to define GET /orders/:id.
The input is { id: number }; a successful response is { id: number, status: string }.
Keep the SDK definition and application client in separate modules,
and verify the result with the project’s existing tests.
```

## Check the result [#verify]

Read the definition and the application separately. The definition exports the operation and does not create the client. The application creates the client and calls the operation, for example `getOrder(client, { id: 1 })`. Where `input` is declared, `builder` is an explicit synchronous pure function. The success value is used only after the error slot is empty.

Then run that project's typecheck and the tests that cover the contract. Dependency installation and CI rules stay with that project.
