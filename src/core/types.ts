/**
 * Shared Types für das Autonomous Scrum Team Plugin
 *
 * Zentrale Type-Definitionen für Worker, UI und Hooks.
 */

// =============================================================================
// Status & Column Types
// =============================================================================

/**
 * Mögliche Task-Status (entspricht Kanban-Spalten)
 */
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';

/**
 * Sprint-Status
 */
export type SprintStatus = 'planned' | 'active' | 'completed' | 'cancelled';

/**
 * Ticket-Typ gemäß Spec §3 (Backlog-Inhalte).
 *
 * Epics sind die gröbste Ebene, `task` entsteht beim Refinement, wenn der
 * Technical Lead ein Feature/eine Story in Subtasks zerlegt.
 */
export type TicketType = 'epic' | 'story' | 'feature' | 'bug' | 'improvement' | 'task';

// =============================================================================
// Core Domain Types
// =============================================================================

/**
 * Akzeptanzkriterium eines Tickets.
 *
 * Wird vom Product Owner grob und vom Technical Lead technisch ergänzt;
 * die QA hakt beim Review jedes Kriterium einzeln ab (Spec §3 Review).
 */
export interface AcceptanceCriterion {
  id: string;
  /** Kriterium in "Given/When/Then" oder Prosa */
  text: string;
  /** Von der QA im Review geprüft */
  met: boolean;
  /** Wer das Kriterium ergänzt hat */
  addedBy: string | null;
  /** Wer es zuletzt geprüft hat */
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/**
 * Kommentar an einem Ticket.
 *
 * Trägt die gesamte Agentenkommunikation (Spec §6) — jede Nachricht zwischen
 * zwei Agents landet als Kommentar im Ticketverlauf und ist damit im Board
 * nachvollziehbar.
 */
export interface TicketComment {
  id: string;
  taskId: string;
  authorId: string | null;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
  /** Gesetzt, wenn der Kommentar aus einer Agent-zu-Agent-Nachricht entstand */
  messageId?: string | null;
}

/** A developer-recorded Git commit that provides delivery evidence for a ticket. */
export interface TicketCommit {
  id: string;
  sha: string;
  url: string | null;
  message: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

/**
 * Protokollierte Agentenentscheidung (Spec §5: "Agentenentscheidungen nachvollziehen").
 *
 * Anders als ein Kommentar hält eine Decision *warum* etwas passiert ist —
 * die Begründung ist Pflicht, damit der Verlauf auditierbar bleibt.
 */
export interface AgentDecision {
  id: string;
  taskId: string | null;
  type: DecisionType;
  /** Was entschieden wurde */
  description: string;
  /** Warum es so entschieden wurde — Pflichtfeld */
  reasoning: string;
  madeById: string | null;
  madeByName: string;
  madeByRole: string;
  timestamp: string;
  relatedTaskIds: string[];
}

export type DecisionType =
  | 'auto_assign'
  | 'status_change'
  | 'priority_change'
  | 'estimation'
  | 'refinement'
  | 'review_passed'
  | 'review_rejected'
  | 'blocked'
  | 'unblocked'
  | 'ceremony';

/**
 * Beziehung zwischen zwei Tickets (Spec §5 "Verlinkte Tickets",
 * Spec §3 "Abhängigkeiten werden erkannt").
 */
export interface TicketLink {
  /** Ziel-Ticket */
  taskId: string;
  type: TicketLinkType;
  /** Optionale Begründung der Verlinkung */
  note?: string;
}

export type TicketLinkType =
  /** Dieses Ticket kann erst starten, wenn das Ziel fertig ist */
  | 'blocked_by'
  /** Dieses Ticket blockiert das Ziel */
  | 'blocks'
  /** Fachlich verwandt, keine harte Abhängigkeit */
  | 'relates_to'
  /** Dieses Ticket dupliziert das Ziel */
  | 'duplicates';

/**
 * Vom Technical Lead im Refinement erfasstes Risiko (Spec §3).
 */
export interface TicketRisk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  /** Wie das Risiko abgefedert wird */
  mitigation: string | null;
  raisedBy: string | null;
  raisedAt: string;
}

/**
 * Scrum Task / Issue
 */
export interface ScrumTask {
  id: string;
  /** Human-readable Paperclip identifier such as `TES-42`; local-only tasks have none. */
  identifier: string | null;
  title: string;
  description: string;
  /** Ticket-Typ (Spec §3): Epic, Story, Feature, Bug, Verbesserung, Task */
  type: TicketType;
  storyPoints: number;
  column: TaskStatus;
  assignedAgentId: string | null;
  sprintId: string | null;
  parentId: string | null;
  labels: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';

