export interface Round13Settings {
  seed: number;
  attempts: number;
  depth: number;
  exotic: boolean;
}

export function readRound13Settings(
  env: Readonly<Record<string, string | undefined>>,
): Round13Settings {
  function readCount(name: string, fallback: number): number {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  }

  return {
    seed: readCount("ROUND13_SEED", 0x13c0ffee),
    attempts: readCount("ROUND13_ATTEMPTS", 1_000),
    depth: readCount("ROUND13_DEPTH", 4),
    exotic: env["ROUND13_EXOTIC"] === "1",
  };
}
