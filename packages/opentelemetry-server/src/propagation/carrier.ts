import type { TextMapGetter, TextMapSetter } from "@opentelemetry/api";

// `Headers` and `URLSearchParams` share a `set` that replaces an earlier value of the same name.
export const carrierSetter: TextMapSetter<Headers | URLSearchParams> = {
  set: (carrier, key, value) => carrier.set(key, value),
};

export const headersGetter: TextMapGetter<Headers> = {
  keys: (carrier) => [...carrier.keys()],
  get: (carrier, key) => carrier.get(key) ?? undefined,
};
