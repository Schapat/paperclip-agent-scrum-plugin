/**
 * Tickets, die kein Backlog-Item sind.
 *
 * Ein Agent legt sich gelegentlich seinen eigenen Arbeitsauftrag als Ticket an
 * — "Product Owner Backlog Discovery: Tetris", "Watchdog: Board-Stau". Als
 * Child-Issue des Kickoffs landet das im Backlog und zaehlt als Story. Nur
 * verfeinern wird es nie jemand: es beschreibt keine Lieferung, sondern eine
 * Taetigkeit. Der Sprint blieb damit dauerhaft nicht startbar, weil die
 * Startbedingung *jedes* Ticket verfeinert sehen will.
 *
 * Erkannt wird bewusst eng und nur am Titel: eine Rolle oder der Watchdog am
 * Anfang, gefolgt von einer Taetigkeit aus dem Ablauf. Was nicht sicher als
 * Auftrag erkennbar ist, bleibt eine Story — lieber ein Arbeitsauftrag zu viel
 * im Backlog als eine echte Story, die aus der Planung faellt.
 */

/** Rollen und Rollenbezeichnungen, die einen Auftrag einleiten koennen. */
const ROLE_PREFIX = String.raw`(?:product\s*owner|technical\s*lead|scrum\s*master|qa(?:\s*engineer)?|developer(?:\s*\d+)?|watchdog|agent\s*scrum)`;

/** Taetigkeiten aus dem Ablauf — nichts davon ist eine Lieferung. */
const ACTIVITY = String.raw`(?:backlog\s*discovery|discovery|analysis|analyse|refinement|verfeinerung|review|retrospective|retrospektive|kickoff|handover|uebergabe|board[- ]?stau|report|bericht)`;

const WORK_ORDER = new RegExp(String.raw`^\s*${ROLE_PREFIX}\s*[:\-–—]?\s*(?:\w+\s+){0,2}${ACTIVITY}\b`, 'i');

/**
 * Ist dieses Ticket der Arbeitsauftrag eines Agenten statt einer Story?
 *
 * Nur der Titel entscheidet. Eine Beschreibung mit User Story hebt den Verdacht
 * wieder auf: wer eine Story schreibt, liefert etwas.
 */
export function isAgentWorkOrderTicket(ticket: {
  title: string;
  description?: string | null;
}): boolean {
  if (!WORK_ORDER.test(ticket.title)) return false;

  const description = ticket.description ?? '';
  const looksLikeStory =
    /##\s*user\s*story/i.test(description) ||
    /\bals\b[^\n]{0,60}\bm(?:ö|oe)chte ich\b/i.test(description) ||
    /\bas a\b[^\n]{0,60}\bi want\b/i.test(description);

  return !looksLikeStory;
}
