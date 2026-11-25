import { struct } from "@defjs/core";
import { type } from "arktype";
import { bench, do_not_optimize, group, run } from "mitata";
import * as v from "valibot";
import { z } from "zod";
import { roundTo } from "./stats.ts";
import type { StructBenchEntry } from "./types.ts";

// ---------- 1. Flat 6-field object ----------

const flatFixture = {
  id: 1042,
  name: "Alice Johnson",
  email: "alice@example.com",
  active: true,
  score: 98.5,
  role: "admin" as const,
};

const defFlat = struct.object({
  id: struct.number(),
  name: struct.string(),
  email: struct.string(),
  active: struct.boolean(),
  score: struct.number(),
  role: struct.enum(["admin", "member"]),
});

const zodFlat = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  score: z.number(),
  role: z.enum(["admin", "member"]),
});

const valibotFlat = v.object({
  id: v.number(),
  name: v.string(),
  email: v.string(),
  active: v.boolean(),
  score: v.number(),
  role: v.picklist(["admin", "member"]),
});

const arkFlat = type({
  id: "number",
  name: "string",
  email: "string",
  active: "boolean",
  score: "number",
  role: "'admin' | 'member'",
});

// ---------- 2. 3-level nested object with alias + Date decoding ----------

const nestedWireFixture = {
  order_id: "ord_9001",
  created_at: "2026-06-15T12:30:00.000Z",
  customer_profile: {
    customer_id: 77,
    billing_address: {
      postal_code: "94107",
      country_code: "US",
    },
  },
};

const defNested = struct.object({
  orderId: struct.string().alias("order_id"),
  createdAt: struct.date().alias("created_at"),
  customerProfile: struct
    .object({
      customerId: struct.number().alias("customer_id"),
      billingAddress: struct
        .object({
          postalCode: struct.string().alias("postal_code"),
          countryCode: struct.string().alias("country_code"),
        })
        .alias("billing_address"),
    })
    .alias("customer_profile"),
});

const zodNested = z
  .object({
    order_id: z.string(),
    created_at: z.iso.datetime().transform((s) => new Date(s)),
    customer_profile: z.object({
      customer_id: z.number(),
      billing_address: z.object({
        postal_code: z.string(),
        country_code: z.string(),
      }),
    }),
  })
  .transform((wire) => ({
    orderId: wire.order_id,
    createdAt: wire.created_at,
    customerProfile: {
      customerId: wire.customer_profile.customer_id,
      billingAddress: {
        postalCode: wire.customer_profile.billing_address.postal_code,
        countryCode: wire.customer_profile.billing_address.country_code,
      },
    },
  }));

const valibotNested = v.pipe(
  v.object({
    order_id: v.string(),
    created_at: v.pipe(
      v.string(),
      v.isoTimestamp(),
      v.transform((s) => new Date(s)),
    ),
    customer_profile: v.object({
      customer_id: v.number(),
      billing_address: v.object({
        postal_code: v.string(),
        country_code: v.string(),
      }),
    }),
  }),
  v.transform((wire) => ({
    orderId: wire.order_id,
    createdAt: wire.created_at,
    customerProfile: {
      customerId: wire.customer_profile.customer_id,
      billingAddress: {
        postalCode: wire.customer_profile.billing_address.postal_code,
        countryCode: wire.customer_profile.billing_address.country_code,
      },
    },
  })),
);

const arkNested = type({
  order_id: "string",
  created_at: "string.date.parse",
  customer_profile: {
    customer_id: "number",
    billing_address: {
      postal_code: "string",
      country_code: "string",
    },
  },
}).pipe((wire) => ({
  orderId: wire.order_id,
  createdAt: wire.created_at,
  customerProfile: {
    customerId: wire.customer_profile.customer_id,
    billingAddress: {
      postalCode: wire.customer_profile.billing_address.postal_code,
      countryCode: wire.customer_profile.billing_address.country_code,
    },
  },
}));

// ---------- 3. 1,000-item array ----------

const arrayFixture = Array.from({ length: 1_000 }, (_, i) => ({
  id: i,
  sku: `SKU-${i}`,
  qty: (i % 9) + 1,
  price: 19.99,
  inStock: i % 2 === 0,
}));

