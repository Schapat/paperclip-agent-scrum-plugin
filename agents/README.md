# Autonomous Scrum Team - Agent Instructions

Dieses Verzeichnis enthält die AGENTS.md Dateien für alle 6 Rollen des autonomen Scrum-Teams.

## Rollen-Übersicht

| Rolle | Datei | Hauptverantwortung |
|-------|-------|-------------------|
| **Product Owner** | `product-owner.md` | Produktvision, Backlog, Priorisierung, Zuweisung |
| **Scrum Master** | `scrum-master.md` | Prozess-Überwachung, Events, Flow, Bottlenecks |
| **Technical Lead** | `technical-lead.md` | Architektur, Refinement, Story Points |
| **Developer 1** | `developer.md` | Implementierung, Tests, PRs |
| **Developer 2** | `developer-2.md` | Implementierung, Tests, PRs (parallel) |
| **QA Engineer** | `qa-engineer.md` | Code Review, Akzeptanzkriterien, Done-Entscheidung |

## Ticket-Workflow (Strikte Reihenfolge)

```
┌─────────┐    ┌──────┐    ┌─────────────┐    ┌────────┐    ┌──────┐
│ BACKLOG │ →  │ TODO │ →  │ DEVELOPMENT │ →  │ REVIEW │ →  │ DONE │
└─────────┘    └──────┘    └─────────────┘    └────────┘    └──────┘
     │              │              │               │             │
     │              │              │               │             │
   PO/TL           PO           Dev             Dev/QA          QA
  erstellt/     weist zu      arbeitet        Review        markiert
  verfeinert                                               als fertig
```

## Erlaubte Status-Übergänge pro Rolle

| Rolle | Erlaubte Übergänge |
|-------|-------------------|
| **Product Owner** | backlog → todo (mit Zuweisung) |
| **Technical Lead** | keine Status-Änderungen (nur Inhalt bearbeiten) |
| **Developer** | todo → in_progress, in_progress → in_review |
| **QA Engineer** | in_review → done, in_review → in_progress |
| **Scrum Master** | keine Status-Änderungen (nur Events erstellen) |

## VERBOTENE Übergänge (für alle!)

- ❌ backlog → in_progress (muss durch TODO)
- ❌ backlog → in_review
- ❌ backlog → done
- ❌ todo → in_review (muss durch Development)
- ❌ todo → done
- ❌ in_progress → done (muss durch Review)
- ❌ in_review → todo (nur zurück zu Development)
- ❌ in_review → backlog

## Jede Rolle enthält

1. **Description** — Kurzbeschreibung der Rolle
2. **Expertise & Responsibilities** — Kernaufgaben und Skills
3. **Priorities** — Priorisierte Arbeitsbereiche
4. **Boundaries (VERBOTENE Aktionen)** — Was die Rolle NICHT tun darf
5. **Tools & Permissions** — Erlaubte API-Operationen
6. **Communication** — Kommentar-Formate
7. **Collaboration & Escalation** — Zusammenarbeit mit anderen Rollen
8. **Workflow-Regeln** — Detaillierte Ablauf-Beschreibungen

## Verwendung bei Plugin-Installation

Bei der Installation des Scrum-Team-Plugins werden diese Dateien als `instructionsBundle.files["AGENTS.md"]` an die jeweiligen Agenten übergeben.

```typescript
// Beispiel: Agent-Erstellung
await createAgent({
  name: "Product Owner",
  role: "product_owner",
  instructionsBundle: {
    files: {
      "AGENTS.md": fs.readFileSync("agents/product-owner.md", "utf-8")
    }
  }
});
```