  // Refinement-Ergebnisse (Technical Lead, Spec §3)
  /** Akzeptanzkriterien — QA prüft diese beim Review */
  acceptanceCriteria: AcceptanceCriterion[];
  /** Technische Hinweise / Architekturnotizen aus dem Refinement */
  technicalNotes: string | null;
  /** Im Refinement erkannte Risiken */
  risks: TicketRisk[];
  /** Verlinkte Tickets inkl. Abhängigkeiten */
  links: TicketLink[];
  /** True, sobald der Technical Lead das Ticket verfeinert hat */
  refined: boolean;

  // Nachvollziehbarkeit (Spec §5, §6)
  /** Kommentare inkl. Agentenkommunikation */
  comments: TicketComment[];
  /** Verifizierbare Commit-Nachweise aus Developer-Kommentaren */
  commits: TicketCommit[];
  /** Protokollierte Agentenentscheidungen mit Begründung */
  decisions: AgentDecision[];

  // Timestamps für Metriken
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  // Cycle Time Tracking
  statusHistory: StatusHistoryEntry[];
}

/**
 * Felder, die beim Anlegen eines Tickets optional sind.
 *
 * Der Product Owner legt Tickets grob an; die Refinement-Felder füllt später
 * der Technical Lead. `createTask` setzt für alles Fehlende sichere Defaults.
 */
export type ScrumTaskInput = Pick<ScrumTask, 'title' | 'description'> &
  Partial<Omit<ScrumTask, 'title' | 'description'>>;

/**
 * Status-History Eintrag für Cycle Time Berechnung
 */
export interface StatusHistoryEntry {
  from: TaskStatus | null;
  to: TaskStatus;
  timestamp: string;
  triggeredBy: string | null;
}

/**
 * Scrum Sprint
 */
export interface ScrumSprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  taskIds: string[];
  goal: string | null;
  velocity: number;
  completedPoints: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Rollen des Scrum-Teams (Spec §1).
 */
export type AgentRole =
  | 'product_owner'
  | 'scrum_master'
  | 'technical_lead'
  | 'developer'
  | 'qa_engineer';

/**
 * KI Agent
 */
export interface ScrumAgent {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'working' | 'blocked';
  currentTaskId: string | null;
  capabilities: string[];
  /**
   * Skills gemäß Spec §1 — Grundlage für die skill-basierte Ticketzuweisung
   * des Product Owners (Spec §3 TODO-Spalte).
   */
  skills?: string[];
}

// =============================================================================
// Agentenkommunikation (Spec §6)
// =============================================================================

/**
 * Scrum-Zeremonien (Spec §2).
 */
export type CeremonyType =
  | 'sprint_planning'
  | 'backlog_refinement'
  | 'impediment_resolution'
  | 'sprint_review'
  | 'sprint_retrospective';

/**
 * Nachricht zwischen zwei Agents.
 *
 * Jede Nachricht wird protokolliert; bezieht sie sich auf ein Ticket, wird sie
 * zusätzlich als Kommentar in dessen Verlauf gespiegelt (Spec §6).
 */
export interface AgentMessage {
  id: string;
  /** Absender-Agent */
  fromAgentId: string | null;
  fromAgentName: string;
  fromAgentRole: string;
  /** Empfänger; `null` bedeutet Broadcast an das gesamte Team */
  toAgentIds: string[] | null;
  /** Ticket, auf das sich die Nachricht bezieht */
  taskId: string | null;
  /** Zeremonie, in deren Rahmen die Nachricht entstand */
  ceremony: CeremonyType | null;
  subject: string;
  body: string;
  timestamp: string;
}

/**
 * Ergebnis einer durchgeführten Zeremonie.
 *
 * Wird im State gehalten, damit Review und Retrospektive im Board
 * nachvollziehbar bleiben (Spec §2, §5).
 */
export interface CeremonyRecord {
  id: string;
  type: CeremonyType;
  sprintId: string | null;
  startedAt: string;
  /** Menschenlesbare Zusammenfassung des Ergebnisses */
  summary: string;
  /** Im Rahmen der Zeremonie erzeugte Nachrichten */
  messageIds: string[];
  /** Betroffene Tickets */
  taskIds: string[];
  /** Nur bei der Retrospektive gesetzt */
  retrospective?: RetrospectiveResult;
}

/**
 * Ergebnis der Sprint-Retrospektive (Spec §2).
 */
export interface RetrospectiveResult {
  /** Was lief gut */
  wentWell: string[];
  /** Erkannte Bottlenecks */
  bottlenecks: string[];
  /** Konkrete Verbesserungsvorschläge */
  improvements: string[];
  /** In dieser Retro gewonnene Learnings */
  learningIds: string[];
  /** Daraus angelegte oder aktivierte Skills */
  skillIds: string[];
  /** Vorgeschlagene neue Backlog-Items */
  proposedStories: ProposedStory[];
}

// =============================================================================
// Learnings & Skills
// =============================================================================

/**
 * Woraus ein Learning gewonnen wurde.
 *
 * Jede Quelle entspricht einem im Board messbaren Muster — das Learning ist
 * damit belegbar und nicht erfunden.
 */
export type LearningSource =
  /** Wiederholte Review-Rückweisungen aus demselben Grund */
  | 'review_rejection'
  /** Ein im Refinement erfasstes Risiko ist eingetreten */
  | 'materialized_risk'
  /** Tickets blieben ungewöhnlich lange in einer Spalte */
  | 'flow_bottleneck'
  /** Ein Ticket war blockiert */
  | 'blocker'
  /** Technische Hinweise aus abgeschlossenen Tickets */
  | 'technical_note';

export type LearningCategory = 'code' | 'architecture' | 'process' | 'domain' | 'tooling' | 'quality';

/**
 * Eine aus abgeschlossener Arbeit gewonnene Erkenntnis.
 *
 * Learnings sind der einzige Mechanismus, über den das Team mit der Zeit
 * *besser* wird statt nur mehr zu liefern. Sie entstehen in der Retrospektive
 * aus den erledigten Tickets eines Sprints.
 */
export interface Learning {
  id: string;
  /** Tickets, aus denen die Erkenntnis stammt */
  sourceTaskIds: string[];
  source: LearningSource;
  category: LearningCategory;
  /** Was gelernt wurde */
  insight: string;
  /** Beleg aus dem Board — macht das Learning nachprüfbar */
  evidence: string;
  /** Sprint, in dem es entstand */
  sprintId: string | null;
  /** Abgeleiteter Skill, falls daraus einer entstanden ist */
  skillId: string | null;
  createdAt: string;
}

/**
 * Eine Fähigkeit, die Agents bei ihrer Arbeit anwenden.
 *
 * Skills entstehen aus Learnings und werden den Rollen zugeordnet, für die sie
 * relevant sind. Ein aktivierter Skill fließt in die Instruktionen des Agents
 * ein; ein inaktiver wartet auf Bestätigung.
 */
export interface AgentSkill {
  id: string;
  name: string;
  /** Handlungsanweisung — das, was der Agent künftig anders macht */
  description: string;
  category: LearningCategory;
  /** Rollen, für die der Skill gilt */
  roles: string[];
  /** Aktiv = wird von den Agents angewendet */
  active: boolean;
  /** Learnings, aus denen der Skill entstand */
  learningIds: string[];
  /** Wie oft dasselbe Muster den Skill bestätigt hat */
  reinforcementCount: number;
  createdAt: string;
  activatedAt: string | null;
  /** Native Paperclip-Skill, der diesen lokalen Retrospektiv-Skill abbildet. */
  paperclipSkillId?: string;
  paperclipSkillKey?: string;
  /** Agents, denen der Worker den aktiven Skill bereits einmal zugeordnet hat. */
  paperclipAssignedAgentIds?: string[];
}

/**
 * Ein in Review oder Retro vorgeschlagenes Backlog-Item.
 *
 * Das Plugin formuliert die Story nicht aus — es benennt den Anlass und
 * überlässt die Ausarbeitung dem Product Owner (Agent).
 */
export interface ProposedStory {
  id: string;
  title: string;
  /** Warum dieses Item vorgeschlagen wird */
  rationale: string;
  suggestedType: TicketType;
  suggestedPriority: ScrumTask['priority'];
  /** Tickets, die den Vorschlag ausgelöst haben */
  sourceTaskIds: string[];
  /** Gesetzt, sobald daraus ein echtes Ticket wurde */
  createdTaskId: string | null;
  createdAt: string;
}

// =============================================================================
// Project Onboarding
// =============================================================================

/** Fortschritt eines vom Human gestarteten Projektauftrags. */
export type ProjectOnboardingStatus =
  | 'not_started'
  | 'analysis_in_progress'
  | 'analysis_ready'
  | 'backlog_in_progress'
  | 'sprint_planning'
  | 'active'
  | 'completed';

/** Agent-created work held because it is outside the human-approved project scope. */
export interface ProjectScopeHold {
  issueId: string;
  title: string;
  heldAt: string;
}

/**
 * Der kontrollierte Einstieg eines Teams in ein vorhandenes Paperclip-Projekt.
 *
 * Der Root-Issue ist das gemeinsame Arbeitsobjekt fur Human, Technical Lead
 * und Product Owner. Er tragt Projekt- und Workspace-Kontext; alle daraus
 * entstehenden Stories werden als Child-Issues angelegt.
 */
/** Wiederanlauf-Zaehler einer Refinement-Anforderung. */
export interface ProjectRefinementAttempt {
  taskId: string;
  attempts: number;
  lastRequestedAt: string;
}

export interface ProjectOnboarding {
  status: ProjectOnboardingStatus;
  projectId: string | null;
  projectName: string | null;
  rootIssueId: string | null;
  /** New projects capture whether a human-approved sprint is required before delivery. */
  requiresSprint: boolean;
  /** Child-Issues, fuer die der Technical Lead bereits ein Refinement angefordert bekam. */
  refinementRequestedTaskIds: string[];
  /**
   * Wie oft ein Refinement je Ticket angefordert wurde.
   *
   * Ohne Zaehler war die erste Anfrage zugleich die letzte: ein
   * fehlgeschlagener Lauf oder ein Kommentar ohne gueltigen Marker liess das
   * Ticket dauerhaft liegen.
   */
  refinementAttempts?: ProjectRefinementAttempt[];
  /** Ungebundene Agentenarbeit, die auf menschliche Scope-Freigabe wartet. */
  scopeHolds: ProjectScopeHold[];
  brief: string | null;
  constraints: string | null;
  startedAt: string | null;
  updatedAt: string;
}

// =============================================================================
// Worker State
// =============================================================================

/**
 * Kompletter Worker State
 */
export interface WorkerState {
  initialized: boolean;
  /**
   * Der explizite Startauftrag fur neue Organisationen.
   *
   * Optional bleibt das Feld nur fur gespeicherte Altstande und schlanke
   * Test-Fixtures; neue Worker-Zustande setzen es immer.
   */
  projectOnboarding?: ProjectOnboarding;
  currentSprint: ScrumSprint | null;
  tasks: ScrumTask[];
  agents: ScrumAgent[];
  settings: PluginSettings;
  metrics: SprintMetrics;
  /**
   * Gesamtes Agenten-Kommunikationsprotokoll (Spec §6).
   * Auf die jüngsten `MAX_MESSAGE_LOG` Einträge begrenzt.
   */
  messages: AgentMessage[];
  /** Durchgeführte Zeremonien inkl. Ergebnis (Spec §2) */
  ceremonies: CeremonyRecord[];
  /** Abgeschlossene Sprints — Grundlage für die Velocity-Berechnung */
  completedSprints: ScrumSprint[];
  /** Aus abgeschlossener Arbeit gewonnene Erkenntnisse */
  learnings: Learning[];
  /** Fähigkeiten, die die Agents anwenden */
  skills: AgentSkill[];
  /** Von Review/Retro vorgeschlagene Backlog-Items */
  proposedStories: ProposedStory[];
  /**
   * Basis-Instruktionen je Rolle, wie sie beim Onboarding geladen wurden.
   *
   * Grundlage, um die Instruktionen eines Agents jederzeit neu zu bauen: Basis
   * plus der aktuell aktiven Skills. Ohne die Basis ließe sich ein einmal
   * eingefügter Skill-Abschnitt nicht sauber ersetzen.
   */
  agentInstructions: Record<string, string>;
  /**
   * Der erste Timeout eines Tickets bekommt genau einen automatischen
   * Wiederanlauf. Das Budget bleibt ueber Worker-Neustarts erhalten, damit ein
   * wiederholt haengender Agent keine Endlosschleife ausloest.
   */
  timeoutRecoveries?: Record<string, TimeoutRecovery>;
  /**
   * Tickets, die nachweislich stehen.
   *
   * Ein Ticket steht nicht, weil es lange dauert, sondern weil etwas
   * Benennbares passiert ist: ein Agent-Run ist gescheitert, ein Weckruf wurde
   * nicht eingereiht, eine Freigabe wartet. Ohne diese Liste ist ein
   * abgestuerzter Run vom laufenden Run nicht zu unterscheiden.
   */
  stalls?: TicketStall[];
}

/** Persistierter Wiederanlauf nach einem nativen Adapter-Timeout. */
export interface TimeoutRecovery {
  sourceRunId: string;
  sourceRunCreatedAt: string;
  attemptedAt: string;
  queued: boolean;
  recoveryRunId: string | null;
}

/** Grund und Zeitpunkt, warum ein Ticket nicht weiterlaeuft. */
export interface TicketStall {
  taskId: string;
  reason: string;
  /** Kategorie fuer die Board-Darstellung. */
  kind:
    | 'run_failed'
    | 'run_stalled'
    | 'wakeup_failed'
    | 'awaiting_approval'
    | 'budget'
    | 'refinement_invalid';
  detectedAt: string;
  /** Gesetzt, sobald der Worker selbst einen Wiederanlauf versucht hat. */
  retriedAt?: string | null;
}

/**
 * Obergrenze für das Nachrichtenprotokoll.
 *
 * Das Protokoll wächst bei einem dauerhaft laufenden Team unbegrenzt; ohne
 * Deckel würde der persistierte State immer weiter anwachsen.
 */
export const MAX_MESSAGE_LOG = 500;

/**
 * Plugin-Einstellungen (Konfigurierbare Settings)
 *
 * Struktur gemäß Phase 3.3 Akzeptanzkriterien:
 * - Team-Größe (1-5 Developer)
 * - WIP-Limits pro Spalte
 * - Sprint-Länge (1-4 Wochen)
 * - Daily Scrum Zeit
 * - Event-Trigger aktivieren/deaktivieren
 */
export interface PluginSettings {
  // Legacy Settings (Kompatibilität)
  autoSaveEnabled: boolean;
  notificationsEnabled: boolean;
  defaultColumns: TaskStatus[];
  maxConcurrentAgents: number;

