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
    const [err, result] = await health(client);
    if (err) {
      console.error(err.code);
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
