import { provideFileRouter, requestContextInterceptor } from '@analogjs/router'
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http'
import { type ApplicationConfig, provideZoneChangeDetection } from '@angular/core'
import { provideClientHydration } from '@angular/platform-browser'
import { createGlobalClient } from '@defjs/core'
import { environment } from '@src/environments/environment'

createGlobalClient({
  host: environment.host,
})

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideFileRouter(),
    provideHttpClient(withFetch(), withInterceptors([requestContextInterceptor])),
    provideClientHydration(),
  ],
}
