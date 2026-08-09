# DF-018: Projekt-Onboarding darf keine GitHub-Actions-Pipeline erzwingen

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Fehlerbild

Ein Paperclip-Projekt mit gueltigem Primary Workspace und GitHub-Repository
kann keinen Projektauftrag starten, wenn das Repository keine GitHub-Actions-
Workflow-Datei besitzt. Das Plugin zeigt dann beispielsweise `The GitHub
repository has no GitHub Actions workflow.`

## Ursache

Das Plugin hat beim Onboarding eine eigene GitHub-REST-Pruefung auf Workflow und
letzten erfolgreichen Actions-Run ergaenzt. Paperclip liefert dem Plugin jedoch
bereits den durch den Host verwalteten Primary Workspace mit Repository-Link,
Ref und Arbeitsverzeichnis. Die Plugin-Pruefung ueberschreibt damit unnoetig die
hostseitige Projektverknuepfung.

## Ziel

Ein vorhandener Paperclip Primary Workspace reicht fuer den Start des
Projekt-Onboardings. GitHub-Actions darf weder erforderlich sein noch den
Projektauftrag blockieren. Der optionale Abruf von Datei-Patches fuer einen
bereits aufgezeichneten GitHub-Commit bleibt erhalten.

## Umsetzung

- Die direkte GitHub-REST-Pruefung im Onboarding wurde entfernt; insbesondere
	werden weder Actions-Workflows noch deren letzte Runs abgefragt.
- Der vorhandene Paperclip Primary Workspace bleibt die verbindliche
	Voraussetzung fuer den Start eines Projektauftrags.
- Der optionale GitHub-Token wird nur noch bei der on-demand-Abfrage von
	Datei-Aenderungen eines im Ticket aufgezeichneten Commits verwendet.
- Die Actions-spezifische Hilfs-API und ihre Tests wurden entfernt.

## Akzeptanzkriterien

- Ein GitHub-Repository ohne Actions-Workflow kann mit vorhandenem Primary
	Workspace einen Projektauftrag starten.
- Der Onboarding-Start fuehrt keinen direkten GitHub-Request aus.
- Der Code-Tab kann weiterhin Datei-Patches eines aufgezeichneten GitHub-Commits
	laden.

## Validierung

- Regressionstest: ein Paperclip-verknuepfter GitHub-Workspace startet ohne
	direkten GitHub- oder Actions-Request.
- Fokussierter Test fuer den Commit-Patch-Abruf erfolgreich.
- GitHub-Hilfstest und `./node_modules/.bin/tsc --noEmit` erfolgreich.