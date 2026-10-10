---
title: HTTP
description: Define una solicitud, ejecútala, ramifica por estado y cancela con signal o timeout.
---

# HTTP

Define → execute → ramifica en la tupla → cancela cuando la pantalla se va. Ese es todo el bucle HTTP.

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const [error, data, response] = await client.execute(getUser({ id: 7 }))
if (error?.code === 'HTTP_STATUS' && error.status === 404) {
  console.log(error.data.message)
} else if (!error) {
  console.log(data.name, response.status)
}
```

## Resolver la URL

`withEndpoint(...)` necesita una URL absoluta válida. El pathname del endpoint se queda como directorio; query y hash se descartan antes de la resolución del comando.

```ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com/v1'))
const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    id: struct.string(),
    fields: struct.string().optional(),
  }),
  builder: (input) => ({ path: { id: input.id }, query: { fields: input.fields } }),
})

const command = getUser({ id: 'a/b', fields: 'name' })
void client.execute(command)
// → https://api.example.com/v1/users/a%2Fb?fields=name
```

Los placeholders de path son escalares en bruto, codificados exactamente una vez. Se rechazan valores vacíos y `.` / `..`. Barras, `?`, `#`, `%`, espacios y Unicode en un placeholder se quedan en un segmento codificado — no pre-codifiques.

El path de la definición no puede contener `?` ni `#`, ni ser absoluto o protocol-relative. El encoder de query por defecto acepta escalares y arrays de escalares (los arrays repiten la clave). Un objeto anidado falla con `REQ_BUILD_FAILED` salvo que el cliente tenga `withQuerySerializer(...)`. `null` en `path`, `query` o `headers` falla igual. `undefined` se omite.

## Colocar el input

El struct codifica el valor. El builder lo coloca. Declarar `input` siempre exige un `builder` explícito, aunque la entrada ya tenga la forma de la solicitud. Solo las definiciones sin `input` pueden omitir `builder`.

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
    headers: struct.object({ requestId: struct.string().alias('x-request-id') }),
    body: struct.object({
      displayName: struct.string().alias('display_name'),
    }),
  }),
  builder: (input) => ({
    path: input.path,
    headers: input.headers,
    body: input.body,
  }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})

const [error, user] = await client.execute(
  updateUser({
    path: { id: 7 },
    headers: { requestId: 'request-42' },
    body: { displayName: 'Ada' },
  }),
)
if (error) console.error(error.code)
else console.log(user.id)
```

Ese body es `{"display_name":"Ada"}` con `application/json`. El nombre de cable de la cabecera es `x-request-id`. Quien llama y los resultados parseados conservan `displayName`.

Prefiere pasar el valor tipado a escribir claves de cable. El alias se declara una vez en el campo y aplica en ambas direcciones: `output` / `error` / eventos / frames entrantes decodifican `display_name` a `displayName`, y `body: input.order` reescribe el árbol entero. El mismo struct `User` puede ser un body de create y un output de get. Una clave escrita a mano es la excepción: el objeto padre es anónimo, así que el alias no corre.

| Expresión del builder                           | En el cable                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `body: input.profile`                           | Objeto tipado: alias y codificación de `Date` / `bigint`           |
| `body: { profile: input.profile }`              | Claves exteriores literales, el objeto interno sigue tipado        |
| `body: { ...input.profile, role: 'admin' }`     | El spread conserva el struct; la clave extra es literal            |
| `body: { name: input.profile.displayName }`     | Padre anónimo: el alias no aplica                                  |
| `query: input.query` / `headers: input.headers` | Objetos planos tipados: el alias se convierte en la clave de cable |

Hacer spread de un objeto tipado y además fijar su clave de cable (`display_name` junto a `displayName`) es `REQ_BUILD_FAILED`. Un objeto anidado en `path` o `headers` falla igual.

La guía se elige en cada nodo, no solo en la raíz. Un objeto nuevo bajo un padre anónimo conserva las claves que escribiste. El mismo objeto bajo un padre tipado usa el struct de ese campo.

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

Cuando una guía union coincide con más de una rama, cada rama se codifica y se compara. Una salida de cable idéntica se conserva; una diferencia es `REQ_BUILD_FAILED`.

Una intersección mixta que contiene una parte que no es un objeto queda etiquetada, al parsearla, con la conjunción de las etiquetas de las partes que coinciden; un valor de intersección mixta recién escrito y no parseado se trata como un objeto anónimo.

### Query

La forma de query anidada (`a[b]`, `a.b`, listas con comas) es una convención del backend, así que el hook está en el cliente:

```ts
import { createClient, withEndpoint, withQuerySerializer } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

