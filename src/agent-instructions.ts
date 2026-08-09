import type { TeamAgentKey } from './team';

import developerOneInstructions from '../agents/developer-1/AGENTS.md';
import developerTwoInstructions from '../agents/developer-2/AGENTS.md';
import productOwnerInstructions from '../agents/product-owner/AGENTS.md';
import qaEngineerInstructions from '../agents/qa-engineer/AGENTS.md';
import scrumMasterInstructions from '../agents/scrum-master/AGENTS.md';
import technicalLeadInstructions from '../agents/technical-lead/AGENTS.md';

/** Source-controlled managed instructions used both for new and upgraded agents. */
export const MANAGED_AGENT_INSTRUCTIONS: Record<TeamAgentKey, string> = {
  'product-owner': productOwnerInstructions,
  'scrum-master': scrumMasterInstructions,
  'technical-lead': technicalLeadInstructions,
  'developer-1': developerOneInstructions,
  'developer-2': developerTwoInstructions,
  'qa-engineer': qaEngineerInstructions,
};

/** Legacy marker kept so existing bundles can be upgraded without deleting user text. */
export const HEARTBEAT_QUEUE_MARKER = '## Heartbeat Queue Scan';
export const EVENT_ROUTING_MARKER = '<!-- agent-scrum:event-driven-activation -->';
export const QA_REWORK_HANDOFF_MARKER = '## QA Rework Handoff';
export const HUMAN_SCOPE_GUARD_MARKER = '## Human Scope Guard';
export const SPRINT_AUTONOMY_MARKER = '## Approved Sprint Autonomy';
export const GITHUB_COMMIT_EVIDENCE_MARKER = '## GitHub Commit Evidence';
export const FEATURE_BRANCH_DELIVERY_MARKER = '## Feature Branch Delivery';

const HUMAN_SCOPE_GUARD = `${HUMAN_SCOPE_GUARD_MARKER}

Diese Regel hat Vorrang vor Leerlauf-, Backlog- oder Heartbeat-Regeln: Ein leerer Board, Timer-Heartbeat, Refinement-Event oder freie Kapazitaet ist keine Human-Freigabe fuer neue Produktarbeit. Erstelle, priorisiere, weise zu, verfeinere oder implementiere nur direkt von einem Human beauftragte Issues oder direkte Child-Issues eines freigegebenen Projekt-Kickoffs. Wenn alle direkten Child-Issues eines Kickoffs Done sind, ist der Auftrag abgeschlossen; starte keine Nachfolgearbeit und warte auf einen neuen Human-Projektauftrag. Bei ungebundener Agentenarbeit nicht fortfahren, sondern einen Scope-Hinweis hinterlassen und die Human-Freigabe abwarten.`;

const SPRINT_AUTONOMY = `${SPRINT_AUTONOMY_MARKER}

Die Human-Freigabe von Analyse, Backlog, Refinement und Sprint autorisiert die Lieferung aller direkten Child-Issues dieses Kickoffs im aktiven Sprint.

- Keine Paperclip-Confirmation und kein Human Approval fuer Implementierung, Tests, QA, Review oder Entscheidungen innerhalb der Akzeptanzkriterien eines aktiven Sprint-Tickets anfordern.
- Nutze die akzeptierten Akzeptanzkriterien, den Backlog und bestehende technische Konventionen als Entscheidungsvorgabe und liefere das Ticket durch den normalen QA-Prozess weiter.
- Eine neue Anforderung ausserhalb des Ticket- oder Sprint-Scopes als Scope-Hinweis dokumentieren und an Product Owner oder Scrum Master eskalieren. Den laufenden, bereits freigegebenen Ticket-Workflow nicht mit einer Human-Confirmation blockieren.`;

const QA_REWORK_HANDOFF = `${QA_REWORK_HANDOFF_MARKER}

Wenn QA einen Defekt findet, dokumentiert QA das betroffene Kriterium und den konkreten Fix, setzt das Ticket auf Development und weist es einem Developer zu. QA implementiert den Fix niemals selbst. Der Developer liefert erneut nach Review; erst die nachfolgende QA-Prüfung darf das Ticket auf Done setzen.`;

const GITHUB_COMMIT_EVIDENCE = `${GITHUB_COMMIT_EVIDENCE_MARKER}

Für jedes projektgebundene Ticket mit GitHub-Repository muss der Ready-for-Review-Kommentar einen eigenen Commit-Nachweis fuer einen bereits auf den zugehoerigen Feature-Branch gepushten Commit enthalten. Ergänze nach dem Push exakt einen Marker mit vollständigem SHA, GitHub-Commit-URL und Commit-Message:

<!-- agent-scrum:commit:v1 {"sha":"{full-sha}","url":"https://github.com/{owner}/{repo}/commit/{full-sha}","message":"{commit message}"} -->

Ohne diesen Nachweis darf QA das Ticket nicht auf Done lassen.`;

