---
title: "Middleware"
description: "Komponiere Interceptors als kleine, geordnete Policies, die an der Anwendungsgrenze bleiben."
---

## Ein Anliegen pro Interceptor [#one-concern]

Gib jedem Interceptor genau eine Aufgabe: Authentifizierung anhängen, einen Trace-Header hinzufügen, Timing messen oder einen freigegebenen Fall kurzschließen. Eine Middleware, die authentifiziert, den Body neu schreibt, wiederholt und loggt, ist schwer zu testen und schwer zu durchschauen.

Bevorzuge:

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

Vermeide einen einzelnen Interceptor, der mehrere unzusammenhängende Teile des Requests verändert.

## Die Reihenfolge ist Policy [#order]

Interceptors laufen in der Reihenfolge ihrer Registrierung. Der zuerst registrierte Interceptor ist der äußerste: Er sieht den Request zuerst und die Response zuletzt. Policy, die den ganzen Versuch umschließen muss, gehört nach außen; Policy, die dem Transport am nächsten sein muss, nach innen.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` umschließt `auth`; `auth` läuft vor dem Transport.

## Bewusst per Short-Circuit antworten [#short-circuit]

Ein Interceptor darf eine Response mit `makeResponse` zurückgeben, ohne `next` aufzurufen. Nutze das für einen freigegebenen Cache, eine Maintenance-Response oder einen lokalen Test. Die Response muss weiterhin die deklarierte Ausgabe der Operation erfüllen; mache aus einem Fehler keinen Erfolg.

## Den Vertrag nicht neu schreiben [#contract]

Middleware darf Header, Trace-Kontext oder die Request-URL im Rahmen der Validierungsregeln der Library anpassen. Sie darf die Bedeutung des deklarierten Inputs oder Outputs nicht verändern. Authentifizierung und Tracing gehören hierher, nicht in den `builder`.

## Zustandslos bleiben [#stateless]

Speichere keine per-Request-Daten auf einem geteilten Client oder Modul. Reiche einen Wert durch den Request, die Client-Konfiguration oder eine für diesen Client erzeugte Closure. Eine Middleware, die geteilten State mutiert, leakt über gleichzeitige Aufrufe.

## Fehler an der Grenze behandeln [#failures]

Ein Throw aus einer Middleware ist ein Fehler; gib nur dann eine Response zurück, wenn die Middleware den Request absichtlich behandelt hat. Fange keinen Fault ab, nur um ihn zu loggen und mit `undefined` weiterzumachen. Nutze den Telemetrie-Hook oder Interceptor der Anwendung zum Loggen und halte die Definition frei von beidem.
