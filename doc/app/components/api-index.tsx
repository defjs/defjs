import { useState } from "react";
import { Link } from "react-router";
import { localePrefix } from "../lib/i18n";
import { getUi } from "../lib/ui-copy";
import { apiEntries, filterApiEntries } from "../data/api-catalog";

const packages = [...new Set(apiEntries.map((entry) => entry.package))];
const kinds = [...new Set(apiEntries.map((entry) => entry.kind))];

export function ApiIndex({ locale }: { locale: string }) {
  const [query, setQuery] = useState(""),
    [packageName, setPackageName] = useState(""),
    [kind, setKind] = useState("");
  const copy = getUi(locale);
  const kindLabel = (name: string) =>
    copy.kinds[name as keyof typeof copy.kinds];
  const entries = filterApiEntries(apiEntries, query, packageName, kind);
  const prefix = localePrefix(locale);
  return (
    <section>
      <div className="flex flex-wrap gap-3">
        <label>
          {copy.name}{" "}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded border p-2"
          />
        </label>
        <div>
          <label htmlFor="api-package">{copy.package}</label>
          <select
            id="api-package"
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            className="rounded border p-2"
          >
            <option value="">{copy.allPackages}</option>
            {packages.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="api-category">{copy.category}</label>
          <select
            id="api-category"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="rounded border p-2"
          >
            <option value="">{copy.allCategories}</option>
            {kinds.map((name) => (
              <option key={name} value={name}>
                {kindLabel(name)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" aria-live="polite">
        {copy.results.replace("{count}", String(entries.length))}
      </p>
      {entries.length === 0 ? (
        <p>{copy.noResults}</p>
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