Aquí `query` es el objeto de cable ya codificado. Los alias ya están aplicados, así que un serializador como `qs` no los pierde. El string de retorno es el query string. Defjs no depende de `qs`.

Sin serializador, los arrays repiten claves y un objeto anidado es `REQ_BUILD_FAILED`. Devolver `URLSearchParams` desde el builder usa ese valor tal cual y salta el serializador. El serializador no se llama cuando no hay query. Los interceptores ven entonces `queryParams` como `new URLSearchParams(queryString)`.

### Cuerpo

Gana la primera coincidencia:

| Valor de `body`                                                  | Se envía como                                                                              | Content type por defecto                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| omitido / `undefined`                                            | sin body                                                                                   | —                                                            |
| objeto tipado cuya raíz tiene un códec `urlencoded` o `formData` | `URLSearchParams` / `FormData`; las claves son nombres de cable; los arrays repiten claves | tipo de formulario / boundary de la plataforma               |
| `FormData`, `URLSearchParams`                                    | tal cual                                                                                   | igual; Defjs limpia un `Content-Type` obsoleto en `FormData` |
| `Blob` / `File`                                                  | tal cual                                                                                   | `blob.type`, o `application/octet-stream`                    |
| `ArrayBuffer`, `TypedArray`, `DataView`                          | tal cual                                                                                   | `application/octet-stream`                                   |
| `ReadableStream`                                                 | en stream (`duplex: 'half'` cuando el runtime lo permite)                                  | `application/octet-stream`                                   |
| `string`                                                         | tal cual                                                                                   | `text/plain;charset=UTF-8`                                   |
| object, array, number, boolean, `null`                           | codificado y luego `JSON.stringify`                                                        | `application/json`                                           |

Pon `content-type` en `headers` para sobrescribir el valor por defecto. El tag de códec solo aplica en la raíz del body: `body: { meta: input.form }` es JSON, y los campos del formulario son campos JSON ordinarios. Un string es texto en bruto; un string JSON como `"abc"` necesita `JSON.stringify` más `application/json`. Los campos `undefined` se omiten; un campo `nullable` enviado como `null` es JSON `null`.

`GET` y `HEAD` no pueden devolver un body: eso es un error de tipos. Los builders de WebSocket no pueden devolver `headers` ni `body`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, index) => body.append('photo', photo, `photo-${index}.jpg`))
    return { path: { id: input.id }, body }
  },
})

void login
void upload
```

`JSON.stringify`, `qs` o protobuf que ejecutes tú ven nombres lógicos. El alias no aplica en ese camino. No hay un `struct.encode` público.

Un builder puede ramificar sobre el input real y devolver un body distinto por caso (registros JSON, un `File` o `URLSearchParams`). Los `Headers` nativos también se pasan tal cual y no se recodifican.

## Cómo se lee un cuerpo

`output` es un Struct para el cuerpo 2xx; `error` es un Struct para todo lo demás. El kind del struct
elige la representación: `string` es texto en bruto, `blob` / `file` son blobs, `arrayBuffer` son bytes
y cualquier otro kind es JSON. Si no se declara ningún lado, el cuerpo nunca se lee.

Orden de operaciones:

1. `ok` elige el lado: `output` para 2xx, `error` para todo lo demás. Nunca ambos.
2. Nada declarado para ese lado → el cuerpo nunca se lee. 2xx tiene éxito con `data === undefined`;
   no-2xx es `HTTP_STATUS` con `data === undefined`. Un cuerpo ilegible en un lado que no declaraste
   se ignora, incluido el hecho de que no se pudo leer.
3. El media type se comprueba **antes** de leer el cuerpo. Una discrepancia es `RES_MEDIA_TYPE_INVALID` y
   no se parsea ni se decodifica nada.
4. Se lee la representación. Un fallo es `RES_DECODE_FAILED`. El JSON del transporte se parsea una vez:
   un string en ese valor es una raíz string JSON y no se vuelve a parsear; los bytes y los blobs son
   crudos y se parsean una vez.
5. El Struct parsea el valor. Un fallo es `RES_STRUCT_MISMATCH`.
6. 2xx → resultado y un `response.body` tipado; no-2xx → `data` tipado en `HTTP_STATUS`.

La decodificación ocurre una sola vez, después de la cadena de interceptores, así que una respuesta que un interceptor construyó con
`makeResponse(...)` se lee exactamente igual que una que llegó por el cable. En una representación JSON, un
body string es una raíz string JSON.

Una respuesta exitosa es un `DecodedResponse<T>`: `url`, `status`, `statusText`, `headers`, `ok` y
un `body` tipado. Donde no se decodificó nada obtienes `HttpMeta`: los mismos campos sin `body`. `ok`
solo significa `200 <= status < 300`. Ninguno de los dos es una `Response` nativa. Un fallo de transporte es un fault, así que
no hay ninguna respuesta con estado 0 que haga sus veces.

## Cancel the work {#cancel-the-work}

Las opciones de ejecución toman `signal` más `abort` o `timeout`. **`abort` y `timeout` son mutuamente excluyentes.** `signal` puede combinarse con cualquiera de los dos.

```ts
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const command = defineRequest({ method: 'GET', path: '/report' })()
const controller = new AbortController()
const pending = client.execute(command, { signal: controller.signal, timeout: 5_000 })

