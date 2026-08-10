# OP-006: Organisationsstruktur und Rollennutzen des initialisierten Scrum-Teams

**Klassifizierung:** Betrieb

**Status:** Erledigt

**Datum:** 2026-08-10

## Anlass

Nach dem Initialisieren einer neuen Organisation zeigt das Paperclip-
Organigramm den Company Lead (CEO) ueber Product Owner, Scrum Master,
Technical Lead und QA Engineer. Die beiden Developers sind dem Technical Lead
zugeordnet. Zusaetzlich sichtbare Rollen sollen daraufhin bewertet werden, ob
sie zum Scrum-Plugin gehoeren und ob eine andere Fuehrungslinie sinnvoll waere.

## Befund

- Das Plugin deklariert und reconciliert genau sechs Rollen: Product Owner,
  Scrum Master, Technical Lead, QA Engineer sowie Developer 1 und Developer 2.
- `Summarizer` und `Reflection Coach` sind keine Rollen der
  Plugin-Teamdefinition. Sie stammen deshalb aus einer anderen
  Organisations- oder Plugin-Konfiguration und beeinflussen den Scrum-Workflow
  nicht.
- Der sichtbare Agent `Chief of staff` hat die Rolle CEO und ist damit der
  Company Lead, nicht eine siebte Scrum-Rolle.
- Der umgesetzte Reporting-Vertrag lautet:

  ```text
  Company Lead (CEO)
    Product Owner
    Scrum Master
    Technical Lead
      Developer 1
      Developer 2
    QA Engineer
  ```

## Entscheidung

Die bestehende Struktur bleibt bestehen. Product Owner, Scrum Master,
Technical Lead und QA Engineer sind fachliche Peers unter dem Company Lead.
Nur die Developers berichten an den Technical Lead.

Der Product Owner hat Produkt- und Priorisierungsautoritaet, aber keine
disziplinarische oder technische Vorgesetztenrolle. Der Scrum Master steuert
den Prozess und den Recovery-Watchdog, soll jedoch ebenfalls nicht die
Produkt- oder Technikrolle uebernehmen. Die QA bleibt direkt beim Company Lead,
damit ihre Done-Entscheidung unabhaengig von Delivery-Druck bleibt.

Alle sechs Rollen haben im aktuellen Plugin einen eigenen Ausfuehrungspfad:

- Product Owner: Backlog erstellen, priorisieren und sprintreife Arbeit
  zuweisen.
- Scrum Master: Watchdog fuer gestrandetete Arbeit, Prozessverbesserung und
  Retrospektiven.
- Technical Lead: Projektanalyse, technische Verfeinerung, Schaetzung,
  Architekturhinweise und Eskalationen.
- QA Engineer: Akzeptanzkriterien pruefen und allein ueber `Done` oder Rework
  entscheiden.
- Developers: Implementierung und Tests, mit zwei parallelen Kapazitaeten.

## Option fuer kleinere Teams

Developer 2 ist der einzige sinnvolle kuenftige Skalierungshebel. Das aktuelle
Plugin erzeugt jedoch fest zwei Developer; die Einstellung `developerCount`
beeinflusst die Sprint-Kapazitaetsrechnung, nicht die Anzahl verwalteter
Agenten. Eine Einzel-Developer-Variante braucht daher eine eigene,
testabgedeckte Teamgroessen-Funktion in Manifest, Reconciliation,
Kapazitaetsrechnung und Agent-Instruktionen. Rollen nur im Organigramm zu
verschieben oder zu entfernen waere kein sicherer Ersatz.

## Validierung

- `./node_modules/.bin/vitest run --config ./vitest.config.ts src/__tests__/team.test.ts`
  erfolgreich: 19 Tests.
- Die Tests bestaetigen sechs deklarierte Scrum-Rollen, direkte Reporting-Lines
  zum CEO fuer die vier Lead-Rollen und die Technical-Lead-Line fuer beide
  Developers.