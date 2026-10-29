// #region example
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";

const client = createClient(withEndpoint("https://api.example.com"));
const app = createApp(App);
app.use(createClientPlugin(client));
// #endregion
