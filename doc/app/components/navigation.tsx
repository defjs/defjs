import {
  Children,
  isValidElement,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router";
import {
  flattenTree,
  type Item,
  type Node,
  type Root,
  type Separator,
} from "fumadocs-core/page-tree";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import { Container } from "fumadocs-ui/layouts/docs/slots/container";
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
  type SidebarProps,
  type SidebarProviderProps,
} from "fumadocs-ui/layouts/docs/slots/sidebar";
import {
  SidebarItem,
  useFolderDepth,
} from "fumadocs-ui/components/sidebar/base";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import type { LayoutTab } from "fumadocs-ui/layouts/shared";
import { getNav } from "../lib/navigation-copy";
import { getNavigationTabs, getRelatedNavigation } from "../lib/navigation";

function useCopy() {
  return getNav(useI18n().locale);
}

function NavigationState({ children }: { children: ReactNode }) {
  const { open, setOpen, mode } = useSidebar();
  return (
    <Popover modal open={mode === "drawer" && open} onOpenChange={setOpen}>
      {children}
    </Popover>
  );
}
function NavigationProvider(props: SidebarProviderProps) {
  return (
    <SidebarProvider {...props}>
      <NavigationState>{props.children}</NavigationState>
    </SidebarProvider>
  );
}
function NavigationTrigger(props: ComponentProps<"button">) {
  return (
    <PopoverTrigger asChild>
      <SidebarTrigger {...props} />
    </PopoverTrigger>
  );
}
function NavigationSidebar(props: SidebarProps) {
  const copy = useCopy();
  const { mode } = useSidebar();
  const content = (
    <nav aria-label={copy.navigation} className="navigation-sidebar contents">
      <Sidebar {...props} />
    </nav>
  );
  if (mode !== "drawer") return content;
  return (
    <PopoverContent
      asChild
      className="navigation-drawer"
      aria-label={copy.navigation}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>(
            '#nd-sidebar-mobile button[aria-controls="nd-sidebar-mobile"]',
          )
          ?.focus();
      }}
    >
      <div>{content}</div>
    </PopoverContent>
  );
}
function NavigationContainer({ children, ...props }: ComponentProps<"div">) {
  const copy = useCopy();
  const { pathname } = useLocation();
  return (
    <Container {...props}>
      {Children.map(children, (child) => {
        if (!isValidElement<{ tabs?: LayoutTab[] }>(child) || !child.props.tabs)
          return child;
        return (
          <nav
            aria-label={copy.readingAreas}
            style={{ gridArea: "tabs" }}
            className="z-10 flex items-end gap-6 overflow-auto border-b bg-fd-background px-6 pt-3 max-md:hidden xl:px-8"
          >
            {child.props.tabs.map((tab) => {
              const active = tab.urls?.has(pathname.replace(/\/$/, "") || "/");
              return (
                <Link
                  key={tab.url}
                  to={tab.url}
                  aria-current={active ? "location" : undefined}
                  className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 pb-1.5 text-sm font-medium ${active ? "border-fd-primary text-fd-primary" : "border-transparent text-fd-muted-foreground hover:text-fd-accent-foreground"}`}
                >
                  {tab.title}
                </Link>
              );
            })}
          </nav>
        );
      })}
    </Container>
  );
}
function NavigationItem({ item }: { item: Item }) {
  const { pathname } = useLocation();
  const depth = useFolderDepth();
  if (/\/(docs|recipes)$/.test(item.url)) return null;
  const active = pathname.replace(/\/$/, "") === item.url.replace(/\/$/, "");
  const standalone = item.url.endsWith("/docs/design-decisions");
  const parts = typeof item.name === "string" ? item.name.split(" / ") : [];
  return (
    <SidebarItem
      href={item.url}
      external={item.external}
      active={active}
      aria-current={active ? "page" : undefined}
      icon={item.icon}
      data-navigation-standalone={standalone || undefined}
      style={{ "--navigation-depth": depth } as CSSProperties}
      className={`navigation-item relative flex flex-wrap items-center gap-x-1 rounded-lg p-2 text-start text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary ${standalone ? "mt-4" : ""}`}
    >
      {parts.length === 2 ? (
        <>
          {parts[0]}
          <span className="text-xs text-fd-muted-foreground">
            {" "}
            / {parts[1]}
          </span>
        </>
      ) : (
        item.name
      )}
    </SidebarItem>
  );
}
function NavigationHeading({ item }: { item: Separator }) {
  if (item.$id?.endsWith(":navigation:standalone")) return null;
  return <h2 className="navigation-group-heading">{item.name}</h2>;
}
export const navigationSlots = {
  container: NavigationContainer,
  sidebar: {
    provider: NavigationProvider,
    root: NavigationSidebar,
    trigger: NavigationTrigger,
    useSidebar,
  },
};
export const navigationComponents = {
  Item: NavigationItem,
  Separator: NavigationHeading,
};

export function StaticNavigation({
  tree,
  locale,
}: {
  tree: Root;
  locale: string;
}) {
  const copy = getNav(locale);
  const { pathname: location } = useLocation();
  const pathname = location.replace(/\/$/, "") || "/";
  const tabs = getNavigationTabs(tree);
  const current = tree.children.find(
    (node) =>
      node.type === "folder" &&
      flattenTree(node.children).some((page) => page.url === pathname),
  );
  function list(nodes: Node[]): ReactNode {
    return (
      <ul className="navigation-static-list space-y-2">
        {nodes
          .filter(
            (node) =>
              !node.$id?.endsWith(":navigation:standalone") &&
              (node.type !== "page" || !/\/(docs|recipes)$/.test(node.url)),
          )
          .map((node, i) => (
            <li
              key={i}
              className={
                node.type === "page" &&
                node.url.endsWith("/docs/design-decisions")
                  ? "mt-4"
                  : undefined
              }
            >
              {node.type === "page" ? (
                <a
                  href={node.url}
                  aria-current={node.url === pathname ? "page" : undefined}
                  data-navigation-standalone={
                    node.url.endsWith("/docs/design-decisions") || undefined
                  }
                  className="navigation-item relative block p-2"
                >
                  {node.name}
                </a>
              ) : node.type === "separator" ? (
                <h2 className="navigation-group-heading">{node.name}</h2>
              ) : (
                <details>
                  <summary>{node.name}</summary>
                  {list(node.children)}
                </details>
              )}
            </li>
          ))}
      </ul>
    );
  }
  return (
    <noscript>
      <details className="mb-4 rounded-lg border p-3 md:hidden">
        <summary className="cursor-pointer font-medium">
          {copy.navigation}
        </summary>
        <nav
          aria-label={copy.readingAreas}
          className="my-3 flex flex-wrap gap-4"
        >
          {tabs.map((tab) => (
            <a key={tab.url} href={tab.url}>
              {tab.title}
            </a>
          ))}
        </nav>
        <nav aria-label={copy.navigation}>
          {current?.type === "folder" && list(current.children)}
        </nav>
      </details>
    </noscript>
  );
}

export function RelatedNavigation({
  tree,
  locale,
}: {
  tree: Root;
  locale: string;
}) {
  const copy = getNav(locale);
  const { pathname } = useLocation();
  const groups = getRelatedNavigation(tree, locale, pathname);
  if (groups.length === 0) return null;
  return (
    <nav aria-label={copy.related} className="mb-6 mt-8 border-t pt-6">
      <h2 className="mb-4 text-lg font-semibold">{copy.related}</h2>
      <div className="grid gap-6 sm:grid-cols-3">
        {groups.map((group, i) => (
          <section key={i}>
            <h3 className="mb-2 text-sm font-semibold text-fd-muted-foreground">
              {group.name}
            </h3>
            <ul className="space-y-2 text-sm">
              {group.children.map(
                (item) =>
                  item.type === "page" && (
                    <li key={item.url}>
                      <Link
                        to={item.url}
                        className="underline underline-offset-4"
                      >
                        {item.name}
                      </Link>
                    </li>
                  ),
              )}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
