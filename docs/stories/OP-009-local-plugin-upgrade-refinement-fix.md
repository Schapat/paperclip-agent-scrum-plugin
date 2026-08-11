# OP-009: Lokale Paperclip-Plugin-Instanz auf den Technical-Lead-Refinement-Fix aktualisieren

**Klassifizierung:** Betrieb

**Status:** Erledigt

**Datum:** 2026-08-10

## Ziel

Die laufende lokale Paperclip-Instanz soll das in DF-039 korrigierte
Technical-Lead-Refinement laden.

## Durchfuehrung

- Das Plugin-Bundle wurde mit `node ./esbuild.config.mjs` neu gebaut.
- Der lokale Host auf `http://127.0.0.1:3100` hat das offizielle Upgrade
  `POST /api/plugins/schapat.agent-scrum/upgrade` erfolgreich ausgefuehrt.
- Die bestehende lokale Paketbindung blieb auf den aktuellen Arbeitsbereich
  `plugin-scrum-team` erhalten.

## Verifikation

- Der Host meldet fuer `schapat.agent-scrum` den Status `ready`.
- `lastError` ist `null`.
- Der Host-Zeitstempel lautet nach dem Reload `2026-08-10T16:41:52.435Z`.
- Das geladene Manifest enthaelt die Regel
  `Issue-bound project refinement` fuer den Technical Lead.

## Hinweis

Die naechste Anfrage an das Scrum Board einer betroffenen Organisation
reconciliert das bereits vorhandene Technical-Lead-Instruktionsbundle und fuegt
die versionierte Ausnahme fuer den Host-gesteuerten Refinement-Run einmalig an.