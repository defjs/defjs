import { expect, test, vi } from "vitest";
import { apiEntries, filterApiEntries } from "./api-catalog";
import type { ApiEntry } from "./api-catalog";
const entries: ApiEntry[] = [
  {
    package: "@defjs/core",
    name: "createClient",
    kind: "function",
    slug: "core/create-client",
    related: [],
  },
  {
    package: "@defjs/react",
    name: "createClient",
    kind: "function",
    slug: "react/create-client",
    related: [],
  },
  {
    package: "@defjs/core",
    name: "ClientOption",
    kind: "type",
    slug: "core/client-option",
    related: [],
  },
];
test("API search ignores case and combines package and category filters", () => {
  expect(
    filterApiEntries(entries, "CREATE", "@defjs/core", "function").map(
      (entry) => entry.slug,
    ),
  ).toEqual(["core/create-client"]);
  expect(filterApiEntries(entries, "", "", "function")).toHaveLength(2);
  expect(filterApiEntries(entries, "missing", "", "")).toEqual([]);
});
test("API search matches ASCII identifiers independently of Turkish locale folding", () => {
  const localeLowerCase = Reflect.get(String.prototype, "toLocaleLowerCase");
  const turkishFold = vi
    .spyOn(String.prototype, "toLocaleLowerCase")
    .mockImplementation(function (this: string) {
      return Reflect.apply(localeLowerCase, this, ["tr-TR"]);
    });
  try {
    expect("I".toLocaleLowerCase()).toBe("ı");
    expect(
      filterApiEntries(
        apiEntries,
        "interceptor",
        "@defjs/core",
        "function",
      ).map((entry) => entry.name),
    ).toContain("createHttpInterceptor");
    expect(
      filterApiEntries(entries, "CREATECLIENT", "@defjs/core", "function").map(
        (entry) => entry.slug,
      ),
    ).toEqual(["core/create-client"]);
    expect(
      filterApiEntries(entries, "I", "@defjs/core", "function").map(
        (entry) => entry.slug,
      ),
    ).toEqual(["core/create-client"]);
    expect(filterApiEntries(entries, "ı", "@defjs/core", "function")).toEqual(
      [],
    );
  } finally {
    turkishFold.mockRestore();
  }
});
