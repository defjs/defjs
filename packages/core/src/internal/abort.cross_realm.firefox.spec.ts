import { describe, expect, test } from "vitest";

import { followAbort } from "./abort";

function hasGlobals(window: Window): window is Window & typeof globalThis {
  return "AbortController" in window && "Object" in window;
}

describe("followAbort across realms", () => {
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

      const follower = new AbortController();
      followAbort(follower, foreign.signal);
      expect(follower.signal.aborted).toBe(false);

      const reason = new Error("aborted in the other realm");
      foreign.abort(reason);
      expect(follower.signal.aborted).toBe(true);
      expect(follower.signal.reason).toBe(reason);
    });
  });
});
