// #region example
import {
  createClient,
  createOperationInterceptor,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";

const timing = createOperationInterceptor(async (call, next) => {
  const started = performance.now();
  const result = await next();
  const [err] = result;
  console.info(
    `${call.method} ${call.path}`,
    err ? err.code : "ok",
    Math.round(performance.now() - started),
  );
  return result;
});

const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(timing),
);
// #endregion
