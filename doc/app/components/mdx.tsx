import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tabs, Tab } from "fumadocs-ui/components/tabs";
import { ApiIndex } from "./api-index";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";

function ContentLink(props: ComponentProps<"a">) {
  const path = props.href?.split(/[?#]/, 1)[0];
  if (
    path === "/llms.txt" ||
    path === "/llms-full.txt" ||
    path?.startsWith("/llms.mdx/")
  )
    return <a {...props} />;
  const Link = defaultMdxComponents.a;
  return <Link {...props} />;
}

export function getMDXComponents() {
  return {
    ...defaultMdxComponents,
    a: ContentLink,
    Tabs,
    Tab,
    ApiIndex,
  } satisfies MDXComponents;
}
declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
