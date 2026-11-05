---
title: "Anwendungsintegration"
description: "Erzeuge den Client an der Anwendungsgrenze und halte Zugangsdaten, Policies und Framework-Verdrahtung aus dem SDK heraus."
---

## Den Client einmal an der Grenze erzeugen [#client-boundary]

Erzeuge den Client dort, wo die Anwendung ihre Konfiguration liest: ein Server-Einstiegspunkt, ein Modul, das das Deployment verantwortet, oder ein Test-Setup. Reiche diesen Client an den Code, der Operationen aufruft.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

Vermeide einen Client auf Modulebene innerhalb eines SDK, in einem Component-Body oder in einem Request-Handler. Ein Client, der pro Render oder pro Request erzeugt wird, verliert geteilte Konfiguration und macht Tests von umgebendem Zustand abhängig.

## Querschnitts-Policy in Interceptors legen [#interceptors]

Authentifizierung, Tracing, Header-Defaults und eine geprüfte Retry-Policy gehören in einen Interceptor. `builder` platziert den aktuellen Input; er kennt weder Zugangsdaten noch die Telemetrie der Anwendung.

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## Client-Options für einen Aufruf verwenden [#per-call]

`client(options)` gibt einen Client-Wert für einen Aufruf zurück. Der Wert ist nicht aufrufbar. Nutze ihn für ein Signal, Fortschritts-Callbacks oder einen WebSocket-Hook, der nur für diesen Aufruf gilt; behalte den Basis-Client für alles andere.

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## Framework-Plugins den Client weiterreichen lassen [#plugins]

`@defjs/react` und `@defjs/vue` reichen einen Anwendungs-Client durch den Framework-Baum. Sie erzeugen, cachen, wiederholen oder entsorgen keinen. Stelle den Client bereit, den die Anwendung bereits besitzt, und injiziere denselben Wert dort, wo er gebraucht wird.

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## Den Endpoint aus dem SDK heraushalten [#endpoint]

Dieselbe Definition kann gegen Produktion, Staging, einen lokalen Fixture-Server oder einen Test-Transport laufen. Wähle den Endpoint in der Anwendung; kodiere keinen Deployment-Host ins SDK-Paket.