const FEATURE_BRANCH_DELIVERY = `${FEATURE_BRANCH_DELIVERY_MARKER}

Diese Regel hat Vorrang vor frueheren Anweisungen zu Ticket-Branches oder Ticket-Pull-Requests. Ein Ticket ist eine Liefertranche innerhalb eines Features, keine Pull-Request-Einheit.

- Arbeite auf dem vorgegebenen Feature-Branch des zugehoerigen Features und pushe die Ticket-Commits dorthin. Erstelle keinen Pull Request pro Ticket.
- Der Ready-for-Review-Kommentar eines Tickets nennt den Feature-Branch und nur die Commits dieses Tickets; ein PR-Link gehoert dort nicht hinein.
- QA schliesst ein Ticket erst nach der vollstaendigen Einzelpruefung seiner Akzeptanzkriterien ab. Das Done eines einzelnen Tickets erstellt, merged oder genehmigt keinen Pull Request.
- Erst wenn alle Tickets eines Features durch QA abgeschlossen und ihre Commits auf dem Feature-Branch liegen, erstellt der fuer den Feature-Branch verantwortliche Developer genau einen Pull Request fuer das gesamte Feature.`;

/** Minimal append-only activation rules for existing operator-customized instructions. */
export const EVENT_ROUTING_INSTRUCTIONS: Record<TeamAgentKey, string> = {
  'developer-1': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerte Aktivierung

Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen. Du erhaeltst keinen planmaessigen Timer-Heartbeat. Beginne Arbeit nur nach einer Ticket-Zuweisung oder einer gezielten Aktivierung durch den Plugin-Worker. Bearbeite den erteilten Auftrag und beanspruche keine unzugewiesene, fremde oder neue Arbeit aus der Queue.`,
  'developer-2': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerte Aktivierung

Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen. Du erhaeltst keinen planmaessigen Timer-Heartbeat. Beginne Arbeit nur nach einer Ticket-Zuweisung oder einer gezielten Aktivierung durch den Plugin-Worker. Bearbeite den erteilten Auftrag und beanspruche keine unzugewiesene, fremde oder neue Arbeit aus der Queue.`,
  'qa-engineer': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerte Aktivierung

Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen. Du erhaeltst keinen planmaessigen Timer-Heartbeat. Beginne einen Review nur nach einer Ticket-Zuweisung oder einer gezielten Aktivierung durch den Plugin-Worker. Pruefe den erteilten Review und beanspruche keine unzugewiesenen Reviews.`,
  'technical-lead': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerte Aktivierung

Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen. Du erhaeltst keinen planmaessigen Timer-Heartbeat. Führe Analysen und Refinements nur nach einer gezielten Aktivierung durch den Plugin-Worker oder einer direkten Zuweisung aus. Erfinde keine neue Refinement-Arbeit aus einer leeren Queue.`,
  'product-owner': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerte Aktivierung

Diese Regel hat Vorrang vor frueheren Timer- oder Queue-Scan-Anweisungen. Du erhaeltst keinen planmaessigen Timer-Heartbeat. Priorisiere, erstelle oder weise Arbeit nur nach einer gezielten Aktivierung durch den Plugin-Worker oder einer direkten Human-Zuweisung zu. Erfinde keine neue Arbeit aus einer leeren Queue.`,
  'scrum-master': `${EVENT_ROUTING_MARKER}

## Ereignisgesteuerter Watchdog

Du bist der einzige zeitgesteuerte Watchdog und pruefst alle 30 Minuten nur Blocker, WIP-Verstoesse und liegengebliebene, bereits freigegebene Arbeit. Der Plugin-Worker entscheidet weiterhin die operativen Zeremonien und Rollenaktivierungen. Beanspruche keine Delivery-Arbeit; dokumentiere, wecke oder eskaliere die zustaendige Rolle ohne Zuweisungen zu ueberschreiben.`,
};

/** Keeps existing customized instructions intact while adding the activation rule once. */
export function heartbeatAwareInstructions(agentKey: TeamAgentKey, existing: string | null): string {
  const source = !existing || !existing.trim()
    ? MANAGED_AGENT_INSTRUCTIONS[agentKey]
    : existing;
  const withEventRouting = source.includes(EVENT_ROUTING_MARKER)
    ? source
    : `${source.trimEnd()}\n\n${EVENT_ROUTING_INSTRUCTIONS[agentKey]}\n`;

  const withScopeGuard = withEventRouting.includes(HUMAN_SCOPE_GUARD_MARKER)
    ? withEventRouting
    : `${withEventRouting.trimEnd()}\n\n${HUMAN_SCOPE_GUARD}\n`;
  const withSprintAutonomy = withScopeGuard.includes(SPRINT_AUTONOMY_MARKER)
    ? withScopeGuard
    : `${withScopeGuard.trimEnd()}\n\n${SPRINT_AUTONOMY}\n`;

  const withCommitEvidence =
    (agentKey === 'developer-1' || agentKey === 'developer-2') &&
    !withSprintAutonomy.includes(GITHUB_COMMIT_EVIDENCE_MARKER)
      ? `${withSprintAutonomy.trimEnd()}\n\n${GITHUB_COMMIT_EVIDENCE}\n`
      : withSprintAutonomy;

  const withFeatureBranchDelivery =
    (agentKey === 'developer-1' || agentKey === 'developer-2' || agentKey === 'qa-engineer') &&
    !withCommitEvidence.includes(FEATURE_BRANCH_DELIVERY_MARKER)
      ? `${withCommitEvidence.trimEnd()}\n\n${FEATURE_BRANCH_DELIVERY}\n`
      : withCommitEvidence;

  if (agentKey !== 'qa-engineer' || withFeatureBranchDelivery.includes(QA_REWORK_HANDOFF_MARKER)) {
    return withFeatureBranchDelivery;
  }
  return `${withFeatureBranchDelivery.trimEnd()}\n\n${QA_REWORK_HANDOFF}\n`;
}