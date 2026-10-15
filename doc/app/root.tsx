import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, isRouteErrorResponse } from 'react-router'
import { RootProvider } from 'fumadocs-ui/provider/react-router'
import { useI18n } from 'fumadocs-ui/contexts/i18n'
import { getUi } from './lib/ui-copy'
import { locales } from './lib/i18n'
import NotFound, { ErrorPage } from './routes/not-found'
import StaticSearch from './components/search'
import { useEffect, useState, type ReactNode } from 'react'
import type { Route } from './+types/root'
import './app.css'
export function Layout({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    setHydrated(true)
  }, [])
  const { pathname } = useLocation()
  const prefix = pathname.split('/')[1] ?? ''
  const locale = locales.includes(prefix) ? prefix : 'en-US'
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body data-hydrated={hydrated}>
        <RootProvider
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          i18n={{
            locale,
            defaultLanguage: 'en-US',
            hideLocale: 'default-locale',
            translations: getUi(locale).translations,
            locales: locales.map((locale) => ({ locale, name: getUi(locale).label })),
          }}
          search={{ SearchDialog: StaticSearch }}
        >
          {children}
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
export default function App() {
  return <Outlet />
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { locale } = useI18n()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  return <ErrorPage title={getUi(locale).error} />
}
