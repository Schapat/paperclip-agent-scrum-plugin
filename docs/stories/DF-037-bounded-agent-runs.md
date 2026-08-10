# DF-037: Langlebige Shell-Prozesse duerfen Agent-Runs nicht unbemerkt blockieren

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-10

## Problem

Ein Developer-Run fuer TESAA-13 startete einen Next.js-Dev-Server mit Shell-
Jobsteuerung. Der Server erbte die gepipeten Ausgabestroeme des Kiro-Prozesses.
Der Paperclip-Prozessrunner schliesst einen Run erst nach dem `close` dieser
Stroeme ab; deshalb hielt der Hintergrundserver den Run offen, obwohl die
eigentliche Shell-Arbeit beendet war. Bestehende Kiro-Agenten hatten zudem
keinen gesetzten Adapter-Timeout. Dadurch blieb der Ticket-Run mehr als 15
Minuten als `in progress` sichtbar.

Ein Board-Cancel ist keine geeignete automatische Reparatur: Der Host markiert
ihn bewusst als menschlichen Stopp und unterdrueckt eine Wiederaufnahme. Die
Korrektur verwendet daher den nativen Adapter-Timeout, der die gesamte
Prozessgruppe terminiert, und einen begrenzten, ticketgebundenen Wiederanlauf.

## Akzeptanzkriterien

- Bestehende und neu angelegte Managed Agents erhalten genau einmal eine
  verbindliche Regel fuer begrenzte Shell-Prozesse.
- Die Regel untersagt Dev-Server, Watcher und andere langlebige Prozesse mit
  Hintergrundjob-Syntax (`&`, `$!`, `%1`, `nohup`, `disown`, `setsid`, `screen`,
  `tmux`) innerhalb eines Agent-Runs.
- Neue und bereits vorhandene Managed Agents erhalten `timeoutSec: 600` und
  `graceSec: 15`, ohne Modell, Credentials oder sonstige Adapterfelder zu
  ersetzen.
- Ein Server-Smoketest darf nur mit einem Prozess-Supervisor laufen, der die
  gesamte Prozessgruppe terminiert und auf deren Ende wartet; fehlt ein solcher
  Weg, dokumentiert der Agent die Verifikationsgrenze statt einen Server zu
  starten.
- Ein nativer `timed_out`-Run bekommt genau einen neuen, ticketgebundenen
  Weckruf. Ein erfolgreicher neuer Run bereinigt den Timeout-Zustand.
- Ein zweiter Timeout desselben Tickets bekommt keinen weiteren automatischen
  Wiederanlauf und bleibt als klarer Blocker sichtbar.
- Ein explizit `cancelled`-Run wird niemals automatisch fortgesetzt.
- Die Reconciliation prueft den Zustand minütlich, damit ein festgefahrener Run
  nicht erneut 15 Minuten unbemerkt bleibt.

## Validierung

- Regressionstests pruefen die idempotente Nachrüstung der Prozessregel und die
  sichere Timeout-Migration bestehender Kiro-Agenten.
- Regressionstests pruefen die einmalige Recovery, die Unterdrueckung eines
  zweiten Timeout-Recoverys, den finalen Cancel und die Persistenz des Budgets.
- Der fokussierte Testlauf und Typecheck laufen erfolgreich.