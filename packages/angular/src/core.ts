import { DOCUMENT } from '@angular/common'
import { APP_INITIALIZER, type EnvironmentProviders, InjectionToken, inject, makeEnvironmentProviders } from '@angular/core'
import { type Client, type InterceptorFn, createClient, setGlobalClient } from '@defjs/core'

const HTTP_CLIENT = new InjectionToken<Client>('HTTP_CLIENT')
const HTTP_INTERCEPTOR_FNS = new InjectionToken<InterceptorFn[]>('HTTP_INTERCEPTOR_FNS')
const HTTP_HOST = new InjectionToken<string>('HTTP_HOST')

export function withHost(host: string): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: HTTP_HOST,
      useValue: host,
    },
  ])
}

export function withInterceptors(...fns: InterceptorFn[]): EnvironmentProviders {
  return makeEnvironmentProviders(
    fns.map(fn => ({
      provide: HTTP_INTERCEPTOR_FNS,
      useValue: () => fn,
      multi: true,
    })),
  )
}

function factoryClient(): Client {
  let host = inject(HTTP_HOST, { optional: true })

  if (!host) {
    const document: Document | null = inject(DOCUMENT, { optional: true })
    host = document?.location.origin ?? ''
  }

  const interceptors = inject(HTTP_INTERCEPTOR_FNS, { optional: true }) ?? []

  return createClient({
    host,
    interceptors,
  })
}

export function provideGlobalClient(...feature: EnvironmentProviders[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...feature,
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const client = factoryClient()
        return () => {
          setGlobalClient(client)
        }
      },
      deps: [HTTP_HOST, HTTP_INTERCEPTOR_FNS],
      multi: true,
    },
  ])
}

export function provideClient(...feature: EnvironmentProviders[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...feature,
    {
      provide: HTTP_CLIENT,
      useFactory: factoryClient,
    },
  ])
}

export function injectClient(): Client {
  return inject(HTTP_CLIENT)
}
