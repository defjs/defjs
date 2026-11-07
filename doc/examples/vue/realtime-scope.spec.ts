import { file, write } from "bun";
import { compileScript, parse } from "vue/compiler-sfc";
import { expect, test } from "vitest";
import { removeDirectory, tempDirectory } from "../../scripts/tmp";

async function visibleFailure(runtime: boolean): Promise<string> {
  const filename = new URL("./realtime-scope.vue", import.meta.url);
  const { descriptor } = parse(await file(filename).text());
  const component = compileScript(descriptor, {
    id: "deploy-log",
    inlineTemplate: true,
  })
    .content.replace("export default", "const Component =")
    .replaceAll(
      'from "@defjs/core"',
      `from ${JSON.stringify(new URL("../../../packages/core/src/index.ts", import.meta.url).href)}`,
    )
    .replaceAll(
      'from "@defjs/vue"',
      `from ${JSON.stringify(new URL("../../../packages/vue/src/index.ts", import.meta.url).href)}`,
    )
    .replaceAll(
      'from "vue"',
      `from ${JSON.stringify(new URL("../../node_modules/vue/index.mjs", import.meta.url).href)}`,
    );
  const directory = tempDirectory("defjs-vue-log");
  try {
    const path = `${directory}/render.ts`;
    await write(
      path,
      `
${component}
import { createRenderer, nextTick } from ${JSON.stringify(new URL("../../node_modules/vue/index.mjs", import.meta.url).href)};
import { createClient, withEndpoint, withSSEHandle } from ${JSON.stringify(new URL("../../../packages/core/src/index.ts", import.meta.url).href)};
import { createClientPlugin } from ${JSON.stringify(new URL("../../../packages/vue/src/index.ts", import.meta.url).href)};
interface Element {
  text: string;
  children: Element[];
  parent: Element | null;
}
const rendered = Promise.withResolvers<void>();
const opened = Promise.withResolvers<void>();
function observe(text: string): void {
  if (text.includes("HTTP_STATUS") || text === "Deploy log interrupted.") rendered.resolve();
  if (text === "ready") opened.resolve();
}
function element(text = ""): Element { observe(text); return { text, children: [], parent: null }; }
const renderer = createRenderer<Element, Element>({
  createElement: () => element(), createText: element, createComment: () => element(),
  setText(node, text) { node.text = text; observe(text); },
  setElementText(node, text) { node.text = text; node.children = []; observe(text); },
  insert(node, parent, anchor) {
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(node);
    else parent.children.splice(index, 0, node);
  },
  remove(node) {
    if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
  },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp() {},
});
let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
const client = createClient(withEndpoint("https://deploy.example.test"), withSSEHandle(() => Promise.resolve(
  ${runtime} ? new Response(new ReadableStream<Uint8Array>({ start(next) { controller = next; next.enqueue(new TextEncoder().encode("event: line\\ndata: ready\\n\\n")); } }), {
    headers: { "content-type": "text/event-stream" },
  }) : new Response("unavailable", { status: 503 }),
)));
const container = element();
const app = renderer.createApp(Component);
app.use(createClientPlugin(client));
app.mount(container);
if (${runtime}) {
  await opened.promise;
  controller?.error(new Error("injected read failure"));
}
await rendered.promise;
await nextTick();
function text(node: Element): string { return node.text + node.children.map(text).join(""); }
export const visible = text(container);
app.unmount();
`,
    );
    const loaded: unknown = await import(path);
    if (
      typeof loaded !== "object" ||
      loaded === null ||
      !("visible" in loaded) ||
      typeof loaded.visible !== "string"
    )
      throw new Error("Expected rendered component text");
    return loaded.visible;
  } finally {
    removeDirectory(directory);
  }
}

test("the deploy log displays an initial handshake failure", async () => {
  expect(await visibleFailure(false)).toContain(
    "Unable to open deploy log (HTTP_STATUS).",
  );
});

test("the deploy log displays a runtime read failure", async () => {
  expect(await visibleFailure(true)).toContain("Deploy log interrupted.");
});
