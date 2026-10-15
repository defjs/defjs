import { FAILED } from './symbols'
import type { FlattenedStructError, FormattedStructError, Path, StructIssue } from './types'
import { describeKind, formatPath } from './utils'

/**
 * Optional callback that rewrites a `StructIssue` message before it is stored.
 *
 * Return a string to replace the default message. An empty string is a replacement.
 * Return `undefined` to keep the default.
 *
 * @param issue - Issue about to be recorded.
 * @returns Replacement message, or `undefined` to keep the default.
 */
export type ErrorMap = (issue: StructIssue) => string | undefined

/**
 * Aggregate of one or more `StructIssue`s from a failed parse.
 *
 * `message` and `prettify()` name the kind of each received value and omit the value, so they can be logged.
 * The raw value stays on `StructIssue.received`.
 *
 * Use `format()`, `flatten()`, or `prettify()` to present issues to callers.
 */
export class StructError extends Error {
  /** Issues collected for this failure, in encounter order. */
  readonly issues: StructIssue[]

  /**
   * @param issues - Non-empty list of parse issues (empty lists still produce a generic message).
   */
  constructor(issues: StructIssue[]) {
    const first = issues[0]?.message
    super(issues.length <= 1 ? (first ?? 'Struct parse failed') : `${issues.length} struct issues: ${first}`)
    this.name = 'StructError'
    this.issues = issues
  }

  /**
   * Build a nested error tree keyed by path segments.
   *
   * @returns A `FormattedStructError` with `_errors` arrays at each node.
   */
  format(): FormattedStructError {
    const root = createFormattedError()
    for (const item of this.issues) {
      let cursor: FormattedStructError = root
      for (const segment of item.path) {
        const key = formatErrorTreeKey(segment)
        const existing = cursor[key]
        if (Object.hasOwn(cursor, key) && existing && !Array.isArray(existing)) {
          cursor = existing
        } else {
          const next = createFormattedError()
          cursor[key] = next
          cursor = next
        }
      }
      cursor._errors.push(item.message)
    }
    return root
  }

  /**
   * Split issues into root `formErrors` and first-segment `fieldErrors`.
   *
   * @returns Flat bags suitable for form libraries.
   */
  flatten(): FlattenedStructError {
    const formErrors: string[] = []
    const fieldErrors: { [key: string]: string[] } = Object.create(null)
    for (const item of this.issues) {
      if (item.path.length === 0) {
        formErrors.push(item.message)
        continue
      }
      const key = String(item.path[0])
      ;(fieldErrors[key] ??= []).push(item.message)
    }
    return { fieldErrors, formErrors }
  }

  /**
   * Render a multi-line, human-readable summary of all issues.
   *
   * Each line uses the issue message, which names the received kind and omits the value.
   *
   * @returns One `× path: message` line per issue.
   */
  prettify(): string {
    if (this.issues.length === 0) {
      return 'Struct parse failed'
    }
    return this.issues
      .map((item) => {
        const where = item.path.length === 0 ? '<root>' : formatPath(item.path)
        return `× ${where}: ${item.message}`
      })
      .join('\n')
  }
}

function createFormattedError(): FormattedStructError {
  return Object.assign(Object.create(null), { _errors: [] as string[] })
}

function formatErrorTreeKey(segment: number | string): string {
  const key = String(segment)
  return key === '_errors' ? '\\_errors' : key
}

let activeErrorMap: ErrorMap | undefined

// Holds the issue of the failure a parse is handing back. `failure()` applies the active error map, then writes the
// issue right before `FAILED` travels up to the parse entry point, which reads it. No user code runs after that write
// (a union that goes on to its next candidate just drops the issue). The entry point puts back what it found, so a
// parse started from an error map, a decode hook or a getter cannot disturb a pending failure, and the slot is empty
// between top-level parses. The map runs here, on the parser's copy, so a hook built by another copy still uses it.
let parkedIssue: StructIssue | undefined

export function hasErrorMap(): boolean {
  return activeErrorMap !== undefined
}

export function runWithErrorMap<T>(map: ErrorMap | undefined, run: () => T): T {
  const previous = activeErrorMap
  activeErrorMap = map
  try {
    return run()
  } finally {
    activeErrorMap = previous
  }
}

/** Parks the issue for the parse entry point and returns FAILED. A decode hook receives it as `fail`. */
export function failure(candidate: StructIssue): typeof FAILED {
  if (activeErrorMap) {
    const override = activeErrorMap(candidate)
    if (override !== undefined) {
      candidate.message = override
    }
  }
  parkedIssue = candidate
  return FAILED
}

export function parkedFailure(): StructIssue | undefined {
  return parkedIssue
}

export function restoreFailure(issue: StructIssue | undefined): void {
  parkedIssue = issue
}

export function issue(path: Path, code: StructIssue['code'], expected: string, received: unknown, message?: string): StructIssue {
  return {
    code,
    expected,
    message: message ?? `Expected ${expected} at ${formatPath(path)}, received ${describeKind(received)}`,
    path,
    received,
  }
}
