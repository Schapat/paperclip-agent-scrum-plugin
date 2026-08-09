# OP-002: README, Release-Commit und lokale Plugin-Aktualisierung

**Klassifizierung:** Betrieb

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Die dokumentierten Funktionen, der Release-Stand und die lokale Paperclip-
Installation sollen denselben, nachvollziehbaren Plugin-Stand abbilden.

## Umsetzung

- README um GitHub-Repository-/Pipeline-Gate, Commit-Evidenz, Code-Tab,
  `githubToken`, lokale Upgrade-Anleitung, aktuelle Testzahl und bekannte
  GitHub-Grenzen erweitert.
- Plugin-Version in Paket und Manifest auf `2.1.0` angehoben.
- Gesamten vorhandenen Arbeitsbaum in Release-Commit `aa5e633`
  (`feat: complete GitHub delivery workflow`) aufgenommen.
- Lokale Paperclip-Instanz ueber den gespeicherten lokalen Paketpfad mit
  `plugin upgrade schapat.agent-scrum` aktualisiert.

## Akzeptanzkriterien

- README beschreibt die neuen GitHub- und Ticket-Code-Features sowie deren
  Konfiguration und lokalen Upgrade-Weg.
- Paket- und Manifest-Version stimmen ueberein.
- Alle vorliegenden Aenderungen sind committed.
- Die lokale Plugin-Instanz fuehrt die neue Version mit gesundem Status aus.

## Validierung

- `./node_modules/.bin/vitest run --config ./vitest.config.ts`: 22 Testdateien
  und 372 Tests bestanden.
- `./node_modules/.bin/tsc --noEmit`, `node ./esbuild.config.mjs` und
  `git diff --check` erfolgreich.
- Gebautes Manifest meldet `2.1.0`.
- Lokale Paperclip-Instanz `http://localhost:3100`: Plugin
  `schapat.agent-scrum` meldet `v2.1.0`, Status `ready` und Health `healthy`.