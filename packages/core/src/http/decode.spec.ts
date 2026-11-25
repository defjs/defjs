import { describe, expect, test } from "vitest";
import { decodeDirectResponse, decodeResponse } from "./decode";
import { makeResponse } from "./http_response";
import { struct } from "../struct";

describe("decodeResponse and decodeDirectResponse edge cases", () => {
  test("decodes a Blob body with struct.blob() through convertBlob", async () => {
    const controller = new AbortController();
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "application/octet-stream",
    });
    const response = makeResponse({
      body: blob,
      headers: new Headers({ "content-type": "application/octet-stream" }),
      status: 200,
    });

    const [err, body, meta] = await decodeResponse(
      { output: struct.blob() },
      response,
      controller.signal,
    );

    expect(err).toBeNull();
    expect(body).toBe(blob);
    expect(meta?.status).toBe(200);
  });

  test("decodes a Blob JSON body via convertBlob when signal is present", async () => {
    const controller = new AbortController();
    const response = makeResponse({
      body: new Blob([JSON.stringify({ ok: true })], {
        type: "application/json",
      }),
      headers: new Headers({ "content-type": "application/json" }),
      status: 200,
    });

    const [err, body] = await decodeResponse(
      { output: struct.object({ ok: struct.boolean() }) },
      response,
      controller.signal,
    );

    expect(err).toBeNull();
    expect(body).toEqual({ ok: true });
  });

  test("decodeDirectResponse infers representations when omitted and validates empty/error bodies", () => {
    const okRes = makeResponse({
      body: "hello",
      headers: new Headers({ "content-type": "text/plain" }),
      status: 200,
    });
    const [okErr, okBody] = decodeDirectResponse(
      { output: struct.string() },
      okRes,
    );
    expect(okErr).toBeNull();
    expect(okBody).toBe("hello");

    const badMediaRes = makeResponse({
      headers: new Headers({ "content-type": "text/plain" }),
      status: 500,
    });
    const [mediaErr] = decodeDirectResponse(
      { error: struct.object({ msg: struct.string() }) },
      badMediaRes,
    );
    expect(mediaErr?.code).toBe("RES_MEDIA_TYPE_INVALID");

    const emptyJsonRes = makeResponse({
      headers: new Headers({ "content-type": "application/json" }),
      status: 204,
    });
    const [decodeErr] = decodeDirectResponse(
      { output: struct.object({ ok: struct.boolean() }) },
      emptyJsonRes,
    );
    expect(decodeErr?.code).toBe("RES_DECODE_FAILED");
  });
});
