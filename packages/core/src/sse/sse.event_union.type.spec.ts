/**
 * Pins why the event construction in sse.ts keeps one type assertion.
 *
 * A single helper indexed by the event key compiles. Building the three members of
 * the public `EventStreamData` union separately (known, default, numeric) does not:
 * the event name is a runtime string and TypeScript cannot pick one distributive
 * member from it. Each `@ts-expect-error` below fails the type check as soon as
 * TypeScript accepts the construction, which is the signal to remove the assertion.
 */
type Struct<O = unknown> = { readonly output: O };
type Events = Record<string, Struct>;
type Infer<S> = S extends Struct<infer O> ? O : never;
type Name<K extends string | number> = `${K}`;
type Known<E extends Events> = {
  [K in keyof E & (number | string)]: Name<K> extends "default"
    ? never
    : { event: Name<K>; data: Infer<E[K]>; id?: string };
}[keyof E & (number | string)];
type Default<E extends Events> = "default" extends keyof E
  ? { event: string; data: Infer<E["default"]>; id?: string }
  : never;
type Data<E extends Events> = E extends Events ? Known<E> | Default<E> : never;

type SimpleMap<E extends Events> = {
  [K in keyof E & string]: { event: K; data: Infer<E[K]>; id?: string };
};
function simple<E extends Events, K extends keyof E & string>(
  event: K,
  data: Infer<E[K]>,
  id?: string,
): SimpleMap<E>[K] {
  return { event, data, id };
}

function known<
  E extends Events,
  K extends Exclude<keyof E & string, "default">,
>(event: K, data: Infer<E[K]>, id?: string): Data<E> {
  // @ts-expect-error the key cannot select the distributive known member
  return { event, data, id };
}
function fallback<E extends Events & { default: Struct }>(
  event: string,
  data: Infer<E["default"]>,
  id?: string,
): Data<E> {
  // @ts-expect-error the key cannot select the distributive default member
  return { event, data, id };
}
function numeric<E extends Events, K extends keyof E & number>(
  event: K,
  data: Infer<E[K]>,
  id?: string,
): Data<E> {
  // @ts-expect-error the key cannot select the distributive numeric member
  return { event: `${event}`, data, id };
}

void simple;
void known;
void fallback;
void numeric;
