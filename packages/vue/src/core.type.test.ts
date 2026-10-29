import type { Client } from "@defjs/core";
import type { InjectionKey } from "vue";
import type { injectClient } from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type ClientAccessContract = [
  Expect<Equal<Parameters<typeof injectClient>, [key?: InjectionKey<Client>]>>,
  Expect<Equal<ReturnType<typeof injectClient>, Client>>,
];
