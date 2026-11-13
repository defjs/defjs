import { expect } from "vitest";
import { ERR_STREAMING_REQUEST_UNSUPPORTED } from "../src/http/transport/fetch_init.ts";
import type { UploadOutcome } from "./upload-capability.ts";

export interface UploadAttempt {
  readonly error:
    | {
        readonly code: string;
        readonly cause?: unknown;
      }
    | null
    | undefined;
  readonly result: unknown;
  readonly response: unknown;
  readonly observerCalls: number;
}

export function expectUploadOutcome(
  outcome: Exclude<UploadOutcome, "observed">,
  attempt: UploadAttempt,
): void {
  switch (outcome) {
    case "bypassed":
      expect(attempt.error?.code ?? null).toBeNull();
      expect(attempt.observerCalls).toBe(0);
      return;
    case "unsupported":
      expect(attempt.error?.code).toBe("ENV_UNSUPPORTED");
      expect(attempt.error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED);
      expect(attempt.result).toBeUndefined();
      expect(attempt.response).toBeUndefined();
      expect(attempt.observerCalls).toBe(0);
      return;
    case "unreachable":
      expect(attempt.error?.code).toBe("NET_UNREACHABLE");
      expect(attempt.error?.cause).toBeInstanceOf(TypeError);
      expect(typeErrorMessage(attempt.error?.cause)).toBe("Failed to fetch");
      expect(attempt.result).toBeUndefined();
      expect(attempt.response).toBeUndefined();
      return;
  }
}

function typeErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof TypeError) return cause.message;
  return undefined;
}
