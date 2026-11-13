import type { ClientOption } from "../client/option";
import { withXSRF, type XSRFOptions } from "./index";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

const option = withXSRF({
  cookieName: "CUSTOM-XSRF-TOKEN",
  headerName: "X-CUSTOM-XSRF-TOKEN",
});
type OptionCase = Expect<Equal<typeof option, ClientOption>>;

const defaults = withXSRF();
void defaults;

const options = {
  cookieName: "CUSTOM-XSRF-TOKEN",
  headerName: "X-CUSTOM-XSRF-TOKEN",
} satisfies XSRFOptions;
void options;

type OptionsCase = Expect<
  Equal<
    XSRFOptions,
    {
      cookieName?: string;
      headerName?: string;
    }
  >
>;
type KeysCase = Expect<Equal<keyof XSRFOptions, "cookieName" | "headerName">>;

// @ts-expect-error withXSRF cookieName must be a string
withXSRF({ cookieName: 1 });

// @ts-expect-error tokenProvider is not an XSRFOptions field
withXSRF({ tokenProvider: () => "token" });

export type Cases = [OptionCase, OptionsCase, KeysCase];
