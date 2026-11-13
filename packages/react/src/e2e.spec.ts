import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect, useState } from "react";
import { afterEach, expect, inject, test } from "vitest";
import { ClientProvider, useClient } from "./core";

afterEach(cleanup);

const getUsers = defineRequest({
  method: "GET",
  path: "/api/users",
  output: struct.array(
    struct.object({ id: struct.number(), name: struct.string() }),
  ),
});

function UserList() {
  const client = useClient();
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    void getUsers(client).then(([error, users]) => {
      setNames(error ? [error.code] : users.map((user) => user.name));
    });
  }, [client]);

  return createElement(
    "ul",
    null,
    names.map((name) => createElement("li", { key: name }, name)),
  );
}

test("a component renders data requested with the provided client", async () => {
  const client = createClient(withEndpoint(inject("testServerHost")));

  render(createElement(ClientProvider, { client }, createElement(UserList)));

  await waitFor(
    () => {
      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent),
      ).toEqual(["John", "Jane"]);
    },
    { timeout: 10_000 },
  );
});
