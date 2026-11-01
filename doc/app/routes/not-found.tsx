import { useI18n } from "fumadocs-ui/contexts/i18n";
import { localePrefix } from "../lib/i18n";
import { useAppTranslations } from "../lib/use-app-translations";
export function ErrorPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { locale } = useI18n();
  const t = useAppTranslations();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <title>{title}</title>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && (
        <p className="max-w-md text-fd-muted-foreground">{description}</p>
      )}
      <a className="underline" href={localePrefix(locale) || "/"}>
        {t("Back to Home(404 page)")}
      </a>
    </main>
  );
}
export default function NotFound() {
  const t = useAppTranslations();
  return (
    <ErrorPage
      title={t("Page Not Found(404 page)")}
      description={t(
        "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)",
      )}
    />
  );
}
