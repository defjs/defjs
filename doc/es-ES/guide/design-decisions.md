---
title: Decisiones de diseño
description: Por qué Defjs mantiene explícitos contratos, comandos, resultados de transporte, decodificación y responsabilidad.
---

# Decisiones de diseño

Defjs hace unos cuantos trade-offs deliberados. Las APIs de conveniencia suelen ocultar quién es dueño de una solicitud, un stream o una sesión. Defjs deja ese límite visible para que puedas reutilizar el mismo contrato de endpoint sin adoptar en silencio una caché, un planificador de reintentos o un gestor de recursos.

## Declarar es afirmar {#declaration-is-an-assertion}

Estas seis reglas deciden cualquier pregunta sobre cómo se lee una respuesta. Van numeradas para que
una discusión posterior pueda citar una en lugar de volver a deducirla.

### 1. Lo que declaras es lo que afirmas

`output` significa «cuando `ok` es true, el cuerpo _es_ esta forma». `error` significa «cuando `ok` es false,
el cuerpo _es_ esta forma». Una declaración no es una pista ni una esperanza de mejor esfuerzo; es una afirmación sobre
lo que va a llegar.

### 2. `ok` es la única bifurcación, y solo un lado decodifica

Una respuesta 2xx se lee con `output`. Todo lo demás se lee con `error`. Nunca ambos, nunca
el otro como fallback.

### 3. Una realidad que difiere de la afirmación es un fallo, y se reporta alto y claro

Sin adivinar formatos, sin degradar a algo más débil, sin silencio. Que el backend
haya cambiado, que un gateway se haya metido o que alguien haya manipulado la respuesta **no cambia la
conclusión**: la librería no puede distinguirlos y no debería fingir que sí.

Esta es la regla que más gente quiere suavizar, así que vale la pena plantear el caso con claridad.
Supón que un atacante puede reescribir un `200` que tu página estaba a punto de leer con `output`, y en su lugar
recibes un `3xx`, `4xx` o `5xx`. Fallar no es una molestia; es el único resultado
seguro. Entregarte el cuerpo crudo «por si acaso» le daría a cualquiera capaz de inyectar una respuesta un
camino para sortear la validación que pediste.

### 4. Una decodificación fallida no tiene cuerpo

Un cuerpo _es_ un valor decodificado. Si la decodificación falló, no hay valor: no existe un cuerpo
medio decodificado que inspeccionar. El detalle culpable vive en `cause`; la respuesta conserva sus metadatos y
nada más.

Esta la impone el sistema de tipos, no la convención: el `response` de un fault de decodificación es
`HttpMeta`, que no tiene campo `body` en absoluto, así que ir a buscarlo es un error de compilación.

### 5. Si no quieres la afirmación, no declares

Omitir `output` significa «el cuerpo 2xx no me importa»: nunca se lee. Omitir `error`
dice lo mismo para todo lo demás. Es un opt-out explícito, no un descuido, y va hasta
el final: un cuerpo ilegible en el lado que descartaste no es asunto tuyo, ni siquiera el
hecho de que no se pudiera leer.

### 6. 3xx no es un rango de códigos de error

Si sabes que un endpoint responde con un estado de redirección, no le des a `output` un schema para eso, o
declara uno que acepte un valor vacío. Si no, reportar un fallo es el resultado esperado,
no un hueco.

## Clientes explícitos

`createClient(...)` convierte la config del endpoint en un valor explícito. Entornos o ámbitos de solicitud distintos obtienen endpoints, credenciales, interceptores, serializadores y handles de transporte distintos.

El coste: no hay un default a nivel de proceso. Ese coste ayuda en un servidor — crea el cliente dentro del límite de la solicitud cuando las opciones o clausuras capturan auth, cookies, usuarios, tenants o metadatos de la solicitud. Un cliente explícito tampoco aísla el estado capturado por un interceptor. La identidad del cliente no es por sí sola un límite de seguridad.

Un cliente despacha comandos. No es dueño del trabajo activo. Quien arranca una solicitud HTTP, un stream SSE o una sesión WebSocket debe cancelarlo o cerrarlo y esperar la promesa terminal.

## Definiciones, endpoints y comandos

La definición es el contrato estable: método, path, struct de input, los structs que decodifican cada lado de `ok`, límites de transporte. `defineRequest` devuelve un endpoint. Llamarlo crea un comando opaco para una sola ejecución.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
})

const command = getUser({ id: 7 })
```

Un trabajo en segundo plano y un dueño de UI pueden ejecutar la misma forma `getUser` con políticas distintas de cancel/retry. Mantener el comando opaco evita que el código de la app dependa de tags o símbolos internos del transporte.

## Resultados específicos del transporte

Los tres transportes usan una tupla error-first. Una sola «respuesta» genérica borraría hechos del ciclo de vida.

- HTTP → `[err, data, response]` — salida decodificada + la respuesta que la produjo
- SSE → `[err, stream, open]` — un stream lógico + snapshot de respuesta de arranque
- WebSocket → `[err, session, connection]` — sesión lógica + snapshot de conexión de arranque

En éxito el tercer valor siempre está presente. Un fallo HTTP es `[error, undefined, undefined]`:
el fault ya lleva los metadatos de la respuesta, y ese fault es lo que se pasa a un handler,
se loguea o se relanza. Los fallos de arranque de SSE y WebSocket aún pueden incluir el snapshot de open o de conexión
cuando se capturó uno.

Para SSE y WebSocket el tercer valor es un snapshot, no una promesa de que futuros reconnects mantengan la
misma conexión física. Tras el arranque, el control del ciclo de vida pertenece al handle o
sesión devueltos.

## Decodificación en runtime

La inferencia de TypeScript describe lo que esperas; no puede comprobar una respuesta del servidor en runtime. El parseo Struct es la otra mitad del contrato. Defjs valida la entrada del comando antes de construir la solicitud, comprueba la representación y luego parsea el struct del lado de `ok` que aplique.

La decodificación ocurre **una sola vez, después de la cadena de interceptores**. Una respuesta que un interceptor construyó con
`makeResponse(...)` se interpreta exactamente igual que una que llegó por el cable: de dónde vino una respuesta
no cambia cómo se lee, así que no hay ningún camino de «confiar en el interceptor» que razonar.

El orden es: media type, luego representación, luego struct.

| Lo que no se cumplió                                            | Fault                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| El media type no es el que necesita la representación declarada | `RES_MEDIA_TYPE_INVALID` — avisado _antes_ de leer el cuerpo |
| Los bytes no son esa representación                             | `RES_DECODE_FAILED`                                          |
| El valor no es ese struct                                       | `RES_STRUCT_MISMATCH`                                        |
| No-2xx, y `error` decodificó                                    | `HTTP_STATUS` con `data` tipado                              |
| No-2xx, y `error` no estaba declarado                           | `HTTP_STATUS` con `data: undefined`                          |

Comprobar el media type primero es lo que convierte «pedí JSON y recibí HTML» en un fault
preciso en lugar de un error del parser, y se salta la lectura, el parseo y el struct por completo.

## Builder, encoder y alias

Un struct es el contrato del campo, en ambas direcciones. `.alias(name)` es el nombre de cable. El struct decide cómo se codifica un valor. El `builder` decide dónde va ese valor.

`builder` es opcional, síncrono y puro. Recibe el input parseado — el valor real, no una vista de binding — y devuelve la solicitud: `path`, `query`, `headers` y `body`. Corre cuando se ejecuta el comando. Un throw se convierte en `REQ_BUILD_FAILED` en la tupla; llamar al endpoint no lanza. Omite `builder` cuando el struct de input ya es esa forma de solicitud. Esa omisión es `(input) => input`, y TypeScript exige un builder cuando el input no es asignable.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(
      struct.object({
        displayName: struct.string().alias('display_name'),
        email: struct.string(),
      }),
    ),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

const command = createBatch({
  accountId: 42,
  users: [{ displayName: 'Ada', email: 'ada@example.com' }],
})
void command
```

El camino por defecto es entregar el valor tipado. `body: { users: input.users }` conserva el alias de cada usuario, así que el campo de cable es `display_name`. Una clave que escribes tú (`account_id`, `x-api-version`) es literal. Hacer spread de un objeto tipado conserva su struct; añadir la clave de cable junto al campo lógico es `REQ_BUILD_FAILED`.

El anidamiento de query es una propiedad del backend, así que vive en el cliente: `withQuerySerializer((query) => string)` ve el objeto de cable ya codificado, alias incluidos. No se llama cuando no hay query. Un `URLSearchParams` devuelto por el builder lo salta. Sin serializador, los arrays repiten claves y un objeto anidado falla. Los interceptores observan `queryParams` como `new URLSearchParams(queryString)`.

El kind del body se decide a partir del valor, primera coincidencia:

- sin `body` → no se envía nada
- un códec `urlencoded` o `formData` en la raíz del body → esa codificación de formulario; el tag no aplica cuando el valor está anidado dentro de JSON
- `FormData`, `URLSearchParams`, `Blob`, `File`, bytes o un `ReadableStream` → se envían tal cual
- un string → `text/plain;charset=UTF-8`
- cualquier otra cosa → JSON

Los campos `undefined` se omiten. `null` en un campo nullable se envía. Un string no es JSON salvo que lo serialices y pongas `content-type`. Serializar tú mismo (`JSON.stringify`, qs, protobuf) sale del encoder del struct, así que los alias no aplican. No hay un `struct.encode` público.

`GET` y `HEAD` no pueden llevar un body. Los builders de WebSocket no pueden devolver headers ni un body. Los subprotocolos estáticos de WebSocket se quedan en la definición (`protocols`), no en el builder. Los frames WebSocket inválidos van al listener de runtime-error de la sesión. Un struct `error` de SSE tipa el fault de arranque, y su cuerpo de handshake sigue la misma regla de kind que un cuerpo HTTP: `string` es texto, blobs y files son blobs, `arrayBuffer` son bytes y todo lo demás es JSON.

## Observadores y colocación de políticas

Los interceptores son para política a nivel de transporte: auth, tracing, short-circuit, retry revisado. Solo se ejecutan para su transporte y se componen en orden cebolla. Las opciones de ejecución son para el lifetime de ese trabajo: `signal`, `timeout`, heartbeat de WebSocket, reconnect opt-in.

Los observadores informan de lo que ocurrió sin convertirse en un segundo dueño. SSE `onInvalidEvent`, listeners de estado WebSocket y listeners de errores de runtime sirven para diagnósticos y métricas acotados. El stream/sesión devuelto sigue siendo dueño de la iteración, el cierre, el unsubscribe y la espera terminal. Caché, supresión de resultados obsoletos, idempotencia y mapeo de errores de dominio van alrededor de `client.execute(...)`, donde tu app ve su propia política y estado.

## OpenAPI, sourcemaps y telemetría

Defjs no genera ni sincroniza un segundo contrato OpenAPI. Si OpenAPI ya es la autoridad, mantenlo y añade validación en runtime en el límite de la app. Para un servicio nuevo, las definiciones de endpoint y los Structs pueden ser el contrato de cable directo — sin una segunda fuente de verdad.

`withOpenTelemetryServer(...)` añade instrumentación Defjs **saliente** a un cliente. No inicializa un SDK de OpenTelemetry. `tracer` es obligatorio, `meter` es opcional, los tres transportes están habilitados por defecto y la propagación por query de WebSocket está deshabilitada por defecto. Mantén los nombres de operación estáticos y de baja cardinalidad. Revisa propagación, hooks, URL, cabeceras, payloads, causes y retención como potencialmente sensibles.

Los sourcemaps son una decisión de despliegue, no un comportamiento de Defjs. Un mapa público con `sourcesContent` expone el código fuente; un mapa oculto sigue conteniendo fuente y rutas; desactivar mapas elimina la simbolización a nivel de fuente. Trata los mapas privados como artefactos de depuración desplegables con reglas explícitas de acceso y retención.

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [Probar con un handle Fetch local](../recipes/test-with-handle.md)
