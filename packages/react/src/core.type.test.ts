import type { Client } from "@defjs/core";
import type { useClient } from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type ClientAccessContract = [
  Expect<Equal<Parameters<typeof useClient>, [overrideClient?: Client]>>,
  Expect<Equal<ReturnType<typeof useClient>, Client>>,
];
