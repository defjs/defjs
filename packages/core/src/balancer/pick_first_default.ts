import type { Balancer, DoneInfo } from "./balancer";
import { ERR_NO_CANDIDATE } from "./no_candidate";

export interface StickyFailbackConfig {
  readonly ms: number;
  readonly now: () => number;
}

export interface StickyPickerOptions {
  readonly failback?: StickyFailbackConfig;
  readonly orderMembers?: (members: readonly string[]) => readonly string[];
}

/**
 * Default sticky failover balancer without shuffle, failback, or outlier detection.
 * Kept separate from `balancer.ts` so default clients do not bundle health-filter code.
 */
export function defaultPickFirstBalancer(): Balancer {
  return createStickyPicker();
}

export function createStickyPicker(options?: StickyPickerOptions): Balancer {
  const failback = options?.failback;
  const orderMembers = options?.orderMembers;
  let sticky: string | undefined;
  let leftFirstAt: number | undefined;

  return {
    pick(info) {
      const candidates = info.endpoints;
      if (candidates.length === 0) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      const members = info.members ?? candidates;
      const order = orderMembers ? orderMembers(members) : members;
      const first = order[0];
      if (first === undefined) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      if (sticky === undefined || !order.includes(sticky)) {
        sticky = first;
      }
      if (
        failback !== undefined &&
        sticky !== first &&
        candidates.includes(first) &&
        leftFirstAt !== undefined &&
        failback.now() - leftFirstAt >= failback.ms
      ) {
        sticky = first;
      }
      const chosen = nextCandidate(order, order.indexOf(sticky), candidates);
      if (chosen === undefined) {
        return [ERR_NO_CANDIDATE, undefined];
      }
      return [
        null,
        {
          endpoint: chosen,
          done(report) {
            if (!advancesSticky(report) || sticky !== chosen) return;
            const next = order[(order.indexOf(chosen) + 1) % order.length];
            if (failback !== undefined && chosen === first && next !== first) {
              leftFirstAt = failback.now();
            }
            sticky = next;
          },
        },
      ];
    },
  };
}

function advancesSticky(report: DoneInfo): boolean {
  return (
    report.attempted &&
    (report.code === "NET_UNREACHABLE" || report.code === "NET_UNAVAILABLE")
  );
}

/** First member at or after `offset`, wrapping, that is a candidate of this pick. */
function nextCandidate(
  order: readonly string[],
  offset: number,
  candidates: readonly string[],
): string | undefined {
  return (
    order.find(
      (endpoint, index) => index >= offset && candidates.includes(endpoint),
    ) ?? order.find((endpoint) => candidates.includes(endpoint))
  );
}
