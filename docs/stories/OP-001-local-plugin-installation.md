# OP-001: Lokale Plugin-Installation und Smoke-Test

**Klassifizierung:** Betrieb

**Status:** Erledigt

**Datum:** 2026-08-08

## Ziel

Den aktuellen Build von Agent Scrum in der laufenden lokalen Paperclip-Instanz
installieren beziehungsweise aktualisieren und den installierten Status prüfen.

## Umgebung

- Paperclip-Checkout: `/Users/patrick.scharnow/Projekte/testpaperclip/paperclip`
- Lokale Instanz: `http://127.0.0.1:3100`
- Deployment-Modus: `local_trusted`

## Akzeptanzkriterien

- Das Plugin ist mit dem aktuellen Build bei der lokalen Instanz registriert.
- Die aktuellen Manifest-Rechte werden vom Host akzeptiert.
- Der Worker erreicht den Status `ready` oder einen gleichwertig gesunden Status.
- Der lokale Build und ein gezielter Installations-/Statuscheck sind dokumentiert.

## Validierung

- `pnpm build`: aktueller Worker-, Manifest- und UI-Build erstellt.
- Lokale Instanz: `http://127.0.0.1:3100`, `local_trusted`.
- Plugin `schapat.agent-scrum`: Status `ready`, Health-Check `healthy`.
- Aktualisierung auf `v2.0.12`: QA-Gate, hostgeführte Blocker-Auflösung,
  Live-Projektion von Developer-/QA-Arbeit, actorlose QA-Abschlüsse,
  Agentennamen, QA-AC-Projektion, Projekt-Event-Kontext und der standardaktive
  Sprint-Gate fuer neue Onboardings sowie aktive 300-Sekunden-Heartbeats fuer
  die sechs Managed Agents, QA-Rework-Handoff an einen Developer und die
  entduplizierte, verifizierte Akzeptanzkriterienanzeige sowie terminaler
    Projektabschluss, Human Scope Guard und der explizite Folgeprojektstart sind
    lokal aktiv.
- Nach einer Board-Datenanfrage im TestCompany-Kontext sind alle sechs
    bestehenden Managed Agents mit aktivem 300-Sekunden-Heartbeat und einer
    materialisierten Queue-Scan-Anweisung bestaetigt.
- Der Soft-Upgrade auf `v2.0.12` hat den abgeschlossenen Dark-Mode-Auftrag auf
    `completed` gesetzt. Alle sechs direkten Child-Issues stehen auf Done; die
    elf ausserhalb des Kickoff-Baums agentengenerierten Issues (`TES-11` bis
    `TES-21`) sind `blocked`, entzugewiesen und als Human-Scope-Holds sichtbar.
- Die Capability-Erweiterungen `project.workspaces.read`, `issues.wakeup` und
	`ui.sidebar.register` sind im lokalen Manifest registriert.
- Der Soft-Uninstall/Reinstall ohne `--force` hat die bestehenden
	organisationsbezogenen Konfigurationen erhalten.