import type { TextMapGetter, TextMapSetter } from '@opentelemetry/api'

export const headersSetter: TextMapSetter<Headers> = {
  set(carrier, key, value) {
    if (carrier && key && value !== undefined) {
      carrier.set(key, String(value))
    }
  },
}

export const headersGetter: TextMapGetter<Headers> = {
  keys(carrier) {
    if (!carrier) {
      return []
    }
    return Array.from(carrier.keys())
  },
  get(carrier, key) {
    if (!carrier || !key) {
      return undefined
    }
    const values = carrier.get(key)
    return values ?? undefined
  },
}

/** Query string carrier for WebSocket propagation */
export interface QueryStringCarrier {
  params: URLSearchParams
}

export const queryStringSetter: TextMapSetter<QueryStringCarrier> = {
  set(carrier, key, value) {
    if (carrier && key && value !== undefined) {
      carrier.params.set(key, String(value))
    }
  },
}