const defArray = struct.array(
  struct.object({
    id: struct.number(),
    sku: struct.string(),
    qty: struct.number(),
    price: struct.number(),
    inStock: struct.boolean(),
  }),
);

const zodArray = z.array(
  z.object({
    id: z.number(),
    sku: z.string(),
    qty: z.number(),
    price: z.number(),
    inStock: z.boolean(),
  }),
);

const valibotArray = v.array(
  v.object({
    id: v.number(),
    sku: v.string(),
    qty: v.number(),
    price: v.number(),
    inStock: v.boolean(),
  }),
);

const arkArray = type({
  id: "number",
  sku: "string",
  qty: "number",
  price: "number",
  inStock: "boolean",
}).array();

// ---------- 4. Fail-fast invalid fixtures ----------

const invalidArrayFirstFixture: unknown[] = [
  { id: "not-a-number", sku: "SKU-0", qty: 1, price: 19.99, inStock: true },
  ...arrayFixture.slice(1),
];

const invalidNestedDeepFixture = {
  order_id: "ord_9001",
  created_at: "2026-06-15T12:30:00.000Z",
  customer_profile: {
    customer_id: 77,
    billing_address: {
      postal_code: 94107,
      country_code: "US",
    },
  },
};

function verifyEquivalence(): void {
  const [defErr, defVal] = struct.parse(defFlat, flatFixture);
  if (defErr) throw defErr;
  if (!Bun.deepEquals(defVal, zodFlat.parse(flatFixture))) {
    throw new Error("Flat output mismatch with zod");
  }
  if (!Bun.deepEquals(defVal, v.parse(valibotFlat, flatFixture))) {
    throw new Error("Flat output mismatch with valibot");
  }
  const arkFlatOut = arkFlat(flatFixture);
  if (
    arkFlatOut instanceof type.errors ||
    !Bun.deepEquals(defVal, arkFlatOut)
  ) {
    throw new Error("Flat output mismatch with arktype");
  }

  const [defNestedErr, defNestedVal] = struct.parse(
    defNested,
    nestedWireFixture,
    { aliases: true },
  );
  if (defNestedErr) throw defNestedErr;
  const zodNestedVal = zodNested.parse(nestedWireFixture);
  const valibotNestedVal = v.parse(valibotNested, nestedWireFixture);
  const arkNestedVal = arkNested(nestedWireFixture);
  if (
    arkNestedVal instanceof type.errors ||
    defNestedVal.createdAt.getTime() !== zodNestedVal.createdAt.getTime() ||
    defNestedVal.createdAt.getTime() !== valibotNestedVal.createdAt.getTime() ||
    defNestedVal.createdAt.getTime() !== arkNestedVal.createdAt.getTime()
  ) {
    throw new Error("Nested Date decode mismatch across libraries");
  }
  if (
    defNestedVal.customerProfile.billingAddress.postalCode !== "94107" ||
    zodNestedVal.customerProfile.billingAddress.postalCode !== "94107" ||
    valibotNestedVal.customerProfile.billingAddress.postalCode !== "94107" ||
    arkNestedVal.customerProfile.billingAddress.postalCode !== "94107"
  ) {
    throw new Error("Nested alias remapping mismatch");
  }

  if (struct.parse(defArray, arrayFixture)[0] !== null) {
    throw new Error("@defjs/core valid array failed");
  }
  if (struct.parse(defArray, invalidArrayFirstFixture)[0] === null) {
    throw new Error("@defjs/core invalid array unexpectedly succeeded");
  }
  if (zodArray.safeParse(invalidArrayFirstFixture).success) {
    throw new Error("zod invalid array unexpectedly succeeded");
  }
  if (v.safeParse(valibotArray, invalidArrayFirstFixture).success) {
    throw new Error("valibot invalid array unexpectedly succeeded");
  }
  if (!(arkArray(invalidArrayFirstFixture) instanceof type.errors)) {
    throw new Error("arktype invalid array unexpectedly succeeded");
  }

  if (
    struct.parse(defNested, invalidNestedDeepFixture, { aliases: true })[0] ===
    null
  ) {
    throw new Error("@defjs/core invalid deep object unexpectedly succeeded");
  }
  if (zodNested.safeParse(invalidNestedDeepFixture).success) {
    throw new Error("zod invalid deep object unexpectedly succeeded");
  }
  if (v.safeParse(valibotNested, invalidNestedDeepFixture).success) {
    throw new Error("valibot invalid deep object unexpectedly succeeded");
  }
  if (!(arkNested(invalidNestedDeepFixture) instanceof type.errors)) {
    throw new Error("arktype invalid deep object unexpectedly succeeded");
  }
}