controller.abort('screen closed')
const [error] = await pending
if (error?.code === 'NET_ABORTED') {
  console.log('caller cancellation')
}
```

`timeout` debe ser un entero seguro positivo en `1..2_147_483_647`. Cancel reconocido → `NET_ABORTED`; timeout de ejecución → `NET_TIMEOUT`; un `throw` de interceptor → `EXT_INTERCEPTOR_FAILED`; otros fallos de Fetch → `NET_UNREACHABLE`. Cancelar después de que el servidor aceptó una escritura **no** demuestra que la escritura se revirtió.

## Credenciales y XSRF

`withCredentials(true)` pone Fetch `credentials: 'include'` para HTTP y SSE. No crea `Authorization` ni configura auth de WebSocket. `false` deja las credenciales sin especificar.

`withXSRF(...)` es solo HTTP. Defaults: `cookieName: 'XSRF-TOKEN'`, `headerName: 'X-XSRF-TOKEN'`. La cabecera se inyecta solo para métodos no seguros, solo cuando el llamador no la puso ya, y solo para solicitudes same-origin del navegador. Omite `GET`, `HEAD`, `OPTIONS`, `TRACE`. Fuera del navegador, pasa un `tokenProvider` síncrono acotado a la solicitud si necesitas inyección.

Mantén credenciales, tokens XSRF y query strings fuera de los logs rutinarios. No uses query params como canal general de credenciales.

## Progreso y el límite Fetch

`onDownloadProgress` corre mientras se lee un cuerpo de respuesta declarado. `lengthComputable` es true solo con un `Content-Length` positivo. Sin struct para ese lado → el cuerpo no se lee → no hay progreso de lectura del cuerpo.

`onUploadProgress` observa un cuerpo de solicitud `ReadableStream<Uint8Array>` mientras Fetch lo lee. Un body JSON o de texto no es ese stream: devuelve `file.stream()` (u otro `ReadableStream`) desde el builder cuando necesites progreso de upload. El transporte reporta un error de capacidad cuando el runtime no puede enviar un body en stream.

`fetchHandler(httpRequest, fetchImpl?)` es el límite Fetch de nivel inferior: construye un `Request` nativo, llama a Fetch, lee la representación, devuelve `HttpResponse`. **No** valida la entrada del comando, no despacha `output` ni ejecuta interceptores. Útil para tests de transporte inyectado — no sustituye a `client.execute`.

## Límites de replay

Defjs **no** reintenta HTTP automáticamente. Reintentar una lectura sigue necesitando una política revisada de timeout/red/duplicados. Reintentar una mutación necesita bytes reproducibles, soporte del servidor, una clave de idempotencia ligada al ámbito de auth + bytes de la solicitud, y una política de duplicados en el receptor.

Un límite cliente/comando/Fetch no puede saber si una escritura fallida se confirmó. Mantén las decisiones de replay en la app o en un interceptor revisado. Los interceptores pueden cortocircuitar o reemplazar la solicitud de bajo nivel; el estado y el cuerpo finales deben seguir satisfaciendo el contrato del comando.

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
