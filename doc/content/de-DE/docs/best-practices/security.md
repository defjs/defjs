---
title: "Sicherheit"
description: "Halte Zugangsdaten an der Anwendungsgrenze, validiere URLs, aktiviere XSRF wo nötig und schwärze Telemetrie."
---

## Secrets aus dem SDK und dem Browser heraushalten [#secrets]

Eine SDK-Definition enthält keinen Endpoint, kein Token und keine Zugangsdaten. Die Anwendung legt Zugangsdaten auf einen Client, der dort läuft, wo sie eingesetzt werden dürfen: ein Server-Prozess, ein Worker oder ein vertrauenswürdiger Test. Lege kein Provider-Secret in ein Browser-Bundle, eine öffentliche Build-Variable oder einen Client, der an den Browser ausgeliefert wird.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## Einen Interceptor für die Authentifizierung nutzen [#auth]

Hänge ein Token in einem Interceptor an, der an der Anwendungsgrenze läuft. `builder` muss eine reine Platzierungsfunktion bleiben; er darf keinen Token-Store lesen oder einen Header verändern, den ein anderer Aufruf nutzt.

## XSRF am Client konfigurieren [#xsrf]

Wenn der Service ein Cookie-zu-Header-Token nutzt, konfiguriere `withXsrf` am Anwendungs-Client. `withCredentials` wählt nur den Cookie-Modus von Fetch; es erzeugt oder prüft kein Token. Der Server muss das Token weiterhin ausstellen und validieren.

## Validieren, was die Anwendung kontrolliert [#urls]

Defjs lehnt unzulässige Request-Pfade, Verzeichnis-Escapes, Backslashes, `?`, `#` und Steuerzeichen ab, bevor ein Transport läuft. Es weiß nicht, welchen Hosts deine Anwendung vertraut. Halte die Endpoint-Liste explizit, validiere nutzergelieferte Werte, bevor sie `builder` erreichen, und baue keine Basis-URL aus nicht vertrauenswürdigem Input.

## Vor Logging oder Tracing schwärzen [#redaction]

URLs, Query Strings, Header und Bodys können Secrets oder personenbezogene Daten enthalten. Das OpenTelemetry-Plugin erfasst standardmäßig keine Bodys und keine vollständigen Header; lass es so. Schwärze in `startSpanHook` oder im Exporter der Anwendung und kopiere keine rohen Request-Werte in eigene Telemetrie.

## Abbruch als lokal behandeln [#abort]

Cancellation stoppt lokale Arbeit. Sie beweist nicht, dass ein Service bereits angenommene Arbeit gestoppt hat, und sie rollt keinen serverseitigen Effekt zurück. Verbinde bei einer nicht idempotenten Operation den Abbruch mit dem eigenen Cancellation-Vertrag des Service.
