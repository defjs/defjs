import { llmsIndexMarkdown } from '../lib/llms'
import { siteUrl } from '../lib/site'
import { docsLlms } from '../lib/source'
export async function loader() {
  return new Response(llmsIndexMarkdown(await docsLlms.index('en-US'), siteUrl))
}
