# DF-013: Projektabschluss und Human Scope Guard gegen ungebundene Agentenarbeit

**Klassifizierung:** Defekt

**Status:** Erledigt

**Datum:** 2026-08-09

## Befund

Nach Abschluss aller Dark-Mode-Stories blieb der Projektauftrag aktiv. Ein
Scrum-Master-Heartbeat erzeugte ausserhalb des Projekts das Root-Issue
`TES-11` und startete ein generisches Refinement. Der Product Owner leitete
daraus einen nicht beauftragten SaaS-Backlog ab; `TES-12` bis `TES-21` waren
weder direkte Projekt-Child-Issues noch im Projektboard sichtbar.

## Ursache

- `ProjectOnboarding` kannte keinen terminalen Abschlussstatus.
- Bereits erledigte Child-Issues galten weiterhin als Refinement-Kandidaten.
- Das lokale automatische Backlog-Refinement durfte den PO ohne Human-Gate zum
  Erzeugen neuer Stories auffordern.
- Die Managed-Agent-Instructions interpretierten leeres Backlog, Timer und freie
  Kapazitaet als Erlaubnis fuer neue Produktarbeit.

## Loesung

- Wenn alle direkten Child-Issues eines aktiven Kickoffs Done sind, wechselt der
  Projektauftrag nach `completed` und zeigt diesen Status im Board sichtbar an.
- Ein abgeschlossener Auftrag bleibt sichtbar; nur die explizite Human-Aktion
  **Start next project request** oeffnet den kontrollierten Einstieg in neuen
  Scope.
- `completed` unterdrueckt weiteres Projekt-Refinement; Done-Stories sind keine
  Refinement-Kandidaten.
- Automatische lokale Refinements erfassen weiterhin die Luecke, dispatchen ohne
  Human-Ausloesung aber keine PO-Arbeit zur Backlog-Erweiterung.
- Alle sechs Rollen besitzen einen vorrangigen `Human Scope Guard`; vorhandene
  Instructions-Bundles erhalten ihn append-only beim Reconcile.
- Der Worker blockiert agentengenerierte, nicht projektgebundene Issues
  hostseitig, entfernt die Zuweisung und dokumentiert `Human scope approval
  required`. Beim Upgrade werden auch vorhandene, eindeutig per
  `createdByAgentId` attribuierte Scope-Abweichungen abgefangen.

## Akzeptanzkriterien

- Vollständig gelieferte Projektauftraege stehen auf `completed` und erhalten
  kein weiteres automatisches Refinement.
- Ein leeres Board erzeugt ohne Human-Ausloesung keine neuen PO-Stories.
- Ein vom Scrum-Team ausserhalb des aktiven Projekts erzeugtes Issue wird
  blockiert und nicht an Development geliefert.
- Die Projektansicht zeigt abgeschlossene Lieferung und angehaltene
  Scope-Abweichungen sichtbar an.
- Timer-Agents duerfen keine Nachfolgearbeit aus leerem Backlog ableiten.

## Validierung

- Domain-, Ceremony-, Instructions- und Worker-Regressionstests decken den
  Abschluss, die automatische Scope-Sperre, den Bundle-Upgrade und das
  Host-Issue-Holding ab.
- Die komplette Suite besteht mit 21 Testdateien und 358 Tests.
- TypeScript und Produktionsbuild sind erfolgreich.
- Lokale Reconciliation auf TestCompany: Der Dark-Mode-Auftrag steht auf
  `completed`, seine sechs Child-Issues stehen auf Done und es gibt keine aktive
  Projektarbeit. Die elf eindeutig per `createdByAgentId` attribuierten,
  ungebundenen Issues (`TES-11` bis `TES-21`) wurden auf `blocked` gesetzt und
  entzugewiesen. Product Owner, Scrum Master und Developer 1 enthalten den
  materialisierten `## Human Scope Guard`.
- Browser-Validierung auf beiden offenen Scrum-Board-Seiten: Abschlussstatus,
  Scope-Hold-Warnung und **Start next project request** sind sichtbar; der
  irrefuehrende Refinement-Hinweis ist nach Projektabschluss nicht mehr sichtbar.
- Lokale Installation: `schapat.agent-scrum v2.0.12`, Status `ready`, Health
  `healthy`.