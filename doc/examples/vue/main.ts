// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";
import OrderView from "./basic-setup.vue";

const client = createClient(withEndpoint("https://api.example.com"));
const app = createApp(OrderView, { id: 7 });

app.use(createClientPlugin(client));
app.mount("#app");
// #endregion
