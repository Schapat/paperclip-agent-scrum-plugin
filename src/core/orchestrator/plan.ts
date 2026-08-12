/**
 * Der eine Ort, an dem steht, wer als Naechstes dran ist.
 *
 * Das Board wurde bisher *flankengesteuert* bewegt: eine Bedingung loeste aus,
 * wenn sie von "nicht erfuellt" auf "erfuellt" wechselte. Damit war jeder
 * verpasste Uebergang endgueltig verpasst — ein Event waehrend eines
 * Worker-Neustarts, ein abgestuerzter Run, eine Zuweisung, die nie ankam. Das
 * Ticket blieb liegen, und niemand fragte je wieder nach. Die Gegenmassnahmen
 * dazu (Stillstandsvermerke, Wiederanlauf-Zaehler, Wartefristen, sechs
 * Parameter zum Zuruecknehmen falscher Vermerke) waren allesamt Ersatz fuer die
 * fehlende Wiedervorlage.
 *
 * Hier ist es *zustandsgesteuert*: bei jedem Durchlauf wird die vollstaendige
 * Menge faelliger Absichten neu aus dem Zustand berechnet. Ein verpasster
 * Uebergang existiert nicht mehr — was offen ist, faellt beim naechsten
 * Durchlauf wieder an. Deshalb braucht diese Datei weder Gedaechtnis noch Uhr:
 * dieselbe Lage ergibt immer dieselben Absichten.
 *
 * Das Modul bleibt frei von SDK-Aufrufen, damit die Regeln ohne laufenden Host
 * pruefbar sind.
 */

import type { AgentRole, ScrumAgent, ScrumTask, TicketStall, WorkerState } from '../types';
import { isBlockedByDependency, isReady } from '../ceremonies/types';
import { pickAssignee } from '../ceremonies/assignment';
import { type BoardIntent, intentKey } from './intents';

export interface PlanInput {
  state: WorkerState;
  /**
   * Tickets, an denen der Host gerade nachweislich einen Lauf fuehrt.
   *
   * Das ist die einzige Nebenlaeufigkeitssperre dieses Entwurfs — und bewusst
   * die des Hosts, nicht die des Workers. Die alten Sperren (`projectPlanning-
   * Promise`, `projectRefinementPromise`, `wakeupAttempts`) lagen im
   * Arbeitsspeicher und waren nach jedem Neustart weg, waehrend der Lauf, den
   * sie schuetzen sollten, weiterlief. Der Host weiss es jederzeit richtig.
   */
  liveRunTaskIds: ReadonlySet<string>;
  /**
   * Laeuft gerade ein Refinement-Stapel?
   *
   * Der Technical Lead verfeinert mehrere Tickets in *einem* Lauf, der an einem
   * Traeger-Ticket haengt. Fuer die uebrigen Mitglieder des Stapels meldet der
   * Host deshalb keinen Lauf — sie sehen unbearbeitet aus, obwohl gerade an
   * ihnen gearbeitet wird. Ohne diese Angabe wuerde die Wiedervorlage nach
   * Ablauf der Wartezeit einen zweiten Stapel anstossen und den ersten
   * ueberholen; der Technical Lead faengt dann von vorne an.
   */
  refinementInFlight?: boolean;
}

/**
 * Stillstaende, die kein Agent aufloesen kann — hier endet die Automatik.
 *
 * `escalated` gehoert dazu, damit die Aufgabe stabil bleibt: ohne diesen
 * Eintrag wuerde der naechste Durchlauf dasselbe Ticket wieder an seine Rolle
 * geben und die Zustellpolitik muesste die Versuche erneut abzaehlen.
 */
const HUMAN_ONLY_STALLS: ReadonlySet<TicketStall['kind']> = new Set([
  'awaiting_approval',
  'budget',
  'escalated',
  /**
   * Ein Agent hat im Ticket selbst eine Frage gestellt, und der Host haelt es
   * an, bis ein Mensch sie beantwortet.
   *
   * Ohne diesen Eintrag weckt die Wiedervorlage weiter die zustaendige Rolle:
   * fuenf Versuche an einem Ticket, das per Konstruktion nicht weiterlaeuft,
   * danach eine Eskalation, die die eigentliche Frage verdeckt. Der Agent hat
   * nach einer Produktentscheidung gefragt — daran aendert ein sechster
   * Weckruf nichts.
   */
  'awaiting_decision',
]);

function agentOfRole(agents: readonly ScrumAgent[], role: AgentRole): ScrumAgent | null {
  return agents.find((agent) => agent.role === role) ?? null;
}

const DELIVERY_ROLES: ReadonlySet<string> = new Set<AgentRole>([
  'product_owner',
  'scrum_master',
  'technical_lead',
  'developer',
  'qa_engineer',
]);

