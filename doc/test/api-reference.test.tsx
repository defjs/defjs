import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ApiReference } from '../app/components/api-reference'
import { apiEntries } from '../app/data/api-catalog'
import { apiParameters } from '../app/data/api-parameters'
import { locales } from '../app/lib/i18n'
import { uiCopy } from '../app/lib/ui-copy'
const render = (identity: string, locale = 'en-US') =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ApiReference identity={identity} locale={locale} />
    </MemoryRouter>,
  )
test('parameter tables preserve required argument contracts', () => {
  const option = render('@defjs/core:ClientOption')
  expect(option).toContain('>config</code>')
  expect(option).not.toContain('config?')
  const parse = render('@defjs/core:struct.parse')
  expect(parse).toContain('>struct</code>')
  expect(parse).toContain('>value</code>')
  expect(parse).toContain('>options?</code>')
  const provider = render('@defjs/react:ClientProvider')
  expect(provider).toContain('>client</code>')
  expect(provider).toContain('>children?</code>')
  const create = render('@defjs/core:createClient')
  expect(create).toContain('>...options?</code>')
})
test('parameter tables are keyed by catalog identity, not bare names', () => {
  const identities = new Set(apiEntries.map((entry) => `${entry.package}:${entry.name}`))
  for (const identity of Object.keys(apiParameters)) expect(identities.has(identity)).toBe(true)
})
test('every locale translates the API kinds, landmarks and Fumadocs strings used by the site', () => {
  const kinds = new Set(apiEntries.map((entry) => entry.kind))
  const english = Object.keys(uiCopy['en-US'].translations).sort()
  for (const locale of locales) {
    const copy = uiCopy[locale as keyof typeof uiCopy]
    for (const kind of kinds) expect(copy.kinds[kind as keyof typeof copy.kinds]).toBeTruthy()
    expect(Object.keys(copy.translations).sort()).toEqual(english)
  }
  const arabic = render('@defjs/core:createClient', 'ar')
  expect(arabic).toContain(`aria-label="${uiCopy.ar.relatedTypes}"`)
  expect(arabic).toContain('href="/ar/api/core/client-type"')
  expect(arabic).toContain(uiCopy.ar.kinds.function)
  expect(arabic).toContain('class="me-3"')
})
test('search and language strings keep the meaning of the Fumadocs keys', () => {
  for (const locale of locales) {
    const copy = uiCopy[locale as keyof typeof uiCopy]
    const { translations } = copy
    if (locale !== 'en-US') {
      expect(translations['No results found(search dialog)']).not.toBe(copy.noResults)
      expect(translations['Choose a language(language switcher)']).not.toBe(copy.label)
    }
    expect(translations['Choose a language(language switcher)(aria-label)']).toContain(copy.label)
  }
})
test('the related-types landmark is rendered only when a related entry exists', () => {
  expect(render('@defjs/core:withEndpoint')).not.toContain('<nav')
  expect(render('@defjs/core:createClient')).toContain('<nav')
})
