---
title: "Fehlerbehandlung"
description: "Lies Faults an der Aufrufstelle, enge nach Code ein und halte Logging und Retries aus der Definition heraus."
---

## Den Fault vor dem Wert lesen [#fault-first]

Jede Operation gibt `[error, data, response]` zurück. Der Erfolgswert ist nur aussagekräftig, wenn das erste Element `null` ist.

Bevorzuge:

```ts
const [error, order] = await getOrder(client, { id: 1 });
if (error) return handleOrderFault(error);
console.log(order.status);
```

Vermeide:

```ts
const [, order] = await getOrder(client, { id: 1 });
console.log(order.status); // order is undefined when the call failed
```

## Nach Code einengen, dann nach Daten [#narrow]

`fault.code` wählt die Failure-Klasse. Lies `status` bei `HTTP_STATUS`, `data` für einen dekodierten Fehler-Body und `response` für Metadaten. `cause` behält den zugrunde liegenden Parser- oder Transportfehler; ersetze ihn nicht durch eine generische Meldung.

```ts
if (error.code === "HTTP_STATUS" && error.status === 404) {
  console.log(error.data?.message);
}
```

`RES_*`-Codes bedeuten, dass die Response nicht wie deklariert gelesen werden konnte. `NET_*`-Codes bedeuten, dass der Request keine nutzbare Response erzeugt hat. Wiederhole einen Decode- oder Vertrags-Fehler nicht, als wäre er ein Netzwerkfehler.

## Einmal loggen, an der Grenze, die das Ergebnis verantwortet [#logging]

Logge auf der Schicht, die entscheidet, was als Nächstes passiert: der Request-Handler, der Job-Runner oder die UI-Grenze. Nutze das OpenTelemetry-Plugin oder einen Interceptor für Telemetrie; die Definition bleibt frei von Logging. Schwärze URLs, Query Strings, Header und Bodys, bevor sie ein Log erreichen.

## Nur wiederholen, was sicher erneut gesendet werden kann [#retry]

Defjs wiederholt HTTP nicht von selbst. Ein Retry gehört zur Anwendung oder zu einer expliziten Endpoint-Failover-Policy. Wiederhole eine sichere Methode oder eine Operation, die der Service als idempotent dokumentiert. Ein POST, der abrechenbare Arbeit gestartet haben kann, lässt sich ohne Replay-Vertrag nicht sicher wiederholen.

## Fehler nicht verschlucken [#no-swallow]

Erfolg nach einem Fehler zurückzugeben, verdeckt einen gebrochenen Vertrag. Bilde den Fault auf ein Anwendungsergebnis ab, wirf einen Programmierfehler erneut oder beende die Operation mit einem typisierten Fehler. Fange keinen Fault ab, nur um ihn zu loggen und mit einem `undefined`-Wert weiterzumachen.
