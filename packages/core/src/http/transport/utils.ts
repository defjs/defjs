export { concatChunks, parseBytesBody } from '../../internal/bytes'
import { parseMediaTypeEssence } from '../../internal/media_type'

export function getContentLength(headers: Headers): number {
  const value = headers.get('Content-Length')
  if (!value) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function getContentType(headers: Headers): string {
  return headers.get('Content-Type') || ''
}

/**
 * Whether a `Content-Type` names a JSON representation.
 *
 * The essence must be a type/subtype token pair. `application/json` matches exactly.
 * A structured suffix matches only when a non-empty name precedes `+json`
 * (`application/problem+json`, `application/vnd.api+json`). Parameters and case are ignored.
 *
 * @param contentType - Raw header value, possibly with parameters.
 * @returns True when the essence is JSON.
 */
export function isJsonMediaType(contentType: string): boolean {
  const essence = parseMediaTypeEssence(contentType)
  if (!essence) {
    return false
  }
  const slash = essence.indexOf('/')
  const subtype = essence.slice(slash + 1)
  if (essence === 'application/json') {
    return true
  }

  const suffixAt = subtype.lastIndexOf('+')
  return suffixAt > 0 && subtype.slice(suffixAt + 1) === 'json'
}
