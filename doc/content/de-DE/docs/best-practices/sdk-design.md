---
title: "SDK-Design"
description: "Operationen, Structs und Pakete entwerfen, die einen Vertrag beschreiben, ohne einen Anwendungs-Client zu besitzen."
---

## Eine Operation pro Definition [#one-operation]

Gib jeder Operation eine eigene Definition und ein eigenes Modul. Eine Operation hat eine Methode, eine Pfadform, einen Input und einen Output-Vertrag. Die Aufteilung nach Operation hält den Vertrag lesbar und lässt eine Anwendung nur die Operationen importieren, die sie aufruft.

Bevorzuge:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

Vermeide ein Modul, das neben den Definitionen einen Client erzeugt oder einen Endpoint speichert.

## Input mit einem expliziten Builder kombinieren [#builder]

Deklariere jeden Aufruferwert in `input` und platziere ihn in `builder`. Verlass dich nicht darauf, dass ein Feldname zu einem Pfadparameter passt. `builder` ist synchron und rein: Er darf Werte umformen, aber er darf keine Zugangsdaten lesen, das Netzwerk aufrufen oder geteilten State verändern.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Structs beschreiben die Wire-Form [#structs]

Nutze Struct für die Daten, die über die Leitung gehen. Nutze Aliasse, wenn der Wire-Name vom TypeScript-Namen abweicht. Behandle Business-Regeln, feldübergreifende Validierung und Normalisierung als Anwendungs-Policy, nicht als Struct-Verhalten.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## Einen stabilen Operationsnamen verwenden [#operation-name]

Setze `operation` auf eine Identität mit niedriger Kardinalität wie `orders.read`. Sie beschriftet Telemetrie und Diagnose, ohne URL, Nutzereingaben oder einen Wert je Request zu tragen.

## Das SDK frei von Ausführungszustand halten [#no-client]

Ein SDK-Paket exportiert Definitionen, Structs und Typen. Es ruft `createClient` nicht auf, hält keinen Singleton-Client und liest keine Umgebungsvariablen. Die Anwendung entscheidet über Endpoint und Zugangsdaten.

## Den Vertrag bewusst versionieren [#versioning]

Behandle ein entferntes Feld, eine geänderte Methode oder einen geänderten Pfad und ein eingeengtes Input als Breaking. Ergänzungen sind meist kompatibel. Halte die Peer-Range des Pakets ehrlich, veröffentliche mit demselben Definitionstext, gegen den die Anwendung kompiliert, und zeichne den Release-Tag für das veröffentlichte Paket auf.
