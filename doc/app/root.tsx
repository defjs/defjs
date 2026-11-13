import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  isRouteErrorResponse,
} from "react-router";
import { RootProvider } from "fumadocs-ui/provider/react-router";
import { getI18nProps } from "./lib/translations";
import { useAppTranslations } from "./lib/use-app-translations";
import { splitLocale } from "./lib/i18n";
import NotFound, { ErrorPage } from "./routes/not-found";
import StaticSearch from "./components/search";
import type { ReactNode } from "react";
import type { Route } from "./+types/root";
import "./app.css";
export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { locale } = splitLocale(pathname.split("/").slice(1));
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <RootProvider
          dir={locale === "ar" ? "rtl" : "ltr"}
          i18n={getI18nProps(locale)}
          search={{ SearchDialog: StaticSearch }}
        >
          {children}
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  return <Outlet />;
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useAppTranslations();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return <ErrorPage title={t("ui.error")} />;
}
