// #region example
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async (input, init) => {
    const request = new Request(input, init);
    const id = new URL(request.url).pathname.split("/").at(-1);
    if (id === "7")
      return Response.json({ id: 7, name: "Ada" }, { status: 200 });
    return Response.json({ message: "User not found" }, { status: 404 });
  }),
);
async function main() {
  const command = getUser({ id: 7 });
  const [error, user, response] = await client.execute(command);
  if (error) {
    // The test boundary rejects failures so the test process cannot pass.
    throw error;
  }
  console.log(user.name, response.status);
}

await main();
// #endregion