export async function runStructBench(): Promise<StructBenchEntry[]> {
  verifyEquivalence();

  const registerScenario = async (
    scenario: string,
    cases: ReadonlyArray<{
      readonly library: string;
      readonly fn: () => unknown;
    }>,
  ) => {
    await group(scenario, async () => {
      for (const item of cases) {
        bench(`${scenario}::${item.library}`, () => {
          do_not_optimize(item.fn());
        });
      }
    });
  };

  await registerScenario("flat-6-fields", [
    { library: "@defjs/core", fn: () => struct.parse(defFlat, flatFixture) },
    { library: "zod", fn: () => zodFlat.safeParse(flatFixture) },
    { library: "valibot", fn: () => v.safeParse(valibotFlat, flatFixture) },
    { library: "arktype", fn: () => arkFlat(flatFixture) },
  ]);

  await registerScenario("nested-3-level-alias-date", [
    {
      library: "@defjs/core",
      fn: () => struct.parse(defNested, nestedWireFixture, { aliases: true }),
    },
    { library: "zod", fn: () => zodNested.safeParse(nestedWireFixture) },
    {
      library: "valibot",
      fn: () => v.safeParse(valibotNested, nestedWireFixture),
    },
    { library: "arktype", fn: () => arkNested(nestedWireFixture) },
  ]);

  await registerScenario("array-1000-items", [
    { library: "@defjs/core", fn: () => struct.parse(defArray, arrayFixture) },
    { library: "zod", fn: () => zodArray.safeParse(arrayFixture) },
    { library: "valibot", fn: () => v.safeParse(valibotArray, arrayFixture) },
    { library: "arktype", fn: () => arkArray(arrayFixture) },
  ]);

  await registerScenario("invalid-array-first", [
    {
      library: "@defjs/core",
      fn: () => struct.parse(defArray, invalidArrayFirstFixture),
    },
    {
      library: "zod",
      fn: () => zodArray.safeParse(invalidArrayFirstFixture),
    },
    {
      library: "valibot",
      fn: () => v.safeParse(valibotArray, invalidArrayFirstFixture),
    },
    { library: "arktype", fn: () => arkArray(invalidArrayFirstFixture) },
  ]);

  await registerScenario("invalid-nested-deep", [
    {
      library: "@defjs/core",
      fn: () =>
        struct.parse(defNested, invalidNestedDeepFixture, { aliases: true }),
    },
    {
      library: "zod",
      fn: () => zodNested.safeParse(invalidNestedDeepFixture),
    },
    {
      library: "valibot",
      fn: () => v.safeParse(valibotNested, invalidNestedDeepFixture),
    },
    {
      library: "arktype",
      fn: () => arkNested(invalidNestedDeepFixture),
    },
  ]);

  const result = await run({ format: "quiet" });
  const entries: StructBenchEntry[] = [];

  for (const trial of result.benchmarks) {
    const separator = trial.alias.indexOf("::");
    if (separator === -1) continue;
    const scenario = trial.alias.slice(0, separator);
    const library = trial.alias.slice(separator + 2);
    const firstRun = trial.runs[0];
    if (!firstRun || !firstRun.stats) {
      throw new Error(
        `Benchmark ${trial.alias} failed: ${String(firstRun?.error)}`,
      );
    }
    const { avg, p50, p75, p99 } = firstRun.stats;
    entries.push({
      scenario,
      library,
      avgNs: roundTo(avg, 2),
      medianNs: roundTo(p50, 2),
      p75Ns: roundTo(p75, 2),
      p99Ns: roundTo(p99, 2),
      opsPerSec: roundTo(1_000_000_000 / avg, 0),
    });
  }

  return entries;
}

if (import.meta.main) {
  const entries = await runStructBench();
  console.log(JSON.stringify(entries, null, 2));
}
