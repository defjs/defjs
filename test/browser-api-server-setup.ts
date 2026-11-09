import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  selectStartup,
  type StartupLayer,
} from "../packages/core/test/fixture/startup.ts";
import { assertRuntime } from "./runtime-guard.ts";

function createUsersApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin(origin) {
        return origin || "*";
      },
      allowHeaders: ["*", "Accept", "Content-Type"],
      allowMethods: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],
      credentials: true,
    }),
  );

  app.get("/api/users", (c) => {
    return c.json([
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ]);
  });

  app.get("/api/users/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ id: Number(id), name: "John" });
  });

  return app;
}

export function createBrowserApiSetup(
  selectStartup: () => Promise<StartupLayer>,
): (project: {
  provide(key: "testServerHost", value: string): void;
}) => Promise<() => Promise<void>> {
  return async function setup(project) {
    assertRuntime("browser-main");
    const layer = await selectStartup();
    const server = await layer.startHttp(createUsersApp());
    project.provide("testServerHost", server.origin);
    return () => server.close();
  };
}

export const setup = createBrowserApiSetup(selectStartup);
