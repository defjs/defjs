// Ambient helpers that the examples use without a visible declaration.
import type { QuerySerializer } from '@defjs/core'
import type { Tracer } from '@opentelemetry/api'
import type { DefineComponent } from 'vue'

declare global {
  const App: DefineComponent
  const qs: { stringify: QuerySerializer }
  const tracer: Tracer
}
