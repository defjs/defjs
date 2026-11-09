import { expect, inject, test } from "vitest";

test('inject("round13") carries the Round13Settings shape', () => {
  const settings = inject("round13");
  expect(typeof settings.seed).toBe("number");
  expect(typeof settings.attempts).toBe("number");
  expect(typeof settings.depth).toBe("number");
  expect(typeof settings.exotic).toBe("boolean");
});
