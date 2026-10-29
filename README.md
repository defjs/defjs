<p align="center">
  <a href="https://defjs.lyz.cloud" target="_blank" rel="noopener noreferrer">
    <img width="200" src="logo.jpg" alt="Defjs logo">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/v/%40defjs%2Fcore?color=%23000&style=flat-square" alt="npm package"></a>
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/dm/%40defjs%2Fcore?color=%23000&style=flat-square" alt="monthly downloads"></a>
  <a href="https://github.com/defjs/defjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/defjs/defjs/ci.yml?branch=main&color=%23000&style=flat-square" alt="build status"></a>
  <a href="https://github.com/defjs/defjs/blob/main/LICENSE"><img src="https://img.shields.io/github/license/defjs/defjs?color=%23000&style=flat-square" alt="license"></a>
</p>
<br/>

**Designed for better SDKs.**

Define reusable TypeScript APIs for HTTP, SSE, and WebSocket. Let each application own its client.

For complete guides, examples, and the API reference, visit **[defjs.lyz.cloud](https://defjs.lyz.cloud)**.

## Quick start

```bash
npm install @defjs/core
```

Best practice: keep the definition independent of the client. Calling it creates a command; name that command, execute the name, and return from the function when the error-first tuple is set.

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const command = getUser({ id: 1 });
  const [error, user] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}

void main();
```

## License

[MIT](LICENSE)
