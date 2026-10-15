import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Tabs, Tab } from 'fumadocs-ui/components/tabs'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import { ApiReference } from './api-reference'
import { ApiIndex } from './api-index'
import type { MDXComponents } from 'mdx/types'
export function getMDXComponents(locale = 'en-US') {
  return {
    ...defaultMdxComponents,
    Tabs,
    Tab,
    TypeTable,
    ApiReference: (props: { identity: string }) => <ApiReference {...props} locale={locale} />,
    ApiIndex: () => <ApiIndex locale={locale} />,
  } satisfies MDXComponents
}
declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
