import type { RuntimeStruct } from "./definition";
import { issue, StructError, type ErrorMap } from "./errors";
import type { Guide } from "./guide";
import { FAILED } from "./symbols";
import type { Path, StructIssue } from "./types";

export type ParseContext = {
  owned: WeakSet<object> | undefined;
  guides: WeakMap<object, Guide> | undefined;
  changes: [object, Guide | undefined][] | undefined;
};

export type ParseState = {
  readonly aliases: boolean;
  /** Present only for a tagging parse, which is the only one that pays for the sets. */
  readonly context: ParseContext | undefined;
  readonly errorMap: ErrorMap | undefined;
  /**
   * With `errorMap`, holds the reported issue. Without `errorMap`, `reject()` writes
   * `{ code, expected, message: "", path: [], received }` here and unwinding containers push
   * path segments onto `issue.path` in reverse order, avoiding happy-path path work.
   */
  issue: StructIssue;
  /** Forward path stack used only when `errorMap` is present. */
  readonly path: Path | undefined;
};

// Every reporting FAILED goes through `reject()`, which fills the slot first. Should a future path miss it, the
// caller still gets a readable failure instead of an empty one.
const NO_ISSUE: StructIssue = {
  code: "custom",
  expected: "a decodable value",
  message: "The value could not be decoded",
  path: [],
  received: undefined,
};

export function parseState(
  aliases: boolean,
  errorMap: ErrorMap | undefined,
  context: ParseContext | undefined,
): ParseState {
  return {
    aliases,
    context,
    errorMap,
    issue: NO_ISSUE,
    path: errorMap !== undefined ? [] : undefined,
  };
}

/** The only place a parse fails. Reports the issue at the current path when asked to, and returns FAILED. */
export function reject(
  state: ParseState,
  report: boolean,
  code: StructIssue["code"],
  expected: string,
  received: unknown,
): typeof FAILED {
  if (report) {
    if (state.path !== undefined) {
      const rejected = issue([...state.path], code, expected, received);
      const message = state.errorMap?.(rejected);
      if (message !== undefined) {
        rejected.message = message;
      }
      state.issue = rejected;
    } else {
      state.issue = {
        code,
        expected,
        message: "",
        path: [],
        received,
      };
    }
  }
  return FAILED;
}

/** Materializes the final `StructError` after parsing returned `FAILED`. */
export function toStructError(state: ParseState): StructError {
  if (state.path === undefined) {
    const raw = state.issue;
    raw.path.reverse();
    return new StructError([
      issue(raw.path, raw.code, raw.expected, raw.received),
    ]);
  }
  return new StructError([state.issue]);
}

/** Pushes a forward sub-path (such as an intersection conflict path) in reverse order onto `state.issue.path`. */
export function pushReversedSegments(
  state: ParseState,
  forwardPath: readonly (number | string)[],
): void {
  const target = state.issue.path;
  for (const segment of [...forwardPath].reverse()) {
    target.push(segment);
  }
}

export type ParseNodeFn = (
  state: ParseState,
  struct: RuntimeStruct,
  input: unknown,
  mode: "field" | "value",
  report: boolean,
  depth: number,
) => unknown;
