---
title: "Tests"
description: "Teste le contrat de la définition avec des transports injectés, de vrais tuples et un temps contrôlé."
---

## Injecter le transport [#inject]

Utilise `withHTTPHandle`, `withSSEHandle` ou `withWebSocketHandle` pour remplacer le transport de la plateforme. L’opération construit quand même la requête, exécute les intercepteurs et décode la réponse, donc le test exerce la vraie frontière de contrat.

```ts
const client = createClient(
  withEndpoint("https://fixture.invalid"),
  withHTTPHandle(async () => Response.json({ id: 7, status: "paid" })),
);
const [error, order] = await getOrder(client, { id: 7 });
expect(error).toBeNull();
expect(order?.status).toBe("paid");
```

## Vérifier le tuple, pas les internes [#tuple]

Vérifie le code de fault et la valeur décodée. Un test qui vérifie un appel à un helper privé ou un détail d’implémentation du transport casse quand l’implémentation change sans que le contrat change. Pour un fault, vérifie `code`, les champs pertinents et l’identité de `cause` quand la cause fait partie du contrat.

## Garder des fixtures de contrat réelles [#fixtures]

Lance un test d’intégration contre un vrai serveur pour chaque transport quand le changement touche la construction de requête, le décodage ou le démontage du flux. Utilise les serveurs de fixture déjà présents dans le dépôt plutôt qu’un second protocole mock. Un comportement propre au navigateur appartient à un projet navigateur ; un comportement propre au serveur appartient au projet serveur.

## Contrôler le temps explicitement [#time]

Utilise des fake timers pour les timeouts, le backoff, le délai de reconnexion et le heartbeat. Avance le temps après que l’événement testé s’est produit, et vérifie le chemin de code qui aurait dû s’exécuter. Ne vérifie jamais le temps écoulé réel. Pour un vrai socket, attends un événement concret comme `open`, `closed` ou la première frame.

## Tester le SDK comme un consommateur [#consumer]

Un test de SDK devrait importer les définitions que l’application importe, créer un client avec le transport de test et appeler l’opération. Il ne doit pas recréer la requête à la main ; cela teste le test, pas le SDK.
