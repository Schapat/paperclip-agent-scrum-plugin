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
- Aktualisierung auf `v2.0.8`: QA-Gate, hostgeführte Blocker-Auflösung,
  Live-Projektion von Developer-/QA-Arbeit, actorlose QA-Abschlüsse,
  Agentennamen, QA-AC-Projektion, Projekt-Event-Kontext und der standardaktive
  Sprint-Gate für neue Onboardings sind lokal aktiv.
- Die Capability-Erweiterungen `project.workspaces.read`, `issues.wakeup` und
	`ui.sidebar.register` sind im lokalen Manifest registriert.
- Der Soft-Uninstall/Reinstall ohne `--force` hat die bestehenden
	organisationsbezogenen Konfigurationen erhalten.