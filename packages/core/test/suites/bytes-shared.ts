import { expect, test } from "vitest";
import { toArrayBuffer } from "../../src/internal/bytes.ts";

export function registerBytesSharedSuite(): void {
  test("preserves SharedArrayBuffer storage when slicing a view", () => {
    const shared = new SharedArrayBuffer(8);
    const view = new Uint8Array(shared, 2, 3);
    view.set([4, 5, 6]);

    const copy = toArrayBuffer(view);

    expect(copy).toBeInstanceOf(SharedArrayBuffer);
    expect(copy).not.toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(copy)).toEqual(new Uint8Array([4, 5, 6]));
  });
}
