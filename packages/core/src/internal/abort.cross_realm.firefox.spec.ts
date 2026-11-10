import { describe, expect, test } from "vitest";

import { mergeAbortSignals } from "./abort";

function hasGlobals(window: Window): window is Window & typeof globalThis {
  return "AbortController" in window && "Object" in window;
}

describe("mergeAbortSignals across realms", () => {
  function inFrame(run: (realm: Window & typeof globalThis) => void) {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const realm = frame.contentWindow;
      if (!realm || !hasGlobals(realm)) {
        throw new Error("the iframe has no global scope");
      }
      run(realm);
    } finally {
      frame.remove();
    }
  }

  test("should follow an AbortSignal that was created in another realm", () => {
    inFrame((realm) => {
      const foreign = new realm.AbortController();
      expect(foreign.signal instanceof AbortSignal).toBe(false);

      const merged = mergeAbortSignals(new AbortController().signal, [
        foreign.signal,
      ]);
      expect(merged.aborted).toBe(false);

      const reason = new Error("aborted in the other realm");
      foreign.abort(reason);
      expect(merged.aborted).toBe(true);
      expect(merged.reason).toBe(reason);
    });
  });

  test("should reject a plain object from another realm that looks like an AbortSignal", () => {
    inFrame((realm) => {
      const lookalike = Object.assign(new realm.Object(), {
        aborted: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      });

      expect(() => {
        // @ts-expect-error -- A lookalike object is not an AbortSignal, whichever realm created it.
        mergeAbortSignals(new AbortController().signal, [lookalike]);
      }).toThrow(new TypeError("signal must be an AbortSignal"));
    });
  });
});
