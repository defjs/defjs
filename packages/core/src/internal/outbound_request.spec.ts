import { describe, expect, test } from "vitest";
import {
  createClient,
  withEndpoint,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
} from "../client";
import { createHttpInterceptor } from "../interceptor";
import { makeResponse } from "./http_response";
import { parseEndpointInput } from "./endpoint_input";
import { materializeOutboundRequest } from "./outbound_request";
import { createHttpRequest } from "../http/request";
import { defineRequest } from "../http/http";
import { defineEventStream } from "../sse/sse";
import { struct } from "../struct";
import { STRUCT } from "../struct/symbols";
import { DEFINITION } from "../struct/symbols";
import { transformWebSocketMessage } from "../web_socket/codec";
import { defineWebSocket } from "../web_socket/web_socket";

const birthday = new Date("1815-12-10T00:00:00.000Z");

const Profile = struct.object({
  displayName: struct.string().alias("display_name"),
  birthday: struct.date(),
});

const UserInput = struct.object({
  userId: struct.number().alias("user_id"),
  profile: Profile,
});

function readUnknown(value: unknown): unknown {
  return value;
}

function isDictionary(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function definitionOf(value: unknown): { codec?: string; kind: string } {
  if (typeof value !== "object" || value === null || !(DEFINITION in value)) {
    throw new Error("expected a runtime struct");
  }
  const definition = value[DEFINITION];
  if (
    typeof definition !== "object" ||
    definition === null ||
    !("kind" in definition) ||
    typeof definition.kind !== "string"
  ) {
    throw new Error("expected a struct definition");
  }
  const codec =
    "codec" in definition && typeof definition.codec === "string"
      ? definition.codec
      : undefined;
  return { codec, kind: definition.kind };
}

async function formBlob(
  value: unknown,
): Promise<{ text: string; type: string }> {
  expect(value).toBeInstanceOf(Blob);
  if (!(value instanceof Blob)) {
    throw new Error("expected a blob");
  }
  return { text: await value.text(), type: value.type };
}

function structOf(value: object): object {
  if (!(STRUCT in value)) {
    throw new Error("expected a struct tag");
  }
  const tag = value[STRUCT];
  if (typeof tag !== "object" || tag === null) {
    throw new Error("expected a struct tag");
  }
  return tag;
}

function ownData(key: string, value: unknown): { [key: string]: unknown } {
  const record: { [key: string]: unknown } = {};
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return record;
}

function protoStringShape(): {
  [key: string]: ReturnType<typeof struct.string>;
} {
  const shape: { [key: string]: ReturnType<typeof struct.string> } = {};
  Object.defineProperty(shape, "__proto__", {
    configurable: true,
    enumerable: true,
    value: struct.string(),
    writable: true,
  });
  return shape;
}

function expectUntagged(value: unknown): void {
  if (!isDictionary(value)) {
    throw new Error("expected an object");
  }
  expect(value).toEqual(expect.any(Object));
  expect(Object.getOwnPropertySymbols(value)).not.toContain(STRUCT);
}

function readTag(value: object): unknown {
  return STRUCT in value ? value[STRUCT] : undefined;
}

function jsonObject(value: unknown): { [key: string]: unknown } {
  const parsed = readUnknown(JSON.parse(String(value)));
  if (!isDictionary(parsed)) {
    throw new Error("expected a json object");
  }
  return parsed;
}

function nestedObject(
  value: { [key: string]: unknown },
  key: string,
): { [key: string]: unknown } {
  const child = value[key];
  if (!isDictionary(child)) {
    throw new Error(`expected ${key} to be an object`);
  }
  return child;
}

function bodyForm(value: unknown): FormData {
  if (!(value instanceof FormData)) {
    throw new Error("expected FormData");
  }
  return value;
}

function bodyParams(value: unknown): URLSearchParams {
  if (!(value instanceof URLSearchParams)) {
    throw new Error("expected URLSearchParams");
  }
  return value;
}

function dictionary(value: unknown): { [key: string]: unknown } {
  const record = readUnknown(value);
  if (!isDictionary(record)) {
    throw new Error("expected an object");
  }
  return record;
}

function objectWithNonFunctionConstructor(): { [key: string]: unknown } {
  const proto = dictionary(Object.create(null));
  Object.defineProperty(proto, "constructor", { value: 1 });
  return dictionary(Object.create(proto));
}

function buildHttp<TInput>(
  method: string,
  path: string,
  input: TInput,
  builder: (value: NoInfer<TInput>) => unknown,
  serializer?: (query: { [key: string]: unknown }) => string,
) {
  return createHttpRequest(method, path, input, builder, {
    signal: new AbortController().signal,
    baseEndpoint: "https://api.example.com",
    querySerializer: serializer,
  });
}

describe("outbound request builder", () => {
  test("turns a header pair array into Headers, which coerces the values", () => {
    const { headers } = materializeOutboundRequest(
      { headers: [["a", 1]] },
      "http",
    );

    expect(headers).toBeInstanceOf(Headers);
    expect(headers instanceof Headers ? headers.get("a") : undefined).toBe("1");
  });

  test("formData and urlencoded are object structs with a codec tag", () => {
    expect(
      definitionOf(struct.formData({ title: struct.string() })),
    ).toMatchObject({ codec: "formData", kind: "object" });
    expect(
      definitionOf(struct.urlencoded({ q: struct.string() })),
    ).toMatchObject({ codec: "urlencoded", kind: "object" });
    expect(
      definitionOf(struct.object({ id: struct.string() })).codec,
    ).toBeUndefined();
  });

  test("encodes an anonymous path record literally", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("GET", "/users/:user_id", input, (value) => ({
      path: { user_id: value.userId },
    }));

    expect(request.endpoint).toBe("/users/7");
  });

  test("rejects a tagged path object that contains a nested field", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });

    expect(() =>
      buildHttp("GET", "/users/:user_id", input, (value) => ({ path: value })),
    ).toThrow(/profile/);
  });

  test("encodes a tagged body with alias, date, and bigint", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: value.profile,
    }));

    expect(request.body).toBe(
      '{"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}',
    );
    expect(request.headers?.has("content-type")).toBe(false);
    expect(request.bodyContentType).toBe("application/json");
  });

  test("encodes a tagged object nested under an anonymous parent", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { profile: value.profile },
    }));

    expect(request.body).toBe(
      '{"profile":{"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}}',
    );
  });

  test("keeps the struct tag when a typed object is spread and adds a literal key", () => {
    const input = parseEndpointInput(Profile, {
      birthday,
      displayName: "Ada",
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { ...value, role: "admin", skip: undefined },
    }));

    expect(request.body).toBe(
      '{"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z","role":"admin"}',
    );
  });

  test("overwrites a logical field and still applies its alias", () => {
    const input = parseEndpointInput(Profile, {
      birthday,
      displayName: "Ada",
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { ...value, displayName: "Bob" },
    }));

    expect(request.body).toBe(
      '{"display_name":"Bob","birthday":"1815-12-10T00:00:00.000Z"}',
    );
  });

  test("rejects a spread key that collides with a wire key", () => {
    const input = parseEndpointInput(Profile, {
      birthday,
      displayName: "Ada",
    });

    expect(() =>
      buildHttp("POST", "/users", input, (value) => ({
        body: { ...value, display_name: "x" },
      })),
    ).toThrow(/display_name/);
  });

  test("keeps a nested spread extra when the parent stays tagged", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { ...value, profile: { ...value.profile, role: "admin" } },
    }));

    expect(request.body).toBe(
      `{"user_id":7,"profile":{"display_name":"Ada","birthday":"${birthday.toISOString()}","role":"admin"}}`,
    );
  });

  test("rejects a nested spread that collides with a wire key", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });

    expect(() =>
      buildHttp("POST", "/users", input, (value) => ({
        body: {
          ...value,
          profile: { ...value.profile, display_name: "shadow" },
        },
      })),
    ).toThrow(/display_name/);
  });

  test("encodes an untagged nested object with the field struct and keeps extras", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: {
        ...value,
        profile: { birthday, displayName: "Bob", role: "admin" },
      },
    }));

    expect(request.body).toBe(
      `{"user_id":7,"profile":{"display_name":"Bob","birthday":"${birthday.toISOString()}","role":"admin"}}`,
    );
  });

  test("encodes nested array items and tuple items with the tagged-object rule", () => {
    const People = struct.object({ people: struct.array(Profile) });
    const people = parseEndpointInput(People, {
      people: [{ birthday, displayName: "Ada" }],
    });
    const peopleRequest = materializeOutboundRequest(
      {
        body: {
          ...people,
          people: [
            { birthday, displayName: "Bob", role: "admin" },
            { ...people.people[0], role: "owner" },
          ],
        },
      },
      "http",
    );
    const Pair = struct.object({
      pair: struct.tuple([Profile, struct.string()]),
    });
    const pair = parseEndpointInput(Pair, {
      pair: [{ birthday, displayName: "Ada" }, "ok"],
    });
    const pairRequest = materializeOutboundRequest(
      {
        body: {
          ...pair,
          pair: [{ ...pair.pair[0], role: "admin" }, pair.pair[1], "extra"],
        },
      },
      "http",
    );

    expect(peopleRequest.body).toBe(
      `{"people":[{"display_name":"Bob","birthday":"${birthday.toISOString()}","role":"admin"},{"display_name":"Ada","birthday":"${birthday.toISOString()}","role":"owner"}]}`,
    );
    expect(pairRequest.body).toBe(
      `{"pair":[{"display_name":"Ada","birthday":"${birthday.toISOString()}","role":"admin"},"ok","extra"]}`,
    );
  });

  test("encodes nested union, intersection, and record values from their own tags", () => {
    const Alpha = struct.object({
      id: struct.number(),
      kind: struct.literal("a"),
      name: struct.string().alias("display_name"),
    });
    const Beta = struct.object({
      kind: struct.literal("b"),
      name: struct.string(),
    });
    const Choice = struct.object({ item: struct.or(Alpha, Beta) });
    const choice = parseEndpointInput(Choice, {
      item: { id: 1, kind: "a", name: "Ada" },
    });
    const taggedChoice = materializeOutboundRequest(
      { body: { ...choice, item: { ...choice.item, role: "admin" } } },
      "http",
    );
    const untaggedChoice = materializeOutboundRequest(
      { body: { ...choice, item: { id: 1, kind: "a", name: "Ada" } } },
      "http",
    );

    const Person = struct.intersection(
      struct.object({ id: struct.number().alias("user_id") }),
      struct.object({ name: struct.string().alias("display_name") }),
    );
    const Wrapped = struct.object({ person: Person });
    const wrapped = parseEndpointInput(Wrapped, {
      person: { id: 7, name: "Ada" },
    });
    const intersection = materializeOutboundRequest(
      { body: { ...wrapped, person: { ...wrapped.person, role: "admin" } } },
      "http",
    );

    const Directory = struct.object({ directory: struct.record(Profile) });
    const directory = parseEndpointInput(Directory, {
      directory: { ada: { birthday, displayName: "Ada" } },
    });
    const record = materializeOutboundRequest(
      {
        body: {
          ...directory,
          directory: { ada: { ...directory.directory["ada"], role: "admin" } },
        },
      },
      "http",
    );

    const Payment = struct.object({ amount: struct.bigint().alias("amt") });
    const Invoice = struct.object({ payment: Payment });
    const invoice = parseEndpointInput(Invoice, {
      payment: { amount: 10n },
    });
    const bigint = materializeOutboundRequest(
      { body: { ...invoice, payment: { ...invoice.payment, note: "cash" } } },
      "http",
    );

    expect(taggedChoice.body).toBe(
      '{"item":{"id":1,"kind":"a","display_name":"Ada","role":"admin"}}',
    );
    expect(untaggedChoice.body).toBe(
      '{"item":{"id":1,"kind":"a","display_name":"Ada"}}',
    );
    expect(intersection.body).toBe(
      '{"person":{"user_id":7,"display_name":"Ada","role":"admin"}}',
    );
    expect(record.body).toBe(
      `{"directory":{"ada":{"display_name":"Ada","birthday":"${birthday.toISOString()}","role":"admin"}}}`,
    );
    expect(bigint.body).toBe('{"payment":{"amt":"10","note":"cash"}}');
    expect(() =>
      materializeOutboundRequest(
        {
          body: { ...choice, item: { ...choice.item, display_name: "shadow" } },
        },
        "http",
      ),
    ).toThrow(/display_name/);
  });

  test("rejects an ambiguous untagged union before encoding one branch", () => {
    const Left = struct.object({ id: struct.string().alias("left_id") });
    const Right = struct.object({ id: struct.string().alias("right_id") });
    const Box = struct.object({ row: struct.or(Left, Right) });
    const input = parseEndpointInput(Box, { row: { id: "42" } });

    expect(() =>
      materializeOutboundRequest(
        { body: { ...input, row: { extra: "kept", id: "42" } } },
        "http",
      ),
    ).toThrow(/ambiguous union encode/);
  });

  test("encodes an untagged discriminated object with aliases and extras", () => {
    const Cat = struct.object({
      kind: struct.literal("cat"),
      name: struct.string().alias("display_name"),
    });
    const Dog = struct.object({
      kind: struct.literal("dog"),
      name: struct.string().alias("dog_name"),
    });
    const Box = struct.object({
      pet: struct.discriminatedUnion("kind", [Cat, Dog]),
    });
    const input = parseEndpointInput(Box, {
      pet: { kind: "cat", name: "Ada" },
    });
    const request = materializeOutboundRequest(
      { body: { ...input, pet: { extra: "kept", kind: "cat", name: "Ada" } } },
      "http",
    );

    expect(request.body).toBe(
      '{"pet":{"kind":"cat","display_name":"Ada","extra":"kept"}}',
    );
  });

  test("encodes an untagged all-object intersection with both aliases and extras", () => {
    const Person = struct.intersection(
      struct.object({ id: struct.number().alias("user_id") }),
      struct.object({ name: struct.string().alias("display_name") }),
    );
    const Box = struct.object({ person: Person });
    const input = parseEndpointInput(Box, {
      person: { id: 7, name: "Ada" },
    });
    const request = materializeOutboundRequest(
      { body: { ...input, person: { id: 7, name: "Ada", role: "admin" } } },
      "http",
    );

    expect(request.body).toBe(
      '{"person":{"user_id":7,"display_name":"Ada","role":"admin"}}',
    );
  });

  test("rejects a union when an object branch and a non-container branch both match", () => {
    const Box = struct.object({
      row: struct.or(
        struct.object({ id: struct.string().alias("wire_id") }),
        struct.any(),
      ),
    });
    const input = parseEndpointInput(Box, { row: { id: "42" } });

    expect(() =>
      materializeOutboundRequest(
        { body: { ...input, row: { extra: "kept", id: "42" } } },
        "http",
      ),
    ).toThrow(/ambiguous union encode/);
  });

  test("recurses through an unmatched union object so tagged children keep aliases", () => {
    const Item = struct.object({ id: struct.string().alias("wire_id") });
    const Box = struct.object({
      payload: struct.or(struct.string(), struct.number()),
    });
    const item = parseEndpointInput(Item, { id: "42" });
    const input = parseEndpointInput(Box, { payload: "x" });
    const request = materializeOutboundRequest(
      { body: { ...input, payload: { row: { ...item, extra: "kept" } } } },
      "http",
    );

    expect(request.body).toBe(
      '{"payload":{"row":{"wire_id":"42","extra":"kept"}}}',
    );
  });

  test("tags a mixed intersection with the conjunction of the matched object sides", () => {
    const Schema = struct.intersection(
      struct.object({ firstName: struct.string().alias("first_name") }),
      struct.or(
        struct.object({ lastName: struct.string().alias("last_name") }),
        struct.number(),
      ),
    );
    const first = parseEndpointInput(Schema, {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const second = parseEndpointInput(Schema, {
      firstName: "Grace",
      lastName: "Hopper",
    });
    const firstTag = readTag(first);
    const secondTag = readTag(second);

    expect(firstTag).toBeDefined();
    expect(secondTag).toBeDefined();
    expect(Object.hasOwn(dictionary(firstTag), DEFINITION)).toBe(false);
    expect(Object.hasOwn(dictionary(secondTag), DEFINITION)).toBe(false);
    const request = materializeOutboundRequest(
      { body: { ...dictionary(first), extra: "kept" } },
      "http",
    );
    expect(request.body).toBe(
      '{"first_name":"Ada","last_name":"Lovelace","extra":"kept"}',
    );
    expect(Object.getPrototypeOf(first)).toBeNull();
  });

  test("encodes an untagged mixed intersection with literal keys", () => {
    const Person = struct.intersection(
      struct.object({ firstName: struct.string().alias("first_name") }),
      struct.or(
        struct.object({ lastName: struct.string().alias("last_name") }),
        struct.number(),
      ),
    );
    const Box = struct.object({ person: Person });
    const input = parseEndpointInput(Box, {
      person: { firstName: "Ada", lastName: "Lovelace" },
    });
    const request = materializeOutboundRequest(
      {
        body: {
          ...input,
          person: { extra: "kept", firstName: "Ada", lastName: "Lovelace" },
        },
      },
      "http",
    );

    expect(request.body).toBe(
      '{"person":{"extra":"kept","firstName":"Ada","lastName":"Lovelace"}}',
    );
  });

  test("recurses through an unmatched discriminated object so tagged children keep aliases", () => {
    const Cat = struct.object({
      kind: struct.literal("cat"),
      name: struct.string(),
    });
    const Item = struct.object({ id: struct.string().alias("wire_id") });
    const Box = struct.object({
      pet: struct.discriminatedUnion("kind", [Cat]),
    });
    const item = parseEndpointInput(Item, { id: "42" });
    const input = parseEndpointInput(Box, {
      pet: { kind: "cat", name: "Ada" },
    });
    const request = materializeOutboundRequest(
      { body: { ...input, pet: { row: { ...item, extra: "kept" } } } },
      "http",
    );

    expect(request.body).toBe(
      '{"pet":{"row":{"wire_id":"42","extra":"kept"}}}',
    );
  });

  test("keeps a logical __proto__ key on a mixed intersection", () => {
    const Schema = struct.intersection(
      struct.object({ ["__proto__"]: struct.string().alias("proto_wire") }),
      struct.or(
        struct.object({ label: struct.string().alias("label_wire") }),
        struct.number(),
      ),
    );
    const value = parseEndpointInput(Schema, {
      ["__proto__"]: "p",
      label: "L",
    });

    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    const request = materializeOutboundRequest({ body: value }, "http");
    expect(jsonObject(request.body)).toEqual({
      label_wire: "L",
      proto_wire: "p",
    });
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  test("tags a mixed intersection from the single object side", () => {
    const Schema = struct.intersection(
      struct.unknown(),
      struct.object({ name: struct.string().alias("display_name") }),
    );
    const value = parseEndpointInput(Schema, { extra: "kept", name: "Ada" });
    const request = materializeOutboundRequest({ body: value }, "http");

    expect(request.body).toBe('{"display_name":"Ada"}');
    expect(Object.getPrototypeOf(value)).toBeNull();
  });

  test("does not tag an intersection when no side is an object struct", async () => {
    const Schema = struct.intersection(struct.unknown(), struct.any());
    const raw = { name: "Ada" };
    const value: unknown = await parseEndpointInput(Schema, raw);

    expect(value).toBe(raw);
    expect(readTag(dictionary(value))).toBeUndefined();
  });

  test("tags each mixed-intersection branch with the object structs that produced it", () => {
    const Left = struct.object({
      firstName: struct.string().alias("first_name"),
    });
    const Cat = struct.object({
      kind: struct.literal("cat"),
      name: struct.string().alias("cat_name"),
    });
    const Dog = struct.object({
      kind: struct.literal("dog"),
      name: struct.string().alias("dog_name"),
    });
    const Schema = struct.intersection(Left, struct.or(Cat, Dog));
    const cat = parseEndpointInput(Schema, {
      firstName: "A",
      kind: "cat",
      name: "N",
    });
    const dog = parseEndpointInput(Schema, {
      firstName: "B",
      kind: "dog",
      name: "M",
    });
    const catAgain = parseEndpointInput(Schema, {
      firstName: "C",
      kind: "cat",
      name: "O",
    });
    const catTag = readTag(cat);
    const dogTag = readTag(dog);
    const catAgainTag = readTag(catAgain);

    expect(Object.hasOwn(dictionary(catTag), DEFINITION)).toBe(false);
    expect(Object.hasOwn(dictionary(dogTag), DEFINITION)).toBe(false);
    expect(Object.hasOwn(dictionary(catAgainTag), DEFINITION)).toBe(false);
    expect(materializeOutboundRequest({ body: cat }, "http").body).toBe(
      '{"first_name":"A","kind":"cat","cat_name":"N"}',
    );
    expect(materializeOutboundRequest({ body: dog }, "http").body).toBe(
      '{"first_name":"B","kind":"dog","dog_name":"M"}',
    );
    expect(materializeOutboundRequest({ body: catAgain }, "http").body).toBe(
      '{"first_name":"C","kind":"cat","cat_name":"O"}',
    );
  });

  test("recurses through an array stored on a discriminated field", () => {
    const Cat = struct.object({
      kind: struct.literal("cat"),
      name: struct.string(),
    });
    const Item = struct.object({ id: struct.string().alias("wire_id") });
    const Box = struct.object({
      pet: struct.discriminatedUnion("kind", [Cat]),
    });
    const item = parseEndpointInput(Item, { id: "42" });
    const input = parseEndpointInput(Box, {
      pet: { kind: "cat", name: "Ada" },
    });
    const request = materializeOutboundRequest(
      { body: { ...input, pet: [{ ...item, extra: "kept" }] } },
      "http",
    );

    expect(request.body).toBe('{"pet":[{"wire_id":"42","extra":"kept"}]}');
  });

  test("uses the field struct when a nested object tag is not an object struct", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const profile = { birthday, displayName: "Bob", role: "admin" };
    Object.defineProperty(profile, STRUCT, {
      configurable: true,
      enumerable: true,
      value: struct.string(),
      writable: true,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { ...value, profile },
    }));

    expect(request.body).toBe(
      `{"user_id":7,"profile":{"display_name":"Bob","birthday":"${birthday.toISOString()}","role":"admin"}}`,
    );
  });

  test("does not apply the tagged-object rule to an any field array", () => {
    const Box = struct.object({ payload: struct.any() });
    const input = parseEndpointInput(Box, {
      payload: [{ role: "admin" }],
    });
    const request = materializeOutboundRequest({ body: input }, "http");

    expect(request.body).toBe('{"payload":[{"role":"admin"}]}');
  });

  test("leaves a scalar nested in an object field as a scalar", () => {
    const input = parseEndpointInput(UserInput, {
      profile: { birthday, displayName: "Ada" },
      userId: 7,
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { ...value, profile: "Ada" },
    }));

    expect(request.body).toBe('{"user_id":7,"profile":"Ada"}');
  });

  test("leaves a copied leaf under an anonymous parent unaliased", () => {
    const input = parseEndpointInput(Profile, {
      birthday,
      displayName: "Ada",
    });
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: { name: value.displayName },
    }));

    expect(request.body).toBe('{"name":"Ada"}');
  });

  test("encodes bigint leaves as strings inside json", () => {
    const request = buildHttp("POST", "/users", undefined, () => ({
      body: { n: 1n },
    }));

    expect(request.body).toBe('{"n":"1"}');
  });

  test("encodes anonymous date and bigint leaves and skips undefined", () => {
    const request = buildHttp("POST", "/users", undefined, () => ({
      body: { n: 1n, skip: undefined, tags: [birthday], when: birthday },
    }));

    expect(request.body).toBe(
      `{"n":"1","tags":["${birthday.toISOString()}"],"when":"${birthday.toISOString()}"}`,
    );
  });

  test("sends a root date or bigint as json", () => {
    const dateRequest = buildHttp("POST", "/users", undefined, () => ({
      body: new Date(0),
    }));
    const bigintRequest = buildHttp("POST", "/users", undefined, () => ({
      body: 10n,
    }));

    expect(dateRequest.body).toBe('"1970-01-01T00:00:00.000Z"');
    expect(dateRequest.headers?.has("content-type")).toBe(false);
    expect(dateRequest.bodyContentType).toBe("application/json");
    expect(bigintRequest.body).toBe('"10"');
    expect(bigintRequest.headers?.has("content-type")).toBe(false);
    expect(bigintRequest.bodyContentType).toBe("application/json");
  });

  test.each([
    ["AsyncGenerator", (async function* () {})()],
    ["Map", new Map()],
    ["Set", new Set()],
    ["Response", new Response("x")],
    ["Promise", Promise.resolve(1)],
    [
      "Payload",
      new (class Payload {
        value = 7;
      })(),
    ],
    ["function", () => 1],
    ["symbol", Symbol("s")],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a root %s body", (kind, body) => {
    const send = () => buildHttp("POST", "/users", undefined, () => ({ body }));

    expect(send).toThrow(TypeError);
    expect(send).toThrow(`body is not JSON data: ${kind}.`);
    expect(send).toThrow("ReadableStream.from(iterable)");
  });

  test.each([
    [
      "set field",
      { tags: new Set() },
      'body field "tags" is not JSON data: Set.',
    ],
    [
      "function element",
      { items: [() => 1] },
      'body field "0" is not JSON data: function.',
    ],
    ["NaN field", { n: Number.NaN }, 'body field "n" is not JSON data: NaN.'],
    [
      "bytes field",
      { bytes: new Uint8Array(2) },
      'body field "bytes" is not JSON data: Uint8Array.',
    ],
    [
      "blob field",
      { file: new Blob(["x"]) },
      'body field "file" is not JSON data: Blob.',
    ],
    ["map element", [new Map()], 'body field "0" is not JSON data: Map.'],
    [
      "constructorless object",
      {
        odd: dictionary(Object.create(dictionary(Object.create(null)))),
      },
      'body field "odd" is not JSON data: Object.',
    ],
    [
      "non-function constructor",
      {
        value: objectWithNonFunctionConstructor(),
      },
      'body field "value" is not JSON data: Object.',
    ],
  ])("rejects a nested %s", (_label, body, message) => {
    const send = () => buildHttp("POST", "/users", undefined, () => ({ body }));

    expect(send).toThrow(TypeError);
    expect(send).toThrow(message);
  });

  const asyncIterable = () => ({
    async *[Symbol.asyncIterator]() {
      yield await Promise.resolve(new TextEncoder().encode("chunk"));
    },
  });
  const syncIterable = () => ({
    *[Symbol.iterator]() {
      yield 1;
    },
  });

  test.each([
    [
      "root async iterable body",
      "POST",
      () => ({ body: asyncIterable() }),
      "value is an iterable object, not a record.",
      undefined,
    ],
    [
      "root sync iterable body",
      "POST",
      () => ({ body: syncIterable() }),
      "value is an iterable object, not a record.",
      undefined,
    ],
    [
      "root null-prototype async iterable body",
      "POST",
      () => ({
        body: dictionary(
          Object.assign(Object.create(null), {
            async *[Symbol.asyncIterator]() {
              yield await Promise.resolve(new TextEncoder().encode("chunk"));
            },
          }),
        ),
      }),
      "value is an iterable object, not a record.",
      undefined,
    ],
    [
      "nested async iterable body field",
      "POST",
      () => ({ body: { chunks: asyncIterable() } }),
      'field "chunks" is an iterable object, not a record.',
      undefined,
    ],
    [
      "iterable body that also has string data",
      "POST",
      () => ({
        body: {
          items: [1],
          *[Symbol.iterator]() {
            yield 1;
          },
        },
      }),
      "value is an iterable object, not a record.",
      undefined,
    ],
    [
      "iterable body array element",
      "POST",
      () => ({ body: [syncIterable()] }),
      'field "0" is an iterable object, not a record.',
      undefined,
    ],
    [
      "root iterable query",
      "GET",
      () => ({ query: syncIterable() }),
      "value is an iterable object, not a record.",
      undefined,
    ],
    [
      "nested iterable query field",
      "GET",
      () => ({ query: { filter: syncIterable() } }),
      'field "filter" is an iterable object, not a record.',
      (query: { [key: string]: unknown }) => JSON.stringify(query),
    ],
    [
      "iterable header pairs",
      "POST",
      () => ({
        headers: {
          *[Symbol.iterator]() {
            yield ["x-a", "1"];
          },
        },
      }),
      "value is an iterable object, not a record.",
      undefined,
    ],
  ])(
    "rejects an iterable object: %s",
    (_label, method, build, message, serializer) => {
      const send = () =>
        buildHttp(method, "/users", undefined, build, serializer);

      expect(send).toThrow(TypeError);
      expect(send).toThrow(message);
      expect(send).toThrow("ReadableStream.from(iterable) for a streamed body");
    },
  );

  test("still sends non-iterator symbol objects as json and header pair arrays", () => {
    const inspect = buildHttp("POST", "/users", undefined, () => ({
      body: {
        a: 1,
        [Symbol.for("nodejs.util.inspect.custom")]() {
          return "x";
        },
      },
    }));
    const tagged = buildHttp("POST", "/users", undefined, () => ({
      body: { a: 1, [Symbol.toStringTag]: "Thing" },
    }));
    const pairs = buildHttp("POST", "/users", undefined, () => ({
      headers: [["x-a", "1"]],
    }));

    expect(inspect.body).toBe('{"a":1}');
    expect(inspect.headers?.has("content-type")).toBe(false);
    expect(inspect.bodyContentType).toBe("application/json");
    expect(tagged.body).toBe('{"a":1}');
    expect(tagged.headers?.has("content-type")).toBe(false);
    expect(tagged.bodyContentType).toBe("application/json");
    expect(pairs.headers?.get("x-a")).toBe("1");
  });

  test("encodes toJSON values, URLs, null-prototype objects, and omitted undefined as json", () => {
    class Payload {
      value = 7;
      toJSON() {
        return { value: 7 };
      }
    }
    const withJson = buildHttp("POST", "/users", undefined, () => ({
      body: new Payload(),
    }));
    const withUrl = buildHttp("POST", "/users", undefined, () => ({
      body: { link: new URL("https://a.test/x") },
    }));
    const nullProto = buildHttp("POST", "/users", undefined, () => ({
      body: dictionary(Object.assign(Object.create(null), { a: 1 })),
    }));
    const omitted = buildHttp("POST", "/users", undefined, () => ({
      body: { a: undefined, b: 1 },
    }));

    expect(withJson.body).toBe('{"value":7}');
    expect(withJson.headers?.has("content-type")).toBe(false);
    expect(withJson.bodyContentType).toBe("application/json");
    expect(withUrl.body).toBe('{"link":"https://a.test/x"}');
    expect(withUrl.headers?.has("content-type")).toBe(false);
    expect(withUrl.bodyContentType).toBe("application/json");
    expect(nullProto.body).toBe('{"a":1}');
    expect(nullProto.headers?.has("content-type")).toBe(false);
    expect(nullProto.bodyContentType).toBe("application/json");
    expect(omitted.body).toBe('{"b":1}');
    expect(omitted.headers?.has("content-type")).toBe(false);
    expect(omitted.bodyContentType).toBe("application/json");
  });

  test("treats an undefined builder result as an empty request", () => {
    const request = buildHttp("POST", "/users", { id: 1 }, () => undefined);

    expect(request.endpoint).toBe("/users");
    expect(request.body).toBeUndefined();
    expect(request.queryString).toBe("");
  });

  test("omits an undefined body", () => {
    const request = buildHttp("POST", "/users", undefined, () => ({
      body: undefined,
    }));

    expect(request.body).toBeUndefined();
    expect(request.headers?.get("content-type")).toBeNull();
  });

  test("encodes a urlencoded codec object only at the body root", () => {
    const Form = struct.urlencoded({
      q: struct.string().alias("query"),
      tags: struct.array(struct.string()),
    });
    const input = parseEndpointInput(struct.object({ form: Form }), {
      form: { q: "ada", tags: ["a", "b"] },
    });
    const root = buildHttp("POST", "/search", input, (value) => ({
      body: value.form,
    }));
    const nested = buildHttp("POST", "/search", input, (value) => ({
      body: { meta: value.form },
    }));

    expect(root.body).toBeInstanceOf(URLSearchParams);
    expect(bodyParams(root.body).get("query")).toBe("ada");
    expect(bodyParams(root.body).getAll("tags")).toEqual(["a", "b"]);
    expect(root.headers?.has("content-type")).toBe(false);
    expect(root.bodyContentType).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    expect(nested.body).toBe('{"meta":{"query":"ada","tags":["a","b"]}}');
    expect(nested.headers?.has("content-type")).toBe(false);
    expect(nested.bodyContentType).toBe("application/json");
  });

  test("encodes a formData codec object only at the body root", async () => {
    const file = new File(["hi"], "hi.txt", { type: "text/plain" });
    const Form = struct.formData({
      file: struct.file(),
      title: struct.string().alias("t"),
    });
    const input = parseEndpointInput(struct.object({ form: Form }), {
      form: { file, title: "Hi" },
    });
    const root = buildHttp("POST", "/files", input, (value) => ({
      body: value.form,
    }));
    // The nested call is the JSON path. A File is not JSON data, so it is left out; the root call still sends it.
    const nested = buildHttp("POST", "/files", input, (value) => ({
      body: { meta: { ...value.form, file: undefined } },
    }));

    expect(root.body).toBeInstanceOf(FormData);
    expect(bodyForm(root.body).get("t")).toBe("Hi");
    const appended = bodyForm(root.body).get("file");
    expect(await formBlob(appended)).toEqual(await formBlob(file));
    if (!(appended instanceof File)) {
      throw new Error("expected a file");
    }
    expect(appended.name).toBe(file.name);
    expect(root.headers?.get("content-type")).toBeNull();
    if (typeof nested.body !== "string") {
      throw new Error("expected a string body");
    }
    expect(nested.body).toContain('"t":"Hi"');
    expect(nested.headers?.has("content-type")).toBe(false);
    expect(nested.bodyContentType).toBe("application/json");
  });

  test("encodes form scalars, arrays, blobs, and omitted undefined fields", async () => {
    const blob = new Blob(["a"]);
    const Form = struct.formData({
      age: struct.number(),
      enabled: struct.boolean(),
      files: struct.array(struct.blob()),
      name: struct.string(),
      nickname: struct.string().optional(),
      note: struct.null(),
    });
    const input = parseEndpointInput(Form, {
      age: 3,
      enabled: true,
      files: [blob],
      name: "Ada",
      note: null,
    });
    // @ts-expect-error parsed file lists do not include undefined
    input.files?.push(undefined);
    const request = buildHttp("POST", "/files", undefined, () => ({
      body: input,
    }));
    const form = bodyForm(request.body);

    expect(form.get("age")).toBe("3");
    expect(form.get("enabled")).toBe("true");
    expect(await formBlob(form.get("files"))).toEqual(await formBlob(blob));
    expect(form.get("name")).toBe("Ada");
    expect(form.get("nickname")).toBeNull();
    expect(form.get("note")).toBe("null");
  });

  test("rejects blobs in a urlencoded body", () => {
    const Form = struct.urlencoded({
      file: struct.blob(),
    });
    const input = parseEndpointInput(Form, { file: new Blob(["a"]) });

    expect(() =>
      buildHttp("POST", "/files", undefined, () => ({ body: input })),
    ).toThrow(/file/);
  });

  test("rejects nested objects in a formData body", () => {
    const Form = struct.formData({
      profile: struct.object({ name: struct.string() }),
    });
    const input = parseEndpointInput(struct.object({ form: Form }), {
      form: { profile: { name: "Ada" } },
    });

    expect(() =>
      buildHttp("POST", "/files", input, (value) => ({ body: value.form })),
    ).toThrow(/profile/);
  });

  test("sends FormData, URLSearchParams, Blob, and File verbatim", () => {
    const form = new FormData();
    form.append("name", "Ada");
    const params = new URLSearchParams({ q: "ada" });
    const blob = new Blob(["hi"], { type: "text/plain" });
    const file = new File(["hi"], "hi.txt", { type: "text/csv" });
    const bare = new Blob(["hi"]);

    const formRequest = buildHttp("POST", "/files", undefined, () => ({
      body: form,
    }));
    const paramsRequest = buildHttp("POST", "/files", undefined, () => ({
      body: params,
    }));
    const blobRequest = buildHttp("POST", "/files", undefined, () => ({
      body: blob,
    }));
    const fileRequest = buildHttp("POST", "/files", undefined, () => ({
      body: file,
    }));
    const bareRequest = buildHttp("POST", "/files", undefined, () => ({
      body: bare,
    }));

    expect(formRequest.body).toBe(form);
    expect(formRequest.headers?.get("content-type")).toBeNull();
    expect(paramsRequest.body).toBe(params);
    expect(paramsRequest.headers?.has("content-type")).toBe(false);
    expect(paramsRequest.bodyContentType).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    expect(blobRequest.body).toBe(blob);
    expect(blobRequest.headers?.has("content-type")).toBe(false);
    expect(blobRequest.bodyContentType).toBe(blob.type);
    expect(fileRequest.body).toBe(file);
    expect(fileRequest.headers?.has("content-type")).toBe(false);
    expect(fileRequest.bodyContentType).toBe(file.type);
    expect(bareRequest.body).toBe(bare);
    expect(bareRequest.headers?.has("content-type")).toBe(false);
    expect(bareRequest.bodyContentType).toBe("application/octet-stream");
  });

  test("sends BufferSource values as octet-stream", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = bytes.buffer;
    const view = new DataView(buffer);

    const bytesRequest = buildHttp("POST", "/files", undefined, () => ({
      body: bytes,
    }));
    const bufferRequest = buildHttp("POST", "/files", undefined, () => ({
      body: buffer,
    }));
    const viewRequest = buildHttp("POST", "/files", undefined, () => ({
      body: view,
    }));

    expect(bytesRequest.body).toBe(bytes);
    expect(bufferRequest.body).toBe(buffer);
    expect(viewRequest.body).toBe(view);
    expect(bytesRequest.headers?.has("content-type")).toBe(false);
    expect(bytesRequest.bodyContentType).toBe("application/octet-stream");
    expect(bufferRequest.headers?.has("content-type")).toBe(false);
    expect(bufferRequest.bodyContentType).toBe("application/octet-stream");
    expect(viewRequest.headers?.has("content-type")).toBe(false);
    expect(viewRequest.bodyContentType).toBe("application/octet-stream");
  });

  test("sends a ReadableStream as octet-stream", () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const request = buildHttp("POST", "/files", undefined, () => ({
      body: stream,
    }));

    expect(request.body).toBe(stream);
    expect(request.headers?.has("content-type")).toBe(false);
    expect(request.bodyContentType).toBe("application/octet-stream");
  });

  test("sends a string as text/plain", () => {
    const request = buildHttp("POST", "/files", undefined, () => ({
      body: "hello",
    }));

    expect(request.body).toBe("hello");
    expect(request.headers?.has("content-type")).toBe(false);
    expect(request.bodyContentType).toBe("text/plain;charset=UTF-8");
  });

  test("json-encodes objects, arrays, numbers, booleans, and null", () => {
    expect(
      buildHttp("POST", "/files", undefined, () => ({ body: { ok: true } }))
        .body,
    ).toBe('{"ok":true}');
    expect(
      buildHttp("POST", "/files", undefined, () => ({ body: ["a", "b"] })).body,
    ).toBe('["a","b"]');
    expect(
      buildHttp("POST", "/files", undefined, () => ({ body: 1 })).body,
    ).toBe("1");
    expect(
      buildHttp("POST", "/files", undefined, () => ({ body: true })).body,
    ).toBe("true");
    expect(
      buildHttp("POST", "/files", undefined, () => ({ body: null })).body,
    ).toBe("null");
    const request = buildHttp("POST", "/files", undefined, () => ({
      body: { ok: true },
    }));
    expect(request.headers?.has("content-type")).toBe(false);
    expect(request.bodyContentType).toBe("application/json");
  });

  test("lets a header content-type override the json default", () => {
    const request = buildHttp("PATCH", "/users/1", undefined, () => ({
      body: { ok: true },
      headers: { "content-type": "application/merge-patch+json" },
    }));

    expect(request.body).toBe('{"ok":true}');
    expect(request.headers?.get("content-type")).toBe(
      "application/merge-patch+json",
    );
  });

  test("omits undefined fields and sends nullable null", () => {
    const Body = struct.object({
      nickname: struct.string().alias("nick").optional(),
      note: struct.string().nullable(),
    });
    const input = parseEndpointInput(Body, { note: null });
    input.nickname = undefined;
    const request = buildHttp("POST", "/users", input, (value) => ({
      body: value,
    }));

    expect(request.body).toBe('{"note":null}');
  });

  test("accepts header arrays, Headers instances, and tuple init", () => {
    const headers = new Headers({ "x-live": "1" });
    const record = buildHttp("POST", "/users", undefined, () => ({
      headers: { "x-tag": ["a", "b"] },
    }));
    const live = buildHttp("POST", "/users", undefined, () => ({ headers }));
    const tuple = buildHttp("POST", "/users", undefined, () => ({
      headers: [["x-tuple", "1"]],
    }));

    expect(record.headers?.get("x-tag")).toBe("a,b");
    expect(live.headers?.get("x-live")).toBe("1");
    expect(tuple.headers?.get("x-tuple")).toBe("1");
  });

  test("rejects null and nested values in path and query", () => {
    expect(() =>
      buildHttp("GET", "/users/:id", undefined, () => ({ path: { id: null } })),
    ).toThrow(/id/);
    expect(() =>
      buildHttp("GET", "/users/:id", undefined, () => ({
        path: { id: { raw: 1 } },
      })),
    ).toThrow(/id/);
    expect(() =>
      buildHttp("GET", "/users", undefined, () => ({ query: { id: null } })),
    ).toThrow(/id/);
  });

  test("rejects a non-object builder result", () => {
    expect(() => buildHttp("POST", "/users", undefined, () => 1)).toThrow(
      /object/,
    );
  });

  test("rejects non-object path, query, and headers", () => {
    expect(() =>
      buildHttp("GET", "/users/:id", undefined, () => ({ path: "id" })),
    ).toThrow(/object/);
    expect(() =>
      buildHttp("GET", "/users", undefined, () => ({ query: "id" })),
    ).toThrow(/object/);
    expect(() =>
      buildHttp("GET", "/users", undefined, () => ({ headers: "id" })),
    ).toThrow(/header record/);
  });

  test("rejects null inside query arrays and nested query objects", () => {
    expect(() =>
      buildHttp("GET", "/users", undefined, () => ({
        query: { tags: ["a", null] },
      })),
    ).toThrow(/tags/);
    expect(() =>
      buildHttp("GET", "/users", undefined, () => ({
        query: { filter: { id: null } },
      })),
    ).toThrow(/id/);
  });

  test("uses URLSearchParams query verbatim and skips the serializer", () => {
    const query = new URLSearchParams();
    query.append("tag", "a");
    query.append("tag", "b");
    const request = buildHttp(
      "GET",
      "/items",
      undefined,
      () => ({ query }),
      () => {
        throw new Error("serializer should be skipped");
      },
    );

    expect(request.queryString).toBe("tag=a&tag=b");
    expect(request.queryParams).toBe(query);
  });

  test("passes encoded query objects to the current serializer", () => {
    const Query = struct.object({
      pageSize: struct.number().alias("page_size"),
    });
    const input = parseEndpointInput(Query, { pageSize: 10 });
    let seen: unknown;
    const request = buildHttp(
      "GET",
      "/items",
      input,
      (value) => ({ query: value }),
      (query) => {
        seen = query;
        return `page_size=${String(query["page_size"])}`;
      },
    );

    expect(seen).toEqual({ page_size: 10 });
    expect(request.queryString).toBe("page_size=10");
  });

  test("keeps nested query behind the current serializer contract", () => {
    expect(() =>
      buildHttp("GET", "/items", undefined, () => ({
        query: { filter: { state: "open" } },
      })),
    ).toThrow(/a query serializer is required/);

    const request = buildHttp(
      "GET",
      "/items",
      undefined,
      () => ({ query: { filter: { state: "open" } } }),
      (query) => JSON.stringify(query),
    );

    expect(request.queryString).toBe('{"filter":{"state":"open"}}');
  });

  test("treats a non-struct tag as an anonymous object", () => {
    const body = { displayName: "Ada" };
    Object.defineProperty(body, STRUCT, {
      configurable: true,
      enumerable: true,
      value: { kind: "nope" },
      writable: true,
    });
    const request = buildHttp("POST", "/users", undefined, () => ({ body }));

    expect(request.body).toBe('{"displayName":"Ada"}');
  });

  test("treats a non-object struct tag as an anonymous object", () => {
    const body = { displayName: "Ada" };
    Object.defineProperty(body, STRUCT, {
      configurable: true,
      enumerable: true,
      value: struct.string(),
      writable: true,
    });
    const request = buildHttp("POST", "/users", undefined, () => ({ body }));

    expect(request.body).toBe('{"displayName":"Ada"}');
  });

  test("maps a thrown builder to REQ_BUILD_FAILED without throwing from the endpoint", async () => {
    const useBroken = defineRequest({
      builder: () => {
        throw new Error("boom");
      },
      method: "POST",
      path: "/users",
    });
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => {
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );

    const pending = useBroken(client);
    expect(pending).toBeInstanceOf(Promise);
    const [error] = await pending;

    expect(error?.code).toBe("REQ_BUILD_FAILED");
    expect(error?.cause).toBeInstanceOf(Error);
    if (!(error?.cause instanceof Error)) {
      throw new Error("expected builder cause");
    }
    expect(error.cause.message).toBe("boom");
  });

  test("places parsed input through an explicit builder", async () => {
    let captured:
      { body?: unknown; endpoint?: string; headers?: Headers } | undefined;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor((request) => {
          captured = request;
          return Promise.resolve(
            makeResponse({
              body: { display_name: "Ada" },
              headers: new Headers({ "content-type": "application/json" }),
              status: 200,
            }),
          );
        }),
      ),
    );
    const updateUser = defineRequest({
      builder: (input) => ({ body: input.profile, path: { id: input.id } }),
      input: struct.object({
        id: struct.number(),
        profile: struct.object({
          displayName: struct.string().alias("display_name"),
        }),
      }),
      method: "PATCH",
      output: struct.object({
        displayName: struct.string().alias("display_name"),
      }),
      path: "/users/:id",
    });

    const [error, result] = await updateUser(client, {
      id: 7,
      profile: { displayName: "Ada" },
    });

    expect(error).toBeNull();
    expect(captured?.endpoint).toBe("/users/7");
    expect(captured?.body).toBe('{"display_name":"Ada"}');
    expect(result).toEqual({ displayName: "Ada" });
    expect(Object.getOwnPropertySymbols(dictionary(result))).not.toContain(
      STRUCT,
    );
  });

  test("sends no request when an endpoint has no input and no builder", async () => {
    let captured: { body?: unknown; endpoint?: string } | undefined;
    const client = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor((request) => {
          captured = request;
          return Promise.resolve(makeResponse({ status: 204 }));
        }),
      ),
    );
    const health = defineRequest({ method: "GET", path: "/health" });

    const [error] = await health(client);

    expect(error).toBeNull();
    expect(captured?.endpoint).toBe("/health");
    expect(captured?.body).toBeUndefined();
  });

  test("tags parsed endpoint objects and not public struct.parse", async () => {
    const parsed = parseEndpointInput(Profile, {
      birthday,
      displayName: "Ada",
    });
    const [, value] = struct.parse(Profile, { birthday, displayName: "Ada" });
    const Item = struct.object({ id: struct.number() });
    const items = parseEndpointInput(struct.array(Item), [{ id: 1 }]);
    const Record = struct.record(Item);
    const record = parseEndpointInput(Record, { a: { id: 1 } });
    const raw = { id: 1 };
    const anyValue: unknown = await parseEndpointInput(struct.any(), raw);
    const Left = struct.object({ id: struct.number() });
    const Right = struct.object({ name: struct.string() });
    const Both = struct.intersection(Left, Right);
    const first = parseEndpointInput(Both, { id: 1, name: "A" });
    const second = parseEndpointInput(Both, { id: 2, name: "B" });
    const Alpha = struct.object({
      id: struct.number(),
      kind: struct.literal("a"),
    });
    const Beta = struct.object({
      kind: struct.literal("b"),
      name: struct.string(),
    });
    const union = parseEndpointInput(struct.or(Alpha, Beta), {
      id: 1,
      kind: "a",
    });

    expect(structOf(parsed)).toBe(Profile);
    expect(Object.getOwnPropertyDescriptor(parsed, STRUCT)?.enumerable).toBe(
      true,
    );
    expect(Object.getOwnPropertySymbols(dictionary(value))).not.toContain(
      STRUCT,
    );
    expect(Object.getOwnPropertySymbols(items)).not.toContain(STRUCT);
    expect(structOf(dictionary(items[0]))).toBe(Item);
    expect(structOf(record)).toBe(Record);
    expect(structOf(dictionary(record["a"]))).toBe(Item);
    expect(anyValue).toBe(raw);
    expect(Object.getOwnPropertySymbols(raw)).not.toContain(STRUCT);
    expect(Object.hasOwn(dictionary(structOf(first)), DEFINITION)).toBe(false);
    expect(Object.hasOwn(dictionary(structOf(second)), DEFINITION)).toBe(false);
    expect(materializeOutboundRequest({ body: first }, "http").body).toBe(
      '{"id":1,"name":"A"}',
    );
    expect(structOf(union)).toBe(Alpha);
  });

  test("does not tag objects decoded from http, sse, or websocket responses", async () => {
    const User = struct.object({
      displayName: struct.string().alias("display_name"),
      profile: struct.object({ traceId: struct.string().alias("trace_id") }),
    });
    const payload = { display_name: "Ada", profile: { trace_id: "t1" } };
    const decoded = { displayName: "Ada", profile: { traceId: "t1" } };

    const outputClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => {
          return Promise.resolve(
            makeResponse({
              body: payload,
              headers: new Headers({ "content-type": "application/json" }),
              status: 200,
            }),
          );
        }),
      ),
    );
    const readUser = defineRequest({
      method: "GET",
      output: User,
      path: "/users/1",
    });
    const [outputError, output] = await readUser(outputClient);

    expect(outputError).toBeNull();
    expect(output).toEqual(decoded);
    expectUntagged(output);
    expectUntagged(nestedObject(dictionary(output), "profile"));

    const errorClient = createClient(
      withEndpoint("https://example.com"),
      withInterceptors(
        createHttpInterceptor(() => {
          return Promise.resolve(
            makeResponse({
              body: payload,
              headers: new Headers({ "content-type": "application/json" }),
              status: 404,
              statusText: "Not Found",
            }),
          );
        }),
      ),
    );
    const missingUser = defineRequest({
      error: User,
      method: "GET",
      path: "/users/missing",
    });
    const [statusError] = await missingUser(errorClient);

    expect(statusError?.code).toBe("HTTP_STATUS");
    if (statusError?.code !== "HTTP_STATUS") {
      throw new Error("expected an http status fault");
    }
    expect(statusError.data).toEqual(decoded);
    expect(statusError.response.body).toBe(statusError.data);
    expectUntagged(statusError.data);
    expectUntagged(nestedObject(dictionary(statusError.data), "profile"));

    const sseClient = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle(() => {
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'event: profile\ndata: {"display_name":"Ada","profile":{"trace_id":"t1"}}\n\n',
                  ),
                );
                controller.close();
              },
            }),
            {
              headers: { "content-type": "text/event-stream" },
              status: 200,
            },
          ),
        );
      }),
    );
    const feed = defineEventStream({
      events: { profile: User },
      path: "/events",
    });
    const [sseError, stream] = await feed(sseClient);

    expect(sseError).toBeNull();
    if (!stream) {
      throw new Error("expected an event stream");
    }
    const events: { data: unknown }[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toEqual([
      { data: decoded, event: "profile", id: undefined },
    ]);
    const sseData = events[0]?.data;
    expectUntagged(sseData);
    expectUntagged(nestedObject(dictionary(sseData), "profile"));

    const message = await transformWebSocketMessage(
      struct.object({
        displayName: struct.string().alias("display_name"),
        profile: struct.object({ traceId: struct.string().alias("trace_id") }),
        type: struct.literal("profile"),
      }),
      '{"type":"profile","display_name":"Ada","profile":{"trace_id":"t1"}}',
    );

    expect(message).toEqual({
      displayName: "Ada",
      profile: { traceId: "t1" },
      type: "profile",
    });
    expectUntagged(message);
    expectUntagged(nestedObject(dictionary(message), "profile"));
  });

  test("fills sse path and query from the builder", async () => {
    let seen: Request | undefined;
    const client = createClient(
      withEndpoint("https://example.com"),
      withSSEHandle((input, init) => {
        seen = new Request(input, init);
        return Promise.resolve(
          new Response("data: ok\n\n", {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          }),
        );
      }),
    );
    const feed = defineEventStream({
      builder: (input) => ({
        path: { room: input.room },
        query: { since: input.since },
      }),
      events: { message: struct.string() },
      input: struct.object({
        room: struct.string(),
        since: struct.string().optional(),
      }),
      path: "/rooms/:room/events",
    });

    const [error] = await feed(client, { room: "blue" });

    expect(error).toBeNull();
    expect(seen?.url).toBe("https://example.com/rooms/blue/events");
  });

  test("fills websocket path and query and rejects headers or body", async () => {
    let url = "";
    const client = createClient(
      withEndpoint("https://example.com"),
      withWebSocketHandle(
        // @ts-expect-error socket double records the url and then throws
        class {
          static OPEN = 1;
          constructor(nextUrl: string) {
            url = nextUrl;
            throw new Error("stop");
          }
        },
      ),
    );
    const chat = defineWebSocket({
      builder: (input) => ({ path: input, query: { since: "1" } }),
      incoming: struct.object({
        type: struct.literal("message"),
        text: struct.string(),
      }),
      input: struct.object({ room: struct.string().alias("room") }),
      path: "/ws/rooms/:room",
      protocols: ["chat.v1"],
    });
    const rejected = defineWebSocket({
      // @ts-expect-error websocket builders cannot set handshake headers
      builder: () => ({
        headers: { token: "secret" },
      }),
      incoming: struct.unknown(),
      path: "/ws/basic",
    });
    const rejectedBody = defineWebSocket({
      // @ts-expect-error websocket builders cannot set a body
      builder: () => ({
        body: "nope",
      }),
      incoming: struct.unknown(),
      path: "/ws/basic",
    });

    const [openError] = await chat(client, { room: "blue" });
    const [buildError] = await rejected(client);
    const [bodyError] = await rejectedBody(client);

    expect(openError?.code.startsWith("NET_")).toBe(true);
    expect(url).toContain("/ws/rooms/blue?since=1");
    expect(buildError?.code).toBe("REQ_BUILD_FAILED");
    expect(bodyError?.code).toBe("REQ_BUILD_FAILED");
    if (!(bodyError?.cause instanceof Error)) {
      throw new Error("expected builder cause");
    }
    expect(bodyError.cause.message).toContain("body");
  });

  test("keeps a configured query serializer on websocket objects and skips it for URLSearchParams", async () => {
    const urls: string[] = [];
    const client = createClient(
      withEndpoint("https://example.com"),
      withQuerySerializer(() => "serialized=1"),
      withWebSocketHandle(
        // @ts-expect-error socket double records the url and then throws
        class {
          static OPEN = 1;
          constructor(nextUrl: string) {
            urls.push(nextUrl);
            throw new Error("stop");
          }
        },
      ),
    );
    const objectQuery = defineWebSocket({
      builder: () => ({ query: { room: "blue" } }),
      incoming: struct.unknown(),
      path: "/ws",
    });
    const nativeQuery = defineWebSocket({
      builder: () => ({ query: new URLSearchParams({ room: "blue" }) }),
      incoming: struct.unknown(),
      path: "/ws",
    });

    await objectQuery(client);
    await nativeQuery(client);

    expect(urls[0]).toContain("serialized=1");
    expect(urls[1]).toContain("room=blue");
    expect(urls[1]).not.toContain("serialized=1");
  });

  test("fills a path param whose own key is __proto__", () => {
    const request = buildHttp("GET", "/files/:__proto__", undefined, () => ({
      path: ownData("__proto__", "safe"),
    }));

    expect(request.endpoint).toBe("/files/safe");
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  test("serializes an own __proto__ query key and hands it to a serializer", () => {
    const plain = buildHttp("GET", "/search", undefined, () => ({
      query: ownData("__proto__", "safe"),
    }));
    let seen: { [key: string]: unknown } | undefined;
    const custom = buildHttp(
      "GET",
      "/search",
      undefined,
      () => ({ query: ownData("__proto__", { polluted: true }) }),
      (query) => {
        seen = query;
        return "ok=1";
      },
    );

    expect(plain.queryParams?.get("__proto__")).toBe("safe");
    expect(plain.queryString).toBe("__proto__=safe");
    expect(custom.queryString).toBe("ok=1");
    expect(Object.getPrototypeOf(seen)).toBeNull();
    expect(Object.hasOwn(dictionary(seen), "__proto__")).toBe(true);
    expect(seen?.["__proto__"]).toEqual({ polluted: true });
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  test("applies an own __proto__ header name", () => {
    const request = buildHttp("GET", "/search", undefined, () => ({
      headers: ownData("__proto__", "safe"),
    }));

    expect(request.headers?.get("__proto__")).toBe("safe");
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  test("preserves a nested anonymous __proto__ key in a json body", () => {
    const request = buildHttp("POST", "/body", undefined, () => ({
      body: { nested: ownData("__proto__", "safe") },
    }));
    const decoded = nestedObject(jsonObject(request.body), "nested");

    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("safe");
  });

  test("preserves a tagged field literally named __proto__", () => {
    const Payload = struct.object(protoStringShape());
    const parsed = parseEndpointInput(Payload, ownData("__proto__", "safe"));
    const request = buildHttp("POST", "/body", parsed, () => ({
      body: parsed,
    }));
    const decoded = jsonObject(request.body);

    expect(structOf(dictionary(parsed))).toBe(Payload);
    expect(Object.hasOwn(dictionary(parsed), "__proto__")).toBe(true);
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("safe");
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  test("preserves a tagged field aliased to __proto__", () => {
    const Payload = struct.object({
      label: struct.string().alias("__proto__"),
    });
    const parsed = parseEndpointInput(Payload, { label: "safe" });
    let seen: { [key: string]: unknown } | undefined;
    const body = buildHttp("POST", "/body", parsed, () => ({ body: parsed }));
    const query = buildHttp(
      "GET",
      "/search",
      parsed,
      () => ({ query: parsed }),
      (value) => {
        seen = value;
        return "ok=1";
      },
    );
    const headers = buildHttp("GET", "/search", parsed, () => ({
      headers: parsed,
    }));
    const decoded = jsonObject(body.body);

    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("safe");
    expect(Object.getPrototypeOf(seen)).toBeNull();
    expect(seen?.["__proto__"]).toBe("safe");
    expect(query.queryString).toBe("ok=1");
    expect(headers.headers?.get("__proto__")).toBe("safe");
  });

  test("preserves a nested tagged field named __proto__", () => {
    const Inner = struct.object(protoStringShape());
    const Outer = struct.object({ inner: Inner });
    const parsed = parseEndpointInput(Outer, {
      inner: ownData("__proto__", "safe"),
    });
    const request = buildHttp("POST", "/body", parsed, () => ({
      body: parsed,
    }));
    const decoded = nestedObject(jsonObject(request.body), "inner");

    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("safe");
  });

  test("appends form fields whose wire key is __proto__", () => {
    const Urlencoded = struct.urlencoded(protoStringShape());
    const urlencodedInput = parseEndpointInput(
      Urlencoded,
      ownData("__proto__", "safe"),
    );
    const urlencoded = buildHttp("POST", "/form", undefined, () => ({
      body: urlencodedInput,
    }));
    const Form = struct.formData({ label: struct.string().alias("__proto__") });
    const formInput = parseEndpointInput(Form, { label: "safe" });
    const form = buildHttp("POST", "/form", undefined, () => ({
      body: formInput,
    }));

    expect(urlencoded.body).toBeInstanceOf(URLSearchParams);
    expect(bodyParams(urlencoded.body).get("__proto__")).toBe("safe");
    expect(form.body).toBeInstanceOf(FormData);
    expect(bodyForm(form.body).get("__proto__")).toBe("safe");
  });
});

describe("outbound passthrough groups", () => {
  test("encode a fresh object under two any/unknown union guides field by field", () => {
    const Left = struct.object({
      x: struct.or(struct.unknown(), struct.string()),
    });
    const Right = struct.object({
      x: struct.or(struct.unknown(), struct.string()),
    });
    const input = parseEndpointInput(struct.intersection(Left, Right), {
      x: "seed",
    });

    expect(
      materializeOutboundRequest(
        { body: { ...input, x: { at: new Date(0) } } },
        "http",
      ).body,
    ).toBe('{"x":{"at":"1970-01-01T00:00:00.000Z"}}');
  });
});
