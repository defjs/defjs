import { createClient, type DerivableClient } from "@defjs/core";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, expect, test } from "vitest";
import { ClientProvider, useClient } from "./core";

afterEach(cleanup);

// An element that records what `useClient(override)` returned on its last render.
function probe(override?: DerivableClient): {
  seen: { client?: DerivableClient };
  element: ReactElement;
} {
  const seen: { client?: DerivableClient } = {};
  function Probe() {
    seen.client = useClient(override);
    return null;
  }
  return { seen, element: createElement(Probe) };
}

test("ClientProvider provides the client it is given", () => {
  const client = createClient();
  const { seen, element } = probe();

  render(createElement(ClientProvider, { client }, element));

  expect(seen.client).toBe(client);
});

test("a different client prop reaches the descendants", () => {
  const first = createClient();
  const second = createClient();
  const { seen, element } = probe();

  const view = render(
    createElement(ClientProvider, { client: first }, element),
  );
  expect(seen.client).toBe(first);

  view.rerender(createElement(ClientProvider, { client: second }, element));
  expect(seen.client).toBe(second);
});

test("a nested ClientProvider overrides the client for its own subtree", () => {
  const outer = createClient();
  const inner = createClient();
  const outside = probe();
  const inside = probe();

  render(
    createElement(
      ClientProvider,
      { client: outer },
      outside.element,
      createElement(ClientProvider, { client: inner }, inside.element),
    ),
  );

  expect(outside.seen.client).toBe(outer);
  expect(inside.seen.client).toBe(inner);
});

const provided = createClient();
const explicit = createClient();

test.each([
  {
    name: "the explicit client without a provider",
    provider: undefined,
    override: explicit,
    expected: explicit,
  },
  {
    name: "the provided client for an undefined override",
    provider: provided,
    override: undefined,
    expected: provided,
  },
  {
    name: "the explicit client before the provided one",
    provider: provided,
    override: explicit,
    expected: explicit,
  },
])("useClient returns $name", ({ provider, override, expected }) => {
  const { seen, element } = probe(override);

  render(
    provider
      ? createElement(ClientProvider, { client: provider }, element)
      : element,
  );

  expect(seen.client).toBe(expected);
});

test("an explicit client does not replace the provided one for other reads", () => {
  let selected: DerivableClient | undefined;
  let ambient: DerivableClient | undefined;
  function Consumer() {
    selected = useClient(explicit);
    ambient = useClient();
    return null;
  }

  render(
    createElement(
      ClientProvider,
      { client: provided },
      createElement(Consumer),
    ),
  );

  expect(selected).toBe(explicit);
  expect(ambient).toBe(provided);
});

test("useClient throws without an explicit client or a provider", () => {
  expect(() => render(probe().element)).toThrow(
    "No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?",
  );
});
