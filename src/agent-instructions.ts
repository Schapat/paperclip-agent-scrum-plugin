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

const HUMAN_SCOPE_GUARD = `${HUMAN_SCOPE_GUARD_MARKER}

Diese Regel hat Vorrang vor Leerlauf-, Backlog- oder Heartbeat-Regeln: Ein leerer Board, Timer-Heartbeat, Refinement-Event oder freie Kapazitaet ist keine Human-Freigabe fuer neue Produktarbeit. Erstelle, priorisiere, weise zu, verfeinere oder implementiere nur direkt von einem Human beauftragte Issues oder direkte Child-Issues eines freigegebenen Projekt-Kickoffs. Wenn alle direkten Child-Issues eines Kickoffs Done sind, ist der Auftrag abgeschlossen; starte keine Nachfolgearbeit und warte auf einen neuen Human-Projektauftrag. Bei ungebundener Agentenarbeit nicht fortfahren, sondern einen Scope-Hinweis hinterlassen und die Human-Freigabe abwarten.`;

const QA_REWORK_HANDOFF = `${QA_REWORK_HANDOFF_MARKER}

Wenn QA einen Defekt findet, dokumentiert QA das betroffene Kriterium und den konkreten Fix, setzt das Ticket auf Development und weist es einem Developer zu. QA implementiert den Fix niemals selbst. Der Developer liefert erneut nach Review; erst die nachfolgende QA-Prüfung darf das Ticket auf Done setzen.`;

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

  if (agentKey !== 'qa-engineer' || withScopeGuard.includes(QA_REWORK_HANDOFF_MARKER)) {
    return withScopeGuard;
  }
  return `${withScopeGuard.trimEnd()}\n\n${QA_REWORK_HANDOFF}\n`;
}