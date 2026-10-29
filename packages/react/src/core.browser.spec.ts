import { createClient, type Client } from "@defjs/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider, useClient } from "./core";

afterEach(cleanup);

describe("ClientProvider", () => {
  it("provides the exact client instance supplied by the caller", () => {
    const client = createClient();
    let injectedClient: Client | undefined;

    function Child() {
      injectedClient = useClient();
      return null;
    }

    render(createElement(ClientProvider, { client }, createElement(Child)));

    expect(injectedClient).toBe(client);
  });

  it("updates the client without resetting consumer state", () => {
    const first = createClient();
    const second = createClient();
    let received: Client | undefined;

    function Consumer() {
      const [count, setCount] = useState(0);
      received = useClient();
      return createElement(
        "button",
        { onClick: () => setCount((value) => value + 1) },
        String(count),
      );
    }

    const view = render(
      createElement(ClientProvider, { client: first }, createElement(Consumer)),
    );
    expect(received).toBe(first);
    fireEvent.click(view.getByRole("button"));
    expect(view.getByRole("button").textContent).toBe("1");

    view.rerender(
      createElement(
        ClientProvider,
        { client: second },
        createElement(Consumer),
      ),
    );
    expect(received).toBe(second);
    expect(view.getByRole("button").textContent).toBe("1");
  });

  it("resolves the nearest client in nested provider trees", () => {
    const outerClient = createClient();
    const innerClient = createClient();
    let outerInjectedClient: Client | undefined;
    let innerInjectedClient: Client | undefined;

    function OuterChild() {
      outerInjectedClient = useClient();
      return createElement(
        ClientProvider,
        { client: innerClient },
        createElement(InnerChild),
      );
    }

    function InnerChild() {
      innerInjectedClient = useClient();
      return null;
    }

    render(
      createElement(
        ClientProvider,
        { client: outerClient },
        createElement(OuterChild),
      ),
    );

    expect(outerInjectedClient).toBe(outerClient);
    expect(innerInjectedClient).toBe(innerClient);
  });
});

describe("useClient", () => {
  it.each([
    ["explicit only", false, true],
    ["context with undefined override", true, false],
    ["explicit before context", true, true],
  ] as const)("selects the client: %s", (_name, hasProvider, hasOverride) => {
    const provided = createClient();
    const explicit = createClient();
    let received: Client | undefined;

    function Consumer() {
      received = useClient(hasOverride ? explicit : undefined);
      return null;
    }

    const child = createElement(Consumer);
    render(
      hasProvider
        ? createElement(ClientProvider, { client: provided }, child)
        : child,
    );
    expect(received).toBe(hasOverride ? explicit : provided);
  });

  it("switches overrides without changing hook order or the provided value", () => {
    const providedA = createClient();
    const providedB = createClient();
    const explicitA = createClient();
    const explicitB = createClient();
    let selected: Client | undefined;
    let ambient: Client | undefined;

    function Consumer({ overrideClient }: { overrideClient?: Client }) {
      selected = useClient(overrideClient);
      ambient = useClient();
      const [count, setCount] = useState(0);
      return createElement(
        "button",
        { onClick: () => setCount((value) => value + 1) },
        String(count),
      );
    }

    const tree = (provided: Client, overrideClient?: Client) =>
      createElement(
        ClientProvider,
        { client: provided },
        createElement(Consumer, { overrideClient }),
      );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const view = render(tree(providedA, explicitA));
      fireEvent.click(view.getByRole("button"));

      const assertSelection = (
        expectedSelected: Client,
        expectedAmbient: Client,
      ) => {
        expect(selected).toBe(expectedSelected);
        expect(ambient).toBe(expectedAmbient);
        expect(view.getByRole("button").textContent).toBe("1");
      };

      assertSelection(explicitA, providedA);
      view.rerender(tree(providedA));
      assertSelection(providedA, providedA);
      view.rerender(tree(providedA, explicitB));
      assertSelection(explicitB, providedA);
      view.rerender(tree(providedB, explicitB));
      assertSelection(explicitB, providedB);
      view.rerender(tree(providedB));
      assertSelection(providedB, providedB);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("throws when no provider is present", () => {
    function Child() {
      useClient();
      return null;
    }

    expect(() => render(createElement(Child))).toThrow(
      "No Defjs client provided. Did you forget to wrap your app in <ClientProvider>?",
    );
  });
});
