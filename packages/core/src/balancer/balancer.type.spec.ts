import type { Balancer, PickInfo } from "./public_api";

const info: PickInfo = {
  endpoints: ["https://example.test"],
  meta: { operation: "read" },
};
void info;

const invalid: PickInfo = {
  endpoints: [],
  // @ts-expect-error endpoint selection must not accept transport-specific metadata
  transport: "http",
};
void invalid;

const custom: Balancer = {
  pick(info) {
    // @ts-expect-error custom balancers cannot inspect a transport discriminator
    void info.transport;
    return [null, { endpoint: info.endpoints[0] ?? "" }];
  },
};
void custom;
