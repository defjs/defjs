import type {
  ActionKind,
  EndpointRegistration,
  LoggedRequest,
} from "./types.ts";

export interface LiveConnection {
  readonly request: number;
  apply(action: ActionKind): Promise<boolean>; // false: 该连接不支持此动作；resolve 时动作已生效
  release(): Promise<void>; // 幂等
}
export interface FixtureState {
  readonly id: string;
  readonly endpoints: Map<string, EndpointRegistration>;
  readonly requests: readonly LoggedRequest[];
  record(request: LoggedRequest): number; // 追加日志，返回该端点的 0 起序号，并唤醒 whenLogged
  track(endpoint: string, connection: LiveConnection): () => void; // 返回 untrack
  live(endpoint: string, request?: number): LiveConnection | undefined; // 省略 request 取序号最大的存活连接
  whenLogged(count: number): Promise<void>; // requests.length >= count 时 resolve；状态被 delete 时也 resolve
  onDispose(release: () => void | Promise<void>): void; // 旧版钩子（如 releaseSseDropStreams）使用
}
export interface FixtureRegistry {
  create(id: string): FixtureState;
  get(id: string): FixtureState | undefined;
  delete(id: string): Promise<void>; // 幂等
  closeAll(): Promise<void>;
}

interface Waiter {
  readonly count: number;
  readonly resolve: () => void;
}

export function createFixtureRegistry(): FixtureRegistry {
  const states = new Map<string, State>();

  function create(id: string): FixtureState {
    if (states.has(id)) {
      throw new Error(`Fixture "${id}" already exists`);
    }
    const state = createState(id);
    states.set(id, state);
    return state;
  }

  function get(id: string): FixtureState | undefined {
    return states.get(id);
  }

  async function deleteState(id: string): Promise<void> {
    const state = states.get(id);
    if (state === undefined) {
      return;
    }
    states.delete(id);
    await state.shutdown();
  }

  async function closeAll(): Promise<void> {
    for (const id of [...states.keys()]) {
      await deleteState(id);
    }
  }

  return { create, get, delete: deleteState, closeAll };
}

interface State extends FixtureState {
  shutdown(): Promise<void>;
}

function createState(id: string): State {
  const endpoints = new Map<string, EndpointRegistration>();
  const requests: LoggedRequest[] = [];
  const sequences = new Map<string, number>();
  const connections = new Map<string, LiveConnection[]>();
  const disposers: Array<() => void | Promise<void>> = [];
  const waiters: Waiter[] = [];
  let deleted = false;

  function settle(): void {
    const pending: Waiter[] = [];
    for (const waiter of waiters) {
      if (deleted || requests.length >= waiter.count) {
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }
    waiters.length = 0;
    for (const waiter of pending) {
      waiters.push(waiter);
    }
  }

  return {
    id,
    endpoints,
    requests,
    record(request) {
      requests.push(request);
      const sequence = sequences.get(request.endpoint) ?? 0;
      sequences.set(request.endpoint, sequence + 1);
      settle();
      return sequence;
    },
    track(endpoint, connection) {
      const existing = connections.get(endpoint);
      const list = existing ?? [];
      if (existing === undefined) {
        connections.set(endpoint, list);
      }
      list.push(connection);
      let tracked = true;
      return () => {
        if (!tracked) {
          return;
        }
        tracked = false;
        const index = list.indexOf(connection);
        if (index >= 0) {
          list.splice(index, 1);
        }
      };
    },
    live(endpoint, request) {
      const list = connections.get(endpoint);
      if (list === undefined) {
        return undefined;
      }
      if (request !== undefined) {
        for (const connection of list) {
          if (connection.request === request) {
            return connection;
          }
        }
        return undefined;
      }
      let selected: LiveConnection | undefined;
      for (const connection of list) {
        if (selected === undefined || connection.request > selected.request) {
          selected = connection;
        }
      }
      return selected;
    },
    whenLogged(count) {
      if (deleted || requests.length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiters.push({ count, resolve });
      });
    },
    onDispose(release) {
      disposers.push(release);
    },
    async shutdown() {
      deleted = true;
      for (const release of disposers.splice(0).reverse()) {
        await release();
      }
      const tracked: LiveConnection[] = [];
      for (const list of connections.values()) {
        tracked.push(...list);
      }
      for (const connection of tracked) {
        await connection.release();
      }
      connections.clear();
      settle();
    },
  };
}
