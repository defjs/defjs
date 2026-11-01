// #region example
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});

async function main(abort: AbortSignal) {
  const requestClient = client({
    abort,
    onDownloadProgress(event) {
      console.log(event.loaded);
    },
  });
  const [error, user] = await getUser(requestClient, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}

void main;
// #endregion
