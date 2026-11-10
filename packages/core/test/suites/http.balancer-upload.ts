import { expect, inject, test } from "vitest";
import type { Balancer, DoneInfo } from "../../src/balancer/index.ts";
import {
  outlierDetection,
  pickFirstBalancer,
} from "../../src/balancer/index.ts";
import {
  createClient,
  withBalancer,
  withEndpoint,
  withHTTPHandle,
  withRetry,
} from "../../src/client/index.ts";
import { defineRequest } from "../../src/http/index.ts";
import { fixture } from "../fixture/client-auto.ts";
import {
  uploadOutcome,
  type UploadCapability,
  type UploadTransport,
} from "../upload-capability.ts";
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

function failingStream(): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      controller.error(new Error("source failed"));
    },
  });
}

// Reads the first chunk the way fetch does, so the source's error reaches whoever called fetch.
// Reading the body stream directly works on a Request built by the Firefox streaming shim too.
async function readBody(input: Request | URL | string): Promise<void> {
  const request = input instanceof Request ? input : new Request(input);
  await request.body?.getReader().read();
}

export function registerHttpBalancerUploadSuite(
  cap: UploadCapability,
  transports: readonly UploadTransport[] = ["custom", "platform"],
): void {
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

  test("reports attempted false when the caller's source stream errors", async () => {
    const watched = watch(pickFirstBalancer());
    const send = defineRequest({
      builder: () => ({ body: failingStream() }),
      method: "POST",
      path: "/up",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(async (input) => {
        await readBody(input);
        return new Response(null, { status: 204 });
      }),
    );

    const [fault, result, response] = await send(client);
    const outcome = uploadOutcome(cap, "ReadableStream", "custom");
    switch (outcome) {
      case "observed":
        expect(fault?.code).toBe("NET_UNREACHABLE");
        break;
      case "unsupported":
        expectUploadOutcome(outcome, {
          error: fault,
          result,
          response,
          observerCalls: 0,
        });
        break;
      case "bypassed":
      case "unreachable":
        throw new Error(`a custom ReadableStream upload is not ${outcome}`);
    }
    expect(watched.dones).toEqual([{ attempted: false }]);
  });

  test("reports attempted false when fetch rejects the stream built for onUploadProgress", async () => {
    const watched = watch(pickFirstBalancer());
    const send = defineRequest({
      builder: () => ({ body: new Blob(["hello"]) }),
      method: "POST",
      path: "/up",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() => Promise.reject(new TypeError("network down"))),
    );

    const [fault] = await send(client({ onUploadProgress() {} }));
    expect(fault?.code).toBe("NET_UNREACHABLE");
    const outcome = uploadOutcome(cap, "Blob", "custom");
    switch (outcome) {
      case "observed":
        expect(watched.dones).toEqual([{ attempted: false }]);
        return;
      case "bypassed":
        // Not converted: a plain Blob rejected by fetch still counts against the endpoint.
        expect(watched.dones).toEqual([
          { attempted: true, code: "NET_UNREACHABLE" },
        ]);
        return;
      case "unsupported":
      case "unreachable":
        throw new Error(`a custom Blob upload is not ${outcome}`);
    }
  });

  test("keeps a healthy endpoint in rotation after failed upload streams", async () => {
    const first = "https://first.test";
    const second = "https://second.test";
    const landed: string[] = [];
    const client = createClient(
      withEndpoint(first, second),
      withBalancer(
        outlierDetection(pickFirstBalancer(), { consecutiveFailures: 5 }),
      ),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        if (request.method === "POST") {
          await readBody(request);
        } else {
          landed.push(new URL(request.url).origin);
        }
        return new Response(null, { status: 204 });
      }),
    );
    const upload = defineRequest({
      builder: () => ({ body: failingStream() }),
      method: "POST",
      path: "/up",
    });
    const probe = defineRequest({ method: "GET", path: "/probe" });

    for (let i = 0; i < 5; i += 1) {
      const [fault] = await upload(client);
      expect(fault).not.toBeNull();
    }
    await probe(client);

    expect(landed).toEqual([first]);
  });

  test("still reports a timeout that interrupts a streamed upload as an attempt", async () => {
    const watched = watch(pickFirstBalancer());
    const send = defineRequest({
      builder: () => ({ body: new Blob(["hello"]) }),
      method: "POST",
      path: "/up",
    });
    let sent: () => void = () => undefined;
    const reachedFetch = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withBalancer(watched.balancer),
      withHTTPHandle(() => {
        sent();
        return new Promise<Response>(() => undefined);
      }),
    );
    const controller = new AbortController();

    const pending = send(
      client({ onUploadProgress() {}, signal: controller.signal }),
    );
    await reachedFetch;
    controller.abort(new DOMException("timed out", "TimeoutError"));
    const [fault] = await pending;

    expect(fault?.code).toBe("NET_TIMEOUT");
    expect(watched.dones).toEqual([{ attempted: true, code: "NET_TIMEOUT" }]);
  });

  test("does not retry a connect failure for a Blob upload converted to a stream", async () => {
    // Pins the retry cost of reporting a rejected stream as neutral: the retry decision reads the same report.
    let calls = 0;
    const send = defineRequest({
      builder: () => ({ body: new Blob(["abc"]) }),
      method: "POST",
      path: "/up",
    });
    const client = createClient(
      withEndpoint("https://first.test", "https://second.test"),
      withRetry({ delayMs: 0, methods: ["POST"] }),
      withHTTPHandle(() => {
        calls += 1;
        return Promise.reject(new TypeError("network down"));
      }),
    );

    const [fault] = await send(client({ onUploadProgress() {} }));

    expect(fault?.code).toBe("NET_UNREACHABLE");
    // A runtime that cannot stream sends the Blob unchanged, so the retry still happens there.
    expect(calls).toBe(
      uploadOutcome(cap, "Blob", "custom") === "observed" ? 1 : 2,
    );
  });

  if (transports.includes("platform"))
    test("reports attempted false when a redirect cannot replay the upload stream", async () => {
      const f = fixture(inject("testServerHost"), inject("fixtureToken"));
      const target = await f.endpoint("landed", "respond", { status: 204 });
      const source = await f.endpoint("moved", "respond", {
        status: 307,
        headers: { location: target },
      });
      const watched = watch(pickFirstBalancer());
      const send = defineRequest({
        builder: () => ({ body: new Blob(["abc"]) }),
        method: "POST",
        path: "/",
      });
      const client = createClient(
        withEndpoint(source),
        withBalancer(watched.balancer),
      );

      const [fault] = await send(client({ onUploadProgress() {} }));
      const outcome = uploadOutcome(cap, "Blob", "platform");
      switch (outcome) {
        case "observed": {
          expect(fault?.code).toBe("NET_UNREACHABLE");
          // The healthy endpoint answered the redirect and received the body once.
          const methods = (await f.log()).requests.map((r) => r.method);
          expect(methods).toEqual(["POST"]);
          expect(watched.dones).toEqual([{ attempted: false }]);
          return;
        }
        case "unreachable":
          expect(fault?.code).toBe("NET_UNREACHABLE");
          expect(watched.dones).toEqual([{ attempted: false }]);
          return;
        case "bypassed":
          // Not converted: the Blob is replayable, so fetch follows the redirect.
          expect(fault).toBeNull();
          expect(watched.dones).toEqual([{ attempted: true, status: 204 }]);
          return;
        case "unsupported":
          throw new Error(`a platform Blob upload is not ${outcome}`);
      }
    });
}
