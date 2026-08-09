# DF-020: Board-Zustand bei parallelen Company-Invocations isolieren

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Der Worker hielt `state` und `companyId` als einzelne mutable Werte. Wenn zwei
Company-Invocations gleichzeitig die Initialisierung erreichten, konnte eine
Invocation nach einem `await` im Kontext der anderen Company fortsetzen. Dadurch
enthielt die Board-Antwort einer Company den Onboardingzustand einer anderen.

Im lokalen TestCompany-Zustand zeigte sich bereits ein historischer Kickoff aus
einer archivierten fremden Company. Dieser Root-Issue ist im korrekten
TestCompany-Scope nicht lesbar und kann deshalb nicht als klickbares Ticket
projiziert werden.

## Loesung

- Eine workerweite Queue fuehrt jeden Event-, Data- und Action-Handler komplett
  in einem exklusiven Company-Kontext aus.
- Die bisherige geteilte `readyPromise` wurde entfernt; die Initialisierung
  bleibt damit in genau der Host-Invocation, die sie gestartet hat.
- Gleichzeitige idempotente Refinement-Actions derselben Company teilen weiterhin
  ein Ergebnis, statt durch die Queue nacheinander unterschiedliche Resultate zu
  erhalten.
- Der historische, company-fremde TestCompany-Kickoff wurde nicht automatisch
  wieder angebunden. Er bleibt ein nicht oeffenbarer Altzustand; neue
  Projektauftraege erhalten weiterhin einen korrekt company-gebundenen Kickoff.

## Akzeptanzkriterien

- Parallele Board-Initialisierungen zweier Companies vermischen deren
  Projekt-Onboardingzustand nicht.
- Alle Worker-Einstiegspunkte verwenden dieselbe Company-Isolierung.
- Zwei gleichzeitige Refinement-Anfragen derselben Company erhalten weiterhin
  dieselbe erfolgreiche Antwort.

## Validierung

- Der kontrollierte Zwei-Company-Regressionstest war vor dem Fix rot: BMW
  erhielt den Audi-Onboardingzustand. Nach dem Fix ist er gruen.
- Der bestehende Concurrent-Refinement-Test besteht weiterhin.
- Vollstaendige Vitest-Suite: 373 Tests in 22 Dateien bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` sind erfolgreich.
- Lokale Plugin-Aktualisierung: `schapat.agent-scrum v2.1.1`, Status `ready`,
  Health `healthy`; die frische TestCompany-Board-Route rendert ohne
  `state.set`- oder Invocation-Scope-Fehler.