# FE-008: GitHub-Commitnachweise, Code-Diffs und Pipeline-Gate fuer Projektauftraege

**Klassifizierung:** Feature

**Status:** Erledigt

**Datum:** 2026-08-09

## Ziel

Projektgebundene Tickets duerfen nur dann auf `done` bleiben, wenn ein
Developer einen nachvollziehbaren GitHub-Commitnachweis hinterlegt hat. Im
Ticketdialog sollen die geaenderten Dateien und die von GitHub gelieferten
Patches sichtbar sein. Vor dem Start eines Projektauftrags wird fuer ein
verknuepftes GitHub-Repository dessen Erreichbarkeit und der letzte erfolgreiche
GitHub-Actions-Lauf geprueft.

## Umsetzung

- Der GitHub-Client validiert HTTPS- und SSH-Repository-URLs, Repositoryzugriff,
  mindestens einen Actions-Workflow und den letzten erfolgreich abgeschlossenen
  Workflow-Run. Private Repositories koennen den neuen optionalen
  `githubToken` aus der Plugin-Konfiguration verwenden.
- Das Onboarding prueft GitHub-Remotes vor dem Anlegen des Kickoff-Issues. Ein
  nicht erreichbares Repository, fehlender Workflow oder fehlgeschlagener Lauf
  stoppt den Projektauftrag vor jeder Issue-Erstellung. Lokale und nicht-GitHub-
  Workspaces bleiben unveraendert.
- Commitmarker werden ausschliesslich aus Kommentaren verwalteter Developer
  projiziert und beim Synchronisieren projektgebundener Tickets erhalten.
- Ein `done`-Issue ohne solchen Nachweis wird nach `in_progress` an einen
  Developer zurueckgegeben; ohne verfuegbaren Developer wird es blockiert. Ein
  Hinweis kommentiert das benoetigte Markerformat.
- Neue und bereits konfigurierte Developer-Anweisungen verlangen den Marker
  `agent-scrum:commit:v1` mit SHA, Commit-URL und Nachricht vor dem Review.
- Der Ticketdialog besitzt den lazy geladenen Tab `Code`. Er zeigt Commit,
  Datei-Status, Additionen, Deletionen und aufklappbare GitHub-Patches.
- Die Worker-Aktion akzeptiert nur Commits, die fuer das angefragte Ticket
  gespeichert sind, und liest sie ausschliesslich aus dem Repository des
  Projekt-Workspaces.

## Akzeptanzkriterien

- Ein Projektauftrag mit GitHub-Remote startet nur bei erreichbarem Repository
  und erfolgreichstem aktuellem GitHub-Actions-Run.
- Ein Projekt-Ticket kann ohne Developer-Commitnachweis nicht auf `done`
  bleiben.
- Ein gueltiger Developer-Commit wird beim Host-Sync auf dem Ticket erhalten.
- Das Ticket zeigt fuer aufgezeichnete Commits die von GitHub gelieferten
  Datei-Aenderungen und Patches.
- Private GitHub-Repositories haben eine vorgesehene Token-Konfiguration.

## Validierung

- Fokussierte Tests fuer Repository-/Pipeline-Gate, Commit-Projektion,
  Completed-Ticket-Sync, Commit-Patches und Agent-Instruktionsupgrade sind
  erfolgreich.
- Vollstaendige Vitest-Suite: 22 Testdateien und 372 Tests bestanden.
- `./node_modules/.bin/tsc --noEmit` und `node ./esbuild.config.mjs` sind
  erfolgreich.
- Browser-Smoketest ist durch einen bereits laufenden Paperclip-Hostfehler
  blockiert: Der Plugin-Aufruf scheitert vor dem Rendern an einer
  company-scope-`state.set`-Ablehnung. Der Fehler liegt ausserhalb dieses
  Feature-Patches; eine visuelle Host-Validierung des `Code`-Tabs steht daher
  noch aus.