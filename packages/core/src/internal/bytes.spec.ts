import { describe, expect, test } from "vitest";
import { concatChunks, toArrayBuffer } from "./bytes";

describe("toArrayBuffer", () => {
  test("returns the underlying buffer when the view covers it", () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);

    expect(toArrayBuffer(view)).toBe(buffer);
  });

  test("slices a partial view", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const view = new Uint8Array(buffer, 1, 2);

    expect(new Uint8Array(toArrayBuffer(view))).toEqual(new Uint8Array([2, 3]));
  });
});

describe("concatChunks", () => {
  test("returns empty Uint8Array for zero chunks", () => {
    expect(concatChunks([], 0)).toEqual(new Uint8Array(0));
  });

  test("returns a zero-copy view for a single ArrayBuffer-backed chunk", () => {
    const buffer = new Uint8Array([10, 20, 30, 40]).buffer;
    const chunk = new Uint8Array(buffer, 1, 2);

    const out = concatChunks([chunk], 2);

    expect(out.buffer).toBe(buffer);
    expect(out).toEqual(new Uint8Array([20, 30]));
  });

  test("copies a single SharedArrayBuffer-backed chunk into an ArrayBuffer", () => {
    const shared = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    }).buffer;
    new Uint8Array(shared).set([5, 6, 7]);
    const chunk = new Uint8Array(shared, 0, 3);

    const out = concatChunks([chunk], 3);

    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out).toEqual(new Uint8Array([5, 6, 7]));
  });
});
