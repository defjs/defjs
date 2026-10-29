// #region example
import { defineRequest, struct } from "@defjs/core";
import { useClient } from "@defjs/react";

const health = defineRequest({
  method: "GET",
  path: "/health",
  output: struct.object({ ok: struct.boolean() }),
});

export function HealthCheck() {
  const client = useClient();

  const check = async () => {
    const [error, result] = await client.execute(health());
    if (error) {
      console.error(error.code);
      return;
    }
    console.log(result.ok);
  };

  return (
    <button type="button" onClick={() => void check()}>
      Check service
    </button>
  );
}
// #endregion
