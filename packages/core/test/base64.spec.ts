import { expect, test } from "vitest";
import { toBase64 } from "./base64";

test("encodes an empty array as an empty string", () => {
  expect(toBase64(new Uint8Array())).toBe("");
});

test("encodes the three padding variants", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  expect(toBase64(bytes("Man"))).toBe("TWFu");
  expect(toBase64(bytes("Ma"))).toBe("TWE=");
  expect(toBase64(bytes("M"))).toBe("TQ==");
});

test("encodes every byte value", () => {
  const input = Uint8Array.from({ length: 256 }, (_, index) => index);
  const result = toBase64(input);
  expect(Array.from(atob(result), (char) => char.charCodeAt(0))).toEqual(
    Array.from(input),
  );
});

test("encodes input larger than one chunk", () => {
  const input = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
  const result = toBase64(input);
  expect(Array.from(atob(result), (char) => char.charCodeAt(0))).toEqual(
    Array.from(input),
  );
});
