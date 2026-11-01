import { useState } from "react";
import { Link } from "react-router";
import { localePrefix } from "../lib/i18n";
import { useAppTranslations } from "../lib/use-app-translations";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import type { MessageKey } from "../lib/messages";
import { apiEntries, filterApiEntries } from "../data/api-catalog";

const packages = [...new Set(apiEntries.map((entry) => entry.package))];
const kinds = [...new Set(apiEntries.map((entry) => entry.kind))];

export function ApiIndex() {
  const { locale } = useI18n();
  const [query, setQuery] = useState(""),
    [packageName, setPackageName] = useState(""),
    [kind, setKind] = useState("");
  const t = useAppTranslations();
  const kindLabel = (name: string) =>
    t(`api.kind.${name}` as Extract<MessageKey, `api.kind.${string}`>);
  const entries = filterApiEntries(apiEntries, query, packageName, kind);
  const prefix = localePrefix(locale);
  return (
    <section>
      <div className="flex flex-wrap gap-3">
        <label>
          {t("ui.name")}{" "}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded border p-2"
          />
        </label>
        <div>
          <label htmlFor="api-package">{t("ui.package")}</label>
          <select
            id="api-package"
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            className="rounded border p-2"
          >
            <option value="">{t("ui.allPackages")}</option>
            {packages.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="api-category">{t("ui.category")}</label>
          <select
            id="api-category"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="rounded border p-2"
          >
            <option value="">{t("ui.allCategories")}</option>
            {kinds.map((name) => (
              <option key={name} value={name}>
                {kindLabel(name)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" aria-live="polite">
        {t("ui.results", { variables: { count: String(entries.length) } })}
      </p>
      {entries.length === 0 ? (
        <p>{t("ui.noResults")}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={`${entry.package}:${entry.name}`}>
              <Link to={`${prefix}/api/${entry.slug}`}>{entry.name}</Link>{" "}
              <small>
                {entry.package} · {kindLabel(entry.kind)}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
