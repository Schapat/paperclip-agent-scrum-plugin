# DF-025: Plugin-Datenaufrufe duerfen das Scrum Board nicht blockieren

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Problem

Das Scrum Board bleibt beim Laden stehen. Die Browser-Aufrufe an die Plugin-
Datenendpunkte `board` und `log` liefern nach einem Timeout `502 Bad Gateway`.
Der Plugin-Registry- und Health-Status ist dabei `ready` beziehungsweise
`healthy`.

Der gemeinsame Company-Invocation-Wrapper ist die primaere Untersuchungsflaeche:
Er serialisiert Data-, Action- und Event-Handler. Blockiert die erste Invocation,
warten auch die anschliessenden Board- und Log-Anfragen unbegrenzt.

## Ursache

Ein Board-Aufruf hielt die globale Company-Queue, waehrend ein Host-Aufruf einen
`issue.updated`-Event synchron an den Worker zustellte. Der Event wurde hinter
dem laufenden Board-Aufruf eingereiht, obwohl der ausloesende Host-Aufruf auf
seine Quittierung wartete. Diese Reentranz bildete einen Deadlock und endete nach
dem Host-RPC-Timeout in `502 Bad Gateway`.

Der Host erkannte das Plugin zudem noch als single-tenant, obwohl Board-Zustand
und Konfiguration bereits je Company gelesen werden.

## Loesung

- Der Worker quittiert einen Event sofort, wenn bereits eine Company-Invocation
  laeuft, und arbeitet ihn danach weiterhin geordnet in derselben Queue ab.
- Bei einer freien Queue bleibt das bisherige synchrone Event-Verhalten erhalten.
- Der Worker deklariert `multiCompanyConfig: true`, damit der Host
  company-spezifische Konfigurationen nicht mehr als Cross-Tenant-Konflikt
  verwirft.
- Ein Regressionstest deckt den Event waehrend einer laufenden
  Board-Initialisierung ab.

## Akzeptanzkriterien

- Ein Board-Aufruf fuer eine gueltige Company antwortet innerhalb des
  Host-Timeouts erfolgreich.
- Die Datenaufrufe `board` und `log` blockieren sich nicht dauerhaft.
- Die Company-Isolierung aus DF-020 bleibt fuer parallele Invocations erhalten.
- Ein Regressionstest deckt den realen Data-Callback-Pfad ab.

## Validierung

- Der Regressionstest war vor dem Fix rot: ein `issue.updated`-Event erhielt
  waehrend einer gehaltenen Board-Queue keine Quittierung.
- `src/__tests__/project-onboarding-worker.test.ts`: 41 Tests bestanden.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` bestanden.
- Die lokale Plugin-Instanz wurde aktualisiert und ist `ready` sowie `healthy`.
- `data/board` liefert wieder vollstaendige Antworten fuer TestCompany und eine
  zweite Company; beide enthielten sechs Scrum-Agenten.
- Browser-Reload: `loadingCount: 0`; die Scrum-Board-Projektansicht rendert.