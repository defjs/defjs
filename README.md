## 🚧 Coming soon 1.0 design

[design.md](design.md)

---

<p align="center">
  <a href="https://github.com/defjs/defjs" target="_blank" rel="noopener noreferrer">
    <img width="200" src="logo.jpg" alt="logo">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/v/%40defjs%2Fcore?color=%23000&style=flat-square" alt="npm package"></a>
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/dm/%40defjs%2Fcore?color=%23000&style=flat-square" alt="monthly downloads"></a>
  <a href="https://github.com/defjs/defjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/defjs/defjs/ci.yml?branch=main&color=%23000&style=flat-square" alt="build status"></a>
  <a href="https://github.com/defjs/defjs/blob/main/LICENSE"><img src="https://img.shields.io/github/license/defjs/defjs?color=%23000&style=flat-square" alt="license"></a>
  <a href="https://codecov.io/gh/defjs/defjs"><img src="https://img.shields.io/codecov/c/gh/defjs/defjs?color=%23000&style=flat-square" alt="codecov"/></a>
</p>
<br/>

## Introduction

`def` is an abbreviation for `define`, so it can be read as `define js`.

Defjs is a library that helps you define and initiate requests, aiming to make it easier for you to define requests without worrying about the details.

-	Supports multiple request methods such as [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API), [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest), custom, etc.
-	Functional API.
-	🚧 Supports streaming. (WIP)
-	Supports JS/TS with complete type.
-	Supports any JS runtime.
-	Supports Interceptors.
-	Supports ESM
-	🚧 Supports Mini Programs. (WIP)

## Quick Start

> Use for package manager
```shell
npm install @defjs/core
// or
yarn install @defjs/core
// or
pnpm install @defjs/core
// or
bun install @defjs/core
```

> Use for CDN

**Only can use ES modules**

```javascript
import {
  createGlobalClient,
  defineRequest, 
  field
} from 'https://unpkg.com/@defjs/core/index.min.js';

/**
 * @title Step 1
 * @file src/main.ts
 * @description Setting up a global client
 */
createGlobalClient({
  host: 'https://example.com',
});

/**
 * @title Step 2
 * @file src/lib/api/user.ts
 * @description Define the request api request in the lib/api directory of the project
 */
const useGetUser = defineRequest('/v1/user/:id')
  .withField({
    id: field<number>().withParam()
  })

/**
 * @title Step 3
 * @file src/pages/home.ts
 * @description Use defined requests in business code
 */
const { doRequest } = useGetUser();
const { error, body } = await doRequest({id: 1});
if (error) {
  console.error(error);
  return;
}
console.log(body);
```

## Documentation

Check out the [🚧 defjs.org](https://defjs.org) to get started.

## Packages

| Package                      | Version                                                                                      |
|------------------------------|:---------------------------------------------------------------------------------------------|
| [@defjs/core](packages/core) | ![core version](https://img.shields.io/npm/v/%40defjs%2Fcore?color=%23000&style=flat-square) |
| [@defjs/angular](packages/angular) | ![core version](https://img.shields.io/npm/v/%40defjs%2Fangular?color=%23000&style=flat-square)     |

## Roadmap

- Documentation official website
- Wechat mini programs handler
- CLI Tool
  - Generate API from OpenAPI
  - Generate Full SDK Package (Like the [S3 SDK](https://www.npmjs.com/package/@aws-sdk/client-s3))
- Vue wrapper package
- React wrapper package
- Think about simplifying useXXX and doRequest

## License

[MIT](LICENSE)

## Reference

- [Angular HttpClient](https://angular.dev/guide/http)
- [Axios](https://axios-http.com)
- [Zod](https://zod.dev)
- [Deepkit Framework](https://github.com/deepkit/deepkit-framework)
- [tRPC](https://trpc.io)
- [Google API design guide](https://cloud.google.com/apis/design)
- [Tanstack Query](https://tanstack.com/query)
- [Rxjs](https://rxjs.dev)
