import { Link } from 'react-router'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import { apiEntries } from '../data/api-catalog'
import { apiParameters } from '../data/api-parameters'
import { localePrefix } from '../lib/i18n'
import { getUi } from '../lib/ui-copy'
export function ApiReference({ identity, locale }: { identity: string; locale: string }) {
  const entry = apiEntries.find((entry) => `${entry.package}:${entry.name}` === identity)
  if (!entry) throw new Error(`Unknown API identity: ${identity}`)
  const copy = getUi(locale)
  const table = apiParameters[identity]
  const prefix = localePrefix(locale)
  const related = entry.related.flatMap(
    (identity) => apiEntries.find((candidate) => `${candidate.package}:${candidate.name}` === identity) ?? [],
  )
  return (
    <section>
      <p>
        <code>{entry.package}</code> · {copy.kinds[entry.kind as keyof typeof copy.kinds]}
      </p>
      {table && <TypeTable type={table} />}
      {related.length > 0 && (
        <nav aria-label={copy.relatedTypes}>
          {related.map((target) => (
            <Link className="me-3" key={target.slug} to={`${prefix}/api/${target.slug}`}>
              {target.name}
            </Link>
          ))}
        </nav>
      )}
    </section>
  )
}
