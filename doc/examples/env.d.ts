// Ambient helpers that the examples use without a visible declaration.
import type { Tracer } from "@opentelemetry/api";
import type { DefineComponent } from "vue";

declare global {
  const App: DefineComponent;
  const tracer: Tracer;
}
