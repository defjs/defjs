export type FixtureHeaders = Readonly<Record<string, string>>;
export type ActionKind = "end" | "drop" | "terminate";
export type StepThen = "end" | "hold" | "drop" | "terminate";
export type RawScenarioName =
  | "truncated"
  | "utf8-last-event-id"
  | "partial-frame-resume"
  | "reset-before-headers";
export type ScenarioName = keyof ScenarioParams;

export interface ScriptStep {
  readonly status: number;
  readonly headers?: FixtureHeaders;
  readonly chunks: readonly string[]; // UTF-8 文本块
  readonly then: StepThen;
}
export interface ScenarioParams {
  respond: {
    status: number;
    headers?: FixtureHeaders;
    contentType?: string;
    body?: string;
  };
  hang: Readonly<Record<never, never>>;
  gzip: { body: string; status?: number; contentType?: string };
  script: { plan: readonly ScriptStep[] }; // 第 n 个请求（0 起）用 plan[Math.min(n, plan.length - 1)]
  ws: { send: readonly string[]; closeWith?: { code: number; reason: string } };
}
/** A registered endpoint. The scenario decides the shape of `params`, which is checked once, when it is registered. */
export type EndpointRegistration = {
  [S in ScenarioName]: {
    readonly name: string;
    readonly scenario: S;
    readonly params: ScenarioParams[S];
  };
}[ScenarioName];
export interface ActionBody {
  target: string;
  request?: number;
  action: ActionKind;
}
export interface LoggedRequest {
  endpoint: string; // 端点名，或 "raw:<scenario>"
  method: string;
  path: string; // 相对端点基址，为空时 "/"
  headers: FixtureHeaders;
  rawHead?: string; // latin1 原始请求头，仅 raw
}
export interface LogResponse {
  requests: readonly LoggedRequest[];
}

export interface RawConnection {
  write(bytes: Uint8Array): void;
  end(): Promise<void>; // 优雅 FIN，socket 关闭后 resolve
  terminate(): Promise<void>; // 销毁 socket，socket 关闭后 resolve
}
export interface RawRequestHead {
  method: string;
  target: string;
  headers: FixtureHeaders; // 名称小写
  rawHead: string;
  connection: RawConnection; // 由启动层填入，不由 readRawHead 产生
}
export interface RawReply {
  bytes: Uint8Array;
  then: "end" | "terminate" | "hold";
}
export type RawHandler = (head: RawRequestHead) => RawReply | undefined;