/**
 * Die Rolle eines Agenten, sofern das Board sie kennt.
 *
 * `ScrumAgent.role` ist bewusst ein freier String — das Board spiegelt Agenten,
 * die der Host verwaltet, und der kennt auch Rollen ausserhalb dieses Teams.
 * Eine unbekannte Rolle darf keine Absicht bekommen: es gibt keine Regel, was
 * sie mit einem Ticket tun soll. Sie still als Entwickler zu behandeln waere
 * die Art von Vermutung, aus der die alten Fehlleitungen entstanden sind.
 */
function deliveryRole(agent: ScrumAgent): AgentRole | null {
  return DELIVERY_ROLES.has(agent.role) ? (agent.role as AgentRole) : null;
}

/**
 * Wie viele Tickets dieser Entwickler bereits traegt.
 *
 * `todo` zaehlt mit: ein zugewiesenes Ticket gehoert ihm schon, auch wenn er es
 * noch nicht angefasst hat. Ohne das wirkt er direkt nach einer Zuweisung
 * unveraendert frei und bekommt in derselben Runde das naechste obendrauf.
 */
function load(agent: ScrumAgent, tasks: readonly ScrumTask[]): number {
  return tasks.filter(
    (task) =>
      task.assignedAgentId === agent.id &&
      (task.column === 'todo' || task.column === 'in_progress' || task.column === 'in_review')
  ).length;
}

/**
 * Rechnet aus, was das Board jetzt tun will.
 *
 * Die Reihenfolge der Abschnitte ist die Reihenfolge der Dringlichkeit: was
 * feststeckt, geht vor dem, was schon laeuft, und das geht vor dem, was neu
 * angefangen wird. Innerhalb eines Abschnitts ist die Auswertung reihenfolge-
 * unabhaengig — jedes Ticket wird fuer sich beurteilt.
 */
export function planBoard(input: PlanInput): BoardIntent[] {
  const { state, liveRunTaskIds, refinementInFlight = false } = input;
  const intents: BoardIntent[] = [];
  const claimed = new Set<string>();

  const add = (
    task: ScrumTask,
    kind: BoardIntent['kind'],
    role: BoardIntent['role'],
    agentId: string | null,
    reason: string
  ) => {
    if (claimed.has(task.id)) return;
    claimed.add(task.id);
    intents.push({ key: intentKey(task.id, kind), taskId: task.id, kind, role, agentId, reason });
  };

  const tasks = state.tasks;
  const agents = state.agents;
  const technicalLead = agentOfRole(agents, 'technical_lead');
  const qaEngineer = agentOfRole(agents, 'qa_engineer');

  // Ein laufender Agent braucht keine Absicht — er arbeitet ja. Das gilt vor
  // allen Regeln, damit kein Durchlauf einen laufenden Lauf ueberholt.
  for (const taskId of liveRunTaskIds) claimed.add(taskId);

  // -- 1. Was ein Mensch aufloesen muss -------------------------------------
  //
  // Zuerst, weil eine wartende Freigabe jedes andere Urteil ueber dasselbe
  // Ticket entwertet: es bewegt sich nicht, und kein Weckruf aendert das.
  for (const stall of state.stalls ?? []) {
    if (!HUMAN_ONLY_STALLS.has(stall.kind)) continue;
    const task = tasks.find((entry) => entry.id === stall.taskId);
    if (!task) continue;
    add(task, 'await_human', 'human', null, stall.reason);
  }

  // -- 2. Blockierte Tickets ------------------------------------------------
  for (const task of tasks) {
    if (task.column !== 'blocked') continue;
    add(
      task,
      'unblock',
      'technical_lead',
      technicalLead?.id ?? null,
      'The ticket sits in Blocked and needs a decision on how to proceed.'
    );
  }

  // -- 3. Offene Reviews ----------------------------------------------------
  //
  // Kein WIP-Deckel: das Review-Limit begrenzt, wie viel *in* das Review darf,
  // nicht wie viel die QA daraus befreien darf. Andersherum haette ein volles
  // Review-Board sich selbst zugehalten.
  for (const task of tasks) {
    if (task.column !== 'in_review') continue;
    add(
      task,
      'review',
      'qa_engineer',
      qaEngineer?.id ?? null,
      'The ticket is in review and waits for a QA verdict.'
    );
  }

  // -- 4. Angefangene Arbeit ohne laufenden Agenten -------------------------
  //
  // `in_progress` ohne Lauf heisst: der Agent ist gestorben, oder er wurde nie
  // geweckt. Bisher brauchte es dafuer einen Stillstandsvermerk, einen
  // Wiederanlauf-Zaehler und eine Wartefrist. Zustandsgesteuert faellt es
  // einfach beim naechsten Durchlauf wieder an.
  for (const task of tasks) {
    if (task.column !== 'in_progress') continue;
    const assignee = agents.find((agent) => agent.id === task.assignedAgentId) ?? null;
    const role = assignee ? deliveryRole(assignee) : null;
    if (!assignee || !role) {
      add(task, 'assign', 'product_owner', null, 'The ticket is in progress without an assignee.');
      continue;
    }
    add(
      task,
      'implement',
      role,
      assignee.id,
      'The ticket is in progress but no agent run is active for it.'
    );
  }

  // -- 5. Zugewiesene Arbeit in TODO ----------------------------------------
  for (const task of tasks) {
    if (task.column !== 'todo' || task.assignedAgentId === null) continue;
    const assignee = agents.find((agent) => agent.id === task.assignedAgentId);
    const role = assignee ? deliveryRole(assignee) : null;
    if (!assignee || !role) continue;
    add(task, 'implement', role, assignee.id, 'The ticket is assigned and waits to start.');
  }

  // -- 6. Verfeinerung ------------------------------------------------------
  //
  // Ein unverfeinertes Ticket kann niemand einplanen: ohne Schaetzung und
  // Kriterien gibt es weder Kapazitaetsrechnung noch Abnahme.
  if (!refinementInFlight) {
    for (const task of tasks) {
      if (task.column !== 'backlog' || isReady(task)) continue;
      add(
        task,
        'refine',
        'technical_lead',
        technicalLead?.id ?? null,
        'The ticket has no estimate or acceptance criteria yet.'
      );
    }
  }

  // -- 7. Neue Arbeit einplanen ---------------------------------------------
  //
  // Erst hier greift die Kapazitaet: was schon laeuft, soll fertig werden,
  // bevor Neues angefangen wird.
  intents.push(...planNewWork(state, claimed));

  return intents;
}

