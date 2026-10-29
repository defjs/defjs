// #region example
import { HTTP_CLIENT, createClientPlugin, injectClient } from "@defjs/vue";

type VueApi = {
  HTTP_CLIENT: typeof HTTP_CLIENT;
  createClientPlugin: typeof createClientPlugin;
  injectClient: typeof injectClient;
};

const api: VueApi = { HTTP_CLIENT, createClientPlugin, injectClient };
void api;
// #endregion
