// #region example
import { createClient, withEndpoint, withQuerySerializer } from "@defjs/core";

const client = createClient(
  withEndpoint("https://api.example.com"),
  withQuerySerializer((query) => {
    const params = new URLSearchParams();
    const append = (key: string, value: unknown) => {
      if (Array.isArray(value)) {
        for (const item of value) append(key, item);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [child, nested] of Object.entries(value)) {
          append(`${key}[${child}]`, nested);
        }
        return;
      }
      if (value !== undefined) params.append(key, String(value));
    };
    for (const [key, value] of Object.entries(query)) append(key, value);
    return params.toString();
  }),
);
// #endregion
