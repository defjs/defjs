import { FrameworkProvider } from "fumadocs-core/framework";
import { I18nProvider } from "fumadocs-ui/contexts/i18n";
import type { ReactNode } from "react";
import { defaultLocale, type Locale } from "../lib/i18n";
import type { Messages } from "../lib/messages";
import { getI18nProps } from "../lib/translations";

export function TestI18nProvider({
  locale = defaultLocale,
  translations,
  children,
}: {
  locale?: Locale;
  translations?: Partial<Messages>;
  children?: ReactNode;
}) {
  const props = getI18nProps(locale);
  return (
    <FrameworkProvider
      usePathname={() => "/"}
      useParams={() => ({})}
      useRouter={() => ({ push: () => undefined, refresh: () => undefined })}
    >
      <I18nProvider
        {...props}
        translations={{ ...props.translations, ...translations }}
      >
        {children}
      </I18nProvider>
    </FrameworkProvider>
  );
}
