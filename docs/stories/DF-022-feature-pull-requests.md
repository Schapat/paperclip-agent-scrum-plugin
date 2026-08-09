# DF-022: Pull Requests pro Feature statt pro Ticket erzeugen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Fehlerbild

Die Developer-Anweisungen verlangten fuer jedes einzelne Ticket einen eigenen
Branch und Pull Request. Dadurch entstanden Pull Requests fuer kleinste
Liefertranchen statt einer zusammenhaengenden Review-Einheit fuer ein Feature.

## Ursache

Beide Developer-Rollen enthielten einen Ticket-Branch-Namen,
`feature/{ticket-id}-{kurzbeschreibung}`, sowie die ausdrueckliche Anweisung,
vor dem Wechsel nach `in_review` einen Pull Request anzulegen. Der QA-Workflow
behandelte zudem das Done eines Tickets als Zeitpunkt, an dem ein PR gemergt
werden konnte. Bereits konfigurierte Agenten erhielten keine vorrangige
Migrationsregel gegen diese alte Vorgabe.

## Loesung

- Developer arbeiten auf dem vorgegebenen gemeinsamen Feature-Branch,
  `feature/{feature-id}-{kurzbeschreibung}`.
- Der Ready-for-Review-Kommentar eines Tickets nennt den Feature-Branch und
  ausschliesslich die Commits dieses Tickets; ein PR-Link gehoert nicht in den
  Ticket-Kommentar.
- Ein einzelnes Ticket darf keinen Pull Request erstellen, mergen oder
  genehmigen. Erst wenn alle Tickets des Features von QA abgeschlossen sind und
  ihre Commits auf dem Feature-Branch liegen, erstellt der verantwortliche
  Developer genau einen Pull Request fuer das gesamte Feature.
- Der neue markerbasierte Abschnitt `Feature Branch Delivery` wird an bereits
  vorhandene Developer- und QA-Anweisungen angehaengt und hat Vorrang vor alten
  Ticket-PR-Regeln.

## Akzeptanzkriterien

- Developer pushen Ticket-Commits auf den Feature-Branch des zugehoerigen
  Features.
- Kein Ticket erstellt einen eigenen Pull Request.
- QA schliesst Tickets anhand ihrer Kriterien ab, ohne daraus einen PR-Merge
  abzuleiten.
- Nach QA-Abschluss aller Feature-Tickets entsteht genau ein Pull Request fuer
  den gemeinsamen Feature-Branch.
- Bestehende, angepasste Agentenanweisungen erhalten die neue Regel einmalig und
  idempotent.

## Validierung

- Regressionstest prueft die Feature-Branch-Regel in den quellverwalteten
  Developer-Anweisungen und in der Upgrade-Anweisung fuer vorhandene Agents.
- Fokussierte Tests: 42 Tests in zwei Testdateien erfolgreich.
- Gesamtsuite: 22 Testdateien und 376 Tests erfolgreich.
- `tsc --noEmit` und der Produktionsbuild sind erfolgreich.