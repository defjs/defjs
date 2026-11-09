import { expect, test } from "vitest";
import type { Balancer, DoneInfo } from "../../src/balancer/index.ts";
import { pickFirstBalancer } from "../../src/balancer/index.ts";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { uploadOutcome, type UploadCapability } from "../upload-capability.ts";
import { expectUploadOutcome } from "../upload-outcome-assert.ts";

function watch(inner: Balancer) {
  const dones: DoneInfo[] = [];
  const balancer: Balancer = {
    pick(info) {
      const outcome = inner.pick(info);
      if (outcome[0] !== null) {
        return outcome;
      }
      const selected = outcome[1];
      return [
        null,
        {
          endpoint: selected.endpoint,
          done(report) {
            dones.push(report);
            selected.done?.(report);
          },
        },
      ];
    },
  };
  return { balancer, dones };
}

export function registerHttpBalancerUploadSuite(cap: UploadCapability): void {
  test("reports attempted false when an upload observer fails before the response", async () => {
    let fetched = false;
    let received = "";
    let observerCalls = 0;
    const watched = watch(pickFirstBalancer());
    const payload = new Blob(["hello"]);
    const send = defineRequest({
      builder: () => ({ body: payload }),
      method: "POST",
      path: "/up",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(async (input) => {
        fetched = true;
        const request = input instanceof Request ? input : new Request(input);
        received = await request.text();
        return new Response(null, { status: 204 });
      }),
    );

    const [fault, result, response] = await send(
      client({
        onUploadProgress() {
          observerCalls += 1;
          throw new Error("watch");
        },
      }),
    );
    const outcome = uploadOutcome(cap, "Blob", "custom");
    switch (outcome) {
      case "observed":
        expect(fault?.code).toBe("EXT_OBSERVER_FAILED");
        expect(fetched).toBe(false);
        expect(watched.dones).toEqual([{ attempted: false }]);
        expect(observerCalls).toBe(1);
        return;
      case "bypassed":
        expectUploadOutcome(outcome, {
          error: fault,
          result,
          response,
          observerCalls,
        });
        expect(fetched).toBe(true);
        expect(received).toBe("hello");
        expect(watched.dones).toEqual([{ attempted: true, status: 204 }]);
        return;
      case "unsupported":
      case "unreachable":
        throw new Error(`a custom Blob upload is not ${outcome}`);
    }
  });
}
