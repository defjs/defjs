// #region example
import { expect, test } from "vitest";
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
  withSSEHandle,
  type Client,
} from "@defjs/core";

const watchDeployments = defineEventStream({
  path: "/deployments/:id/events",
  input: struct.object({ id: struct.string() }),
  builder: (input) => ({ path: input }),
  events: {
    progress: struct.object({
      step: struct.string(),
      percent: struct.number(),
    }),
  },
});

export async function collectDeploymentSteps(
  client: Client,
  id: string,
): Promise<[Error, undefined] | [null, string[]]> {
  const [err, stream] = await watchDeployments(client, { id });
  if (err) {
    return [new Error("watch deployments", { cause: err }), undefined];
  }

  await using ownedStream = stream;
  const steps: string[] = [];
  try {
    for await (const event of ownedStream) {
      steps.push(`${event.data.step}:${event.data.percent}%`);
    }
  } catch (cause) {
    return [new Error("read deployment stream", { cause }), undefined];
  }
  return [null, steps];
}

test("collectDeploymentSteps reads progress events from an in-memory SSE stream", async () => {
  const frames = [
    'id: evt-1\nevent: progress\ndata: {"step":"build","percent":50}\n\n',
    'id: evt-2\nevent: progress\ndata: {"step":"deploy","percent":100}\n\n',
  ].join("");

  const client = createClient(
    withEndpoint("https://fixture.invalid"),
    withSSEHandle((input) => {
      const request = new Request(input);
      expect(request.url).toBe(
        "https://fixture.invalid/deployments/dep-9/events",
      );
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frames));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    }),
  );

  const [err, steps] = await collectDeploymentSteps(client, "dep-9");
  expect(err).toBeNull();
  if (err) throw err;
  expect(steps).toEqual(["build:50%", "deploy:100%"]);
});
// #endregion
