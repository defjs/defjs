// #region example
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getUser } from "./define-request.ts";

const handle: FetchHandle = async (input, init) => {
  const request = new Request(input, init);
  const id = new URL(request.url).pathname.split("/").at(-1);

  if (id === "7") {
    return Response.json({ id: 7, name: "Ada" }, { status: 200 });
  }

  return Response.json({ message: "User not found" }, { status: 404 });
};

const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(handle),
);

async function main() {
  const command = getUser({ id: 7 });
  const [error, user, response] = await client.execute(command, {
    timeout: 5_000,
  });
  if (error?.code === "HTTP_STATUS" && error.status === 404) {
    console.log(error.data.message);
    return;
  }
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(`Loaded ${user.name} from ${response.status}`);
}

void main();
// #endregion
