import { useI18n } from 'fumadocs-ui/contexts/i18n'
import { localePrefix } from '../lib/i18n'
import { getUi } from '../lib/ui-copy'
export function ErrorPage({ title, description }: { title: string; description?: string }) {
  const { locale } = useI18n()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <title>{title}</title>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && <p className="max-w-md text-fd-muted-foreground">{description}</p>}
      <a className="underline" href={localePrefix(locale) || '/'}>
        {getUi(locale).translations['Back to Home(404 page)']}
      </a>
    </main>
  )
}
export default function NotFound() {
  const { translations } = getUi(useI18n().locale)
  return (
    <ErrorPage
      title={translations['Page Not Found(404 page)']}
      description={
        translations['The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)']
      }
    />
  )
}
