import { expect, inject, test } from "vitest";
import type { Balancer, DoneInfo } from "../../src/index.ts";
import {
  createClient,
  defineRequest,
  struct,
  withBalancer,
  withEndpoint,
} from "../../src/index.ts";
import { fixture } from "../fixture/client-auto.ts";

function recordingBalancer(): {
  balancer: Balancer;
  ends: DoneInfo[];
  dones: DoneInfo[];
} {
  const ends: DoneInfo[] = [];
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick({ endpoints }) {
      return [
        null,
        {
          endpoint: endpoints[0] ?? "",
          end: (info) => {
            ends.push(info);
          },
          done: (info) => {
            dones.push(info);
          },
        },
      ];
    },
  };
  return { balancer, ends, dones };
}

export function registerTruncatedBalancerSuite(
  faultCode: "NET_BODY_INCOMPLETE" | "RES_DECODE_FAILED",
): void {
  test("real HTTP truncated 503 body reports the runtime body fault and its raw status", async () => {
    const f = fixture(inject("testServerHost"), inject("fixtureToken"));
    const h = recordingBalancer();
    await f.endpoint("anchor", "hang", {});
    const base = f.rawUrl(inject("rawServerOrigin"), "truncated", "503");
    const client = createClient(withEndpoint(base), withBalancer(h.balancer));
    const [fault] = await defineRequest({
      method: "GET",
      path: "/",
      output: struct.object({ partial: struct.string() }),
      error: struct.object({ partial: struct.string() }),
    })(client);
    expect(fault?.code).toBe(faultCode);
    expect(h.ends).toEqual([
      { attempted: true, code: "NET_UNAVAILABLE", status: 503 },
    ]);
    expect(h.dones).toEqual([
      {
        attempted: true,
        code:
          faultCode === "NET_BODY_INCOMPLETE"
            ? "NET_BODY_INCOMPLETE"
            : "NET_UNAVAILABLE",
        status: 503,
      },
    ]);
  });
}
