import { describe, expect, test } from "vitest";
import { toArrayBuffer } from "./bytes";

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

  test("preserves SharedArrayBuffer storage when slicing a view", () => {
    const shared = new SharedArrayBuffer(8);
    const view = new Uint8Array(shared, 2, 3);
    view.set([4, 5, 6]);

    const copy = toArrayBuffer(view);

    expect(copy).toBeInstanceOf(SharedArrayBuffer);
    expect(copy).not.toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(copy)).toEqual(new Uint8Array([4, 5, 6]));
  });
});