  // Phase 3.3: Neue konfigurierbare Einstellungen
  teamSize: TeamSizeConfig;
  wipLimits: WipLimitsConfig;
  sprint: SprintConfig;
  events: EventsConfig;
}

/**
 * Team-Größe Konfiguration
 */
export interface TeamSizeConfig {
  /** Anzahl Developer im Team (1-5), default: 2 */
  developerCount: number;
}

/**
 * WIP-Limits pro Spalte
 */
export interface WipLimitsConfig {
  /** WIP-Limit für Todo-Spalte, default: 10 */
  todo: number;
  /** WIP-Limit für Development/In Progress, default: 4 */
  development: number;
  /** WIP-Limit für Review-Spalte, default: 3 */
  review: number;
}

/**
 * Sprint-Konfiguration
 */
export interface SprintConfig {
  /** Sprint-Länge in Wochen (1-4), default: 2 */
  lengthWeeks: number;
}

/**
 * Event-Trigger Konfiguration
 *
 * Zeremonien werden ausschließlich durch den Board-Zustand ausgelöst, nicht
 * durch Uhrzeiten — Agents arbeiten schneller, als ein Zeitplan abbilden
 * könnte. Hier lässt sich nur steuern, *ob* ein Trigger greift.
 */
export interface EventsConfig {
  /** Sprint Planning automatisch auslösen, wenn TODO leerläuft, default: true */
  enableAutoPlanning: boolean;
  /** Backlog Refinement automatisch auslösen, default: true */
  enableAutoRefinement: boolean;
  /** Blocker auflösen und freie Kapazität belegen, default: true */
  enableAutoImpediments: boolean;
  /** Sprint Review und Retrospektive automatisch auslösen, default: true */
  enableAutoReview: boolean;
}

/**
 * Default-Werte für Plugin-Settings
 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  // Legacy
  autoSaveEnabled: true,
  notificationsEnabled: true,
  defaultColumns: ['backlog', 'todo', 'in_progress', 'in_review', 'done'],
  maxConcurrentAgents: 5,

  // Phase 3.3
  teamSize: {
    developerCount: 2,
  },
  wipLimits: {
    todo: 10,
    development: 4,
    review: 3,
  },
  sprint: {
    lengthWeeks: 2,
  },
  events: {
    enableAutoPlanning: true,
    enableAutoRefinement: true,
    enableAutoImpediments: true,
    enableAutoReview: true,
  },
};

/**
 * Erzeugt eine eigenständige Kopie der Default-Settings.
 *
 * `{ ...DEFAULT_PLUGIN_SETTINGS }` wäre eine flache Kopie: `events`,
 * `wipLimits`, `teamSize` und `sprint` zeigten weiterhin auf die Objekte der
 * Konstante. Eine Änderung am State würde dann den modulweiten Default
 * überschreiben und alle weiteren Boards vergiften.
 */
export function createDefaultSettings(): PluginSettings {
  return {
    ...DEFAULT_PLUGIN_SETTINGS,
    defaultColumns: [...DEFAULT_PLUGIN_SETTINGS.defaultColumns],
    teamSize: { ...DEFAULT_PLUGIN_SETTINGS.teamSize },
    wipLimits: { ...DEFAULT_PLUGIN_SETTINGS.wipLimits },
    sprint: { ...DEFAULT_PLUGIN_SETTINGS.sprint },
    events: { ...DEFAULT_PLUGIN_SETTINGS.events },
  };
}

/**
 * Sprint-Metriken
 */
export interface SprintMetrics {
  totalPoints: number;
  completedPoints: number;
  remainingPoints: number;
  averageCycleTime: number;
  velocity: number;
  burndownData: BurndownEntry[];
  changelog: ChangelogEntry[];
}

/**
 * Burndown Chart Eintrag
 */
export interface BurndownEntry {
  date: string;
  remainingPoints: number;
  idealRemaining: number;
}

/**
 * Changelog Eintrag
 */
export interface ChangelogEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  action: 'created' | 'completed' | 'moved' | 'updated' | 'blocked' | 'unblocked';
  description: string;
  timestamp: string;
  agentId: string | null;
}

// =============================================================================
// Plugin Context für Hooks
// =============================================================================

/**
 * Context der an Hooks übergeben wird
 */
export interface PluginContext {
  state: WorkerState;
  currentAgent: ScrumAgent | null;
  emit: (event: string, data: unknown) => void;
  updateState: (updates: Partial<WorkerState>) => void;
  saveState: () => Promise<void>;
}

/**
 * Lifecycle Hook Ergebnis
 */
export interface HookResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  data?: unknown;
}

// =============================================================================
// Message Types
// =============================================================================

/**
 * Plugin Message Types
 */
export interface PluginMessage {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * API Response Wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// =============================================================================
// Status Transition Types
// =============================================================================

/**
 * Definition einer erlaubten Status-Transition
 */
export interface StatusTransition {
  from: TaskStatus;
  to: TaskStatus;
  requiresReason: boolean;
  autoActions: AutoAction[];
}

/**
 * Automatische Aktion bei Transition
 */
export type AutoAction =
  | { type: 'set_timestamp'; field: 'startedAt' | 'completedAt' }
  | { type: 'update_metrics' }
  | { type: 'notify'; target: 'agent' | 'board' }
  | { type: 'update_parent' }
  | { type: 'log_changelog'; action: ChangelogEntry['action'] };