/**
 * Weist sprintreife Tickets zu, solange Kapazitaet frei ist.
 *
 * Herrenlose TODO-Tickets zuerst: ein Ticket in TODO ohne Bearbeiter wartet auf
 * niemanden. Es faellt aus jeder Zustaendigkeit heraus und hat das Board zuletzt
 * dauerhaft angehalten — die Planung sah ein besetztes TODO und hoerte auf,
 * waehrend das Ticket selbst nie einen Bearbeiter bekam.
 */
function planNewWork(state: WorkerState, claimed: ReadonlySet<string>): BoardIntent[] {
  const { tasks, agents, settings } = state;

  const developers = agents.filter((agent) => agent.role === 'developer');
  if (developers.length === 0) return [];

  const todoCount = tasks.filter((task) => task.column === 'todo').length;
  const todoSlots = Math.max(0, settings.wipLimits.todo - todoCount);

  // Freie Plaetze je Entwickler, als flache Liste — so entscheidet `pickAssignee`
  // ueber tatsaechlich verfuegbare Kapazitaet statt ueber Koepfe.
  const free = developers.flatMap((developer) => {
    const slots = Math.max(0, settings.wipLimits.development - load(developer, tasks));
    return Array.from({ length: slots }, () => developer);
  });
  if (free.length === 0) return [];

  const orphaned = tasks.filter(
    (task) => task.column === 'todo' && task.assignedAgentId === null && !claimed.has(task.id)
  );
  const ready = tasks
    .filter(
      (task) =>
        task.column === 'backlog' &&
        isReady(task) &&
        !claimed.has(task.id) &&
        // Ein Ticket, das auf ein anderes wartet, ist kein Stillstand, sondern
        // die Lieferreihenfolge. Es wird eingeplant, sobald sein Blocker faellt.
        !isBlockedByDependency(task, state)
    )
    .sort((a, b) => b.storyPoints - a.storyPoints);

  // Herrenlose Tickets belegen keinen neuen TODO-Platz — sie liegen schon dort.
  const candidates = [...orphaned, ...ready.slice(0, todoSlots)];

  const remaining = [...free];
  const intents: BoardIntent[] = [];
  for (const task of candidates) {
    if (remaining.length === 0) break;
    const developer = pickAssignee(task, remaining, state)?.agent ?? remaining[0];
    remaining.splice(remaining.indexOf(developer), 1);

    intents.push({
      key: intentKey(task.id, 'assign'),
      taskId: task.id,
      kind: 'assign',
      role: 'developer',
      agentId: developer.id,
      reason:
        task.column === 'todo'
          ? 'The ticket waits in TODO without an assignee.'
          : 'The ticket is ready for the sprint and development capacity is free.',
    });
  }

  return intents;
}
