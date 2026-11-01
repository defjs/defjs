/**
 * 声明原型的正反类型用例，由根 typecheck 检查，不作为运行时测试执行。
 * 生成声明后的独立消费验证另在临时目录运行。
 */
import {
  struct,
  withEndpoint,
  type EventStreamData,
  type HttpAwaitResult,
  type StreamAwaitResult,
} from "@defjs/core";
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  type Client,
  type RequestOptions,
} from "./2026-11-01-operation-client.types";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

const client = createClient(withEndpoint("https://example.test"));
const abort = new AbortController().signal;

// --- Client：可调用，参数可选，返回同类 Client ---
const derived: Client = client({ abort });
const noOptions: Client = client();
void [derived, noOptions];
client({ abort })({ protocols: ["chat.v1"] })();

// @ts-expect-error timeout 已删除。
client({ timeout: 100 });
// @ts-expect-error signal 已删除，只保留 abort。
client({ signal: abort });
// @ts-expect-error 新 Client 没有公开 execute 成员。
void client.execute;

// --- RequestOptions：恰好 7 个扁平字段 ---
export type OptionKeys = Expect<
  Equal<
    keyof RequestOptions,
    | "abort"
    | "onUploadProgress"
    | "onDownloadProgress"
    | "beforeConnect"
    | "protocols"
    | "heartbeat"
    | "reconnect"
  >
>;

// --- 操作：参数个数由 input 决定，没有第三参数，没有占位 ---
export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});
export const health = defineRequest({ method: "GET", path: "/health" });
export const search = defineRequest({
  method: "GET",
  path: "/search",
  input: struct.object({ q: struct.string().optional() }).optional(),
  builder: (input) => ({ query: input ?? {} }),
});

getUser(client, { id: 1 });
getUser(client({ abort }), { id: 1 });
health(client);
health(client({ abort }));
search(client);
search(client({ abort }), { q: "Ada" });

// @ts-expect-error 无输入操作不接受第二个参数。
health(client, { abort });
// @ts-expect-error 操作不接受第三个 options 参数。
getUser(client, { id: 1 }, { abort });
// @ts-expect-error 必填输入不能省略。
getUser(client({ abort }));
// @ts-expect-error 输入类型必须匹配。
getUser(client({ abort }), { id: "wrong" });
// @ts-expect-error 旧入口 getUser(input) 不再存在：第一个参数必须是 Client。
getUser({ id: 1 });

// --- 扁平配置：不属于操作协议的字段类型上放行，运行时忽略 ---
getUser(client({ protocols: ["chat.v1"] }), { id: 1 });

// --- 同一个 client 可用于三种协议 ---
export const updates = defineEventStream({
  path: "/events",
  maxBufferSize: 1024,
  maxQueueSize: 10,
  events: { message: struct.object({ text: struct.string() }) },
});
const Incoming = struct.object({
  type: struct.literal("pong"),
  count: struct.number(),
});
const Outgoing = struct.object({ type: struct.literal("ping") });
export const room = defineWebSocket({
  path: "/room",
  incoming: Incoming,
  outgoing: Outgoing,
  maxIncomingQueueSize: 10,
});
const shared = client({ abort });
getUser(shared, { id: 1 });
health(shared);
updates(shared);
room(shared);

// --- heartbeat：回调参数是 unknown，需要自行收窄 ---
room(
  client({
    heartbeat: {
      intervalMs: 1000,
      timeoutMs: 100,
      message: () => ({ type: "ping" }),
      isAck: (message) => {
        // @ts-expect-error 消息类型是 unknown，不再从操作推导。
        return message.type === "pong";
      },
    },
  }),
);
room(
  client({
    heartbeat: {
      intervalMs: 1000,
      isAck: (message) =>
        typeof message === "object" && message !== null && "count" in message,
    },
  }),
);

// @ts-expect-error 拼错的字段不是有效配置。
client({ abrot: abort });
// @ts-expect-error 对象字面量的多余属性被拒绝。
client({ abort, applicationExtra: true });
// 先存入变量再传入时，结构类型允许额外属性；这是 TypeScript 的既有边界。
const saved = { abort, applicationExtra: true };
client(saved);

// --- 结果：错误优先元组不变 ---
async function result() {
  const [error, user, response] = await getUser(client({ abort }), { id: 1 });
  if (error) {
    // @ts-expect-error 错误分支不能读取成功值。
    void user.name;
    if (error.code === "HTTP_STATUS") {
      const message: string = error.data.message;
      void message;
    }
    return;
  }
  const id: number = user.id;
  const name: string = user.name;
  const status: number = response.status;
  void [id, name, status];
}
void result;

async function resources() {
  const [streamError, stream] = await updates(client({ abort }));
  if (streamError) return;
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    const text: string = event.data.text;
    void text;
    break;
  }
  const [socketError, session] = await room(client({ abort }));
  if (socketError) return;
  await using ownedSession = session;
  ownedSession.send({ type: "ping" });
  // @ts-expect-error 会话发送参数仍然必须匹配 outgoing 结构。
  ownedSession.send({ type: "pong" });
  for await (const message of ownedSession.receive) {
    const count: number = message.count;
    void count;
    break;
  }
}
void resources;

// --- 具体操作可被 Parameters / ReturnType 提取 ---
export type UserInput = Expect<
  Equal<Parameters<typeof getUser>[1], { id: number }>
>;
export type UserResult = Expect<
  Equal<
    Exclude<Awaited<ReturnType<typeof getUser>>[1], undefined>,
    { id: number; name: string }
  >
>;

// --- 与现有执行结果类型逐一对齐 ---
const StreamEvents = { message: struct.object({ text: struct.string() }) };
const Problem = struct.object({ message: struct.string() }).optional();
const optionalErrorStream = defineEventStream({
  path: "/error-stream",
  maxBufferSize: 1024,
  maxQueueSize: 10,
  events: StreamEvents,
  error: Problem,
});
const httpCompatible: Expect<
  Equal<
    ReturnType<typeof getUser>,
    Promise<HttpAwaitResult<{ id: number; name: string }, { message: string }>>
  >
> = true;
const streamCompatible: Expect<
  Equal<
    ReturnType<typeof optionalErrorStream>,
    Promise<
      StreamAwaitResult<EventStreamData<typeof StreamEvents>, typeof Problem>
    >
  >
> = true;
void [httpCompatible, streamCompatible];

// --- 声明约束沿用原定义 ---
// @ts-expect-error 声明 input 后 builder 仍然是必需的。
defineRequest({
  method: "GET",
  path: "/missing",
  input: struct.object({ id: struct.number() }),
});
defineRequest({
  method: "GET",
  path: "/invalid",
  // @ts-expect-error GET 不能带 body。
  builder: () => ({ body: "bad" }),
});
