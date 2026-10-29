import { expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getUser } from "./users-sdk";

test("one exported SDK endpoint uses each application's client and preserves typed failures", async () => {
  const requests: { url: string; authorization: string | null }[] = [];
  const handle: FetchHandle = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
    });
    return new URL(request.url).hostname === "first.example.test"
      ? Response.json({ id: 7, name: "Ada" })
      : Response.json({ message: "User not found" }, { status: 404 });
  };
  const first = createClient(
    withEndpoint("https://first.example.test/v1"),
    withHeaders({ authorization: "Bearer first-fixture" }),
    withHTTPHandle(handle),
  );
  const second = createClient(
    withEndpoint("https://second.example.test/v2"),
    withHeaders({ authorization: "Bearer second-fixture" }),
    withHTTPHandle(handle),
  );

  const command = getUser({ id: 7 });
  expect(requests).toEqual([]);
  const [successError, user] = await first.execute(command);
  const [missing, absent] = await second.execute(getUser({ id: 7 }));

  expect(successError).toBeNull();
  expect(user).toEqual({ id: 7, name: "Ada" });
  expect(absent).toBeUndefined();
  expect(missing?.code).toBe("HTTP_STATUS");
  if (missing?.code === "HTTP_STATUS") {
    expect(missing.status).toBe(404);
    expect(missing.data?.message).toBe("User not found");
  }
  expect(requests).toEqual([
    {
      url: "https://first.example.test/v1/users/7",
      authorization: "Bearer first-fixture",
    },
    {
      url: "https://second.example.test/v2/users/7",
      authorization: "Bearer second-fixture",
    },
  ]);
});
