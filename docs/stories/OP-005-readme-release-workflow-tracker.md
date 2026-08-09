# OP-005: README aktualisieren und aktuellen Plugin-Stand veroeffentlichen

**Klassifizierung:** Betrieb

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Die oeffentliche Projektbeschreibung soll den aktuellen Scrum-Board-Ablauf
korrekt erklaeren und der vollstaendige, bereits validierte Plugin-Stand soll
ueber den `main`-Branch veroeffentlicht werden.

## Erledigt

- Der Test-Badge wurde auf 400 erfolgreiche Tests aktualisiert.
- Die README beschreibt den externen Workflow-Tracker, die zustaendige Rolle,
  Human Approvals und den direkten Paperclip-Kickoff-Link.
- Der Onboarding-Ablauf nennt die tatsaechliche Aktion **Approve technical
  analysis** statt des veralteten Story-Discovery-Einstiegs.
- Alle aktuellen Arbeitsbaum-Aenderungen werden gemeinsam nach `origin/main`
  committed und gepusht.

## Validierung

- Vollstaendige Vitest-Suite: 24 Dateien und 400 Tests erfolgreich.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` erfolgreich.