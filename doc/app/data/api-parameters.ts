interface Parameter {
  type: string
  required: boolean
}
/** Parameter tables keyed by API identity (`package:name`), as in `api-entries.json`. */
export const apiParameters: Record<string, Record<string, Parameter>> = {
  '@defjs/core:createClient': { '...options': { type: 'ClientOption[]', required: false } },
  '@defjs/core:ClientOption': { config: { type: 'ClientConfig', required: true } },
  '@defjs/core:struct.parse': {
    struct: { type: 'S', required: true },
    value: { type: 'unknown', required: true },
    options: { type: '{ aliases?: boolean; errorMap?: ErrorMap }', required: false },
  },
  '@defjs/react:ClientProvider': { client: { type: 'Client', required: true }, children: { type: 'ReactNode', required: false } },
}
