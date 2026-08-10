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
export const BOUNDED_PROCESS_EXECUTION_MARKER = '## Bounded process execution';
export const REPORTING_LINE_MARKER = '<!-- agent-scrum:reporting-line -->';
export const STRUCTURED_INPUT_MARKER = '## Structured Input';
export const PROJECT_REFINEMENT_RUN_MARKER = '## Batch project refinement v4';
export const WATCHDOG_PROTOCOL_MARKER = '## Watchdog protocol v1';
/**
 * Fruehere Schreibweise desselben Markers.
 *
 * Die ausgelieferten AGENTS.md tragen `scrum-team:reporting-line`, die Pruefung
 * suchte `agent-scrum:reporting-line`. Sie schlug damit immer fehl und hat bei
 * jeder Reconciliation einen zweiten Reporting-Line-Abschnitt angehaengt.
 */
export const LEGACY_REPORTING_LINE_MARKER = '<!-- scrum-team:reporting-line -->';

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

const BOUNDED_PROCESS_EXECUTION = `${BOUNDED_PROCESS_EXECUTION_MARKER}

Ein Agent-Run darf keine langlebigen Prozesse hinterlassen oder auf deren
manuellen Abbruch warten. Starte daher keinen Dev-Server, Watcher, Test-Watcher,
Log-Follow oder vergleichbaren Dauerprozess direkt innerhalb eines Runs.

- Verwende keine Hintergrund- oder Jobsteuerung wie \`&\`, \`$!\`, \`%1\`, \`jobs\`, \`nohup\`, \`disown\`, \`setsid\`, \`screen\` oder \`tmux\`. Auch \`sleep\` darf keinen Server nebenher betreiben oder ein Timeout nachbilden.
- Nutze für die Verifikation zuerst einmalige Befehle wie Tests, Lint, Build oder einen vorhandenen Smoke-Test.
- Ist ein Server-Smoketest zwingend nötig, darf er nur über einen Prozess-Supervisor laufen, der bei Ablauf einer festen Frist die gesamte Prozessgruppe terminiert und auf deren Ende wartet. Auf macOS ist \`timeout\` nicht standardmäßig verfügbar; setze seine Existenz nicht voraus.
- Gibt es keinen nachweislich begrenzten Testweg, dokumentiere diese Verifikationsgrenze im Ticket, statt \`npm run dev\`, \`next dev\`, \`vite\` oder einen anderen Dauerprozess zu starten.`;

/**
 * Der Tool-Weg je Rolle.
 *
 * Bewusst ohne "hat Vorrang"-Formel: das Tool ersetzt keine Regel, es ist der
 * verlaessliche Weg, dieselbe Information abzugeben. Wer weiterhin von Hand
 * schreibt, bleibt korrekt — nur fehleranfaelliger.
 */
const STRUCTURED_INPUT: Record<TeamAgentKey, string | null> = {
  'technical-lead': `${STRUCTURED_INPUT_MARKER}

Gib dein Refinement ueber ein strukturiertes Tool ab, nicht als handgeschriebenen Marker. Das Tool prueft Schaetzung und Akzeptanzkriterien sofort und meldet einen Fehler zurueck, statt ein Ticket stumm ungeplant liegen zu lassen.

- Fuer ein einzelnes Ticket verwende \`submit_refinement\` mit \`issueId\`, \`storyPoints\` (1–100) und mindestens einem \`acceptanceCriteria\`.
- Bei einem Abschnitt \`Vollstaendiger Refinement-Batch\` verwende exakt einmal \`submit_refinement_batch\`. Uebergib darin jede genannte \`issueId\` genau einmal; ein unvollstaendiger Batch wird abgelehnt.
- \`labels\` nennt die technischen Domaenen des Tickets; die Sprint-Planung waehlt darueber den passenden Developer.
- Der handgeschriebene Refinement-Marker aus dem Abschnitt oben bleibt gueltig, falls das Tool nicht verfuegbar ist.`,
  'qa-engineer': `${STRUCTURED_INPUT_MARKER}

Gib dein Review-Ergebnis ueber \`submit_qa_verdict\` ab. Liste jedes Akzeptanzkriterium einzeln mit seinem Ergebnis.

- Eine Freigabe mit einem offenen Kriterium wird abgelehnt — das ist Absicht: genau dieser Widerspruch wuerde das Ticket spaeter erneut aufmachen.
- Bei \`approved: false\` gehoert in \`notes\`, was konkret zu tun ist.
- Die handgeschriebene Checkliste mit dem QA-Freigabemarker bleibt gueltig, falls das Tool nicht verfuegbar ist.`,
  'developer-1': `${STRUCTURED_INPUT_MARKER}

**Uebergib ein fertiges Ticket ausschliesslich ueber \`submit_for_review\`.** Setze den Status nicht selbst: Ein agentengeschriebener Wechsel nach \`in_review\` wird vom Host abgelehnt, weil danach niemand die naechste Handlung besitzt. Baue dafuer auch keine eigene Confirmation — die wartet auf einen menschlichen Klick statt auf QA und legt das Ticket still.

\`submit_for_review\` erledigt Review-Kommentar, Commit-Nachweis, Statuswechsel, QA-Zuweisung und Weckruf in einem Aufruf. Uebergib \`commit\` gleich mit; ein Ticket ohne Nachweis faellt in der Done-Pruefung ohnehin zurueck. \`record_commit\` bleibt fuer einen nachgereichten Commit.

**Pruefe einmal, nicht fuenfmal.** Fuehre die im Ticket genannten Verify-Kommandos am Ende *einmal* aus und fange die Ausgabe vollstaendig ab (\`2>&1 | tail -40\`), statt denselben Lauf fuer Kopf und Ende zu wiederholen. Ein Lint- oder Build-Lauf kostet oft mehr Zeit als die Aenderung selbst.

**Bleib im Ticket-Scope.** Ein Fehler, der laut Zuweisungskommentar zu einem anderen Ticket gehoert, wird nicht hier behoben und nicht hier diskutiert — nenne ihn einmal im Review-Kommentar.`,
  'developer-2': `${STRUCTURED_INPUT_MARKER}

**Uebergib ein fertiges Ticket ausschliesslich ueber \`submit_for_review\`.** Setze den Status nicht selbst: Ein agentengeschriebener Wechsel nach \`in_review\` wird vom Host abgelehnt, weil danach niemand die naechste Handlung besitzt. Baue dafuer auch keine eigene Confirmation — die wartet auf einen menschlichen Klick statt auf QA und legt das Ticket still.

\`submit_for_review\` erledigt Review-Kommentar, Commit-Nachweis, Statuswechsel, QA-Zuweisung und Weckruf in einem Aufruf. Uebergib \`commit\` gleich mit; ein Ticket ohne Nachweis faellt in der Done-Pruefung ohnehin zurueck. \`record_commit\` bleibt fuer einen nachgereichten Commit.

**Pruefe einmal, nicht fuenfmal.** Fuehre die im Ticket genannten Verify-Kommandos am Ende *einmal* aus und fange die Ausgabe vollstaendig ab (\`2>&1 | tail -40\`), statt denselben Lauf fuer Kopf und Ende zu wiederholen. Ein Lint- oder Build-Lauf kostet oft mehr Zeit als die Aenderung selbst.

**Bleib im Ticket-Scope.** Ein Fehler, der laut Zuweisungskommentar zu einem anderen Ticket gehoert, wird nicht hier behoben und nicht hier diskutiert — nenne ihn einmal im Review-Kommentar.`,
  'product-owner': null,
  'scrum-master': null,
};

const PROJECT_REFINEMENT_RUN = `${PROJECT_REFINEMENT_RUN_MARKER}

Diese Regel hat Vorrang vor allen frueheren Issue-bound-Refinement-Regeln und vor einer allgemeinen Backlog-Pruefung: Bei einem direkt an dich zugewiesenen projektgebundenen Refinement kann der Host den Status vor dem Run auf \`todo\` oder \`in_progress\` setzen. Das ist keine Statusaenderung durch dich und kein Delivery-Auftrag.

- Bei einem Abschnitt \`Vollstaendiger Refinement-Batch\` schliesst du den gesamten Batch mit genau einem \`submit_refinement_batch\`-Aufruf ab. Kehre nicht nach dem Carrier-Ticket zurueck.
- Der Aufruf muss jede dort genannte \`issueId\` genau einmal mit Story Points und mindestens einem pruefbaren Akzeptanzkriterium enthalten. Lieferabhaengigkeiten verschieben keine technische Schaetzung.
- \`submit_refinement\` lehnt ein einzelnes Batch-Ticket ab; nutze in diesem Fall ausschliesslich \`submit_refinement_batch\`.
- Ohne Batch-Abschnitt verfeinerst du das direkt zugewiesene Ticket ueber \`submit_refinement\`.
- Aendere weder Status noch Zuweisung; der Plugin-Worker fuehrt gueltig verfeinerte Tickets anschliessend ins Backlog zurueck.
- Fuer andere, nicht im Batch genannte Tickets bleibt die Backlog-Pruefung unveraendert.`;

/**
 * Der Watchdog-Lauf als Auftrag statt als offenes Board.
 *
 * Ein Verbotssatz allein hat nicht gereicht: der zeitgesteuerte Lauf hat sich
 * ein Ticket gegriffen, es implementiert und auf `done` gesetzt. Ein Agent, der
 * alle 30 Minuten garantiert startet und nichts zugewiesen bekommt, braucht
 * eine Aufgabe mit Anfang und Ende — sonst sucht er sich eine.
 */
const WATCHDOG_PROTOCOL = `${WATCHDOG_PROTOCOL_MARKER}

Diese Regel hat Vorrang vor allen frueheren Anweisungen zu Timer-Laeufen und Board-Pruefungen.

Ein zeitgesteuerter Lauf besteht aus genau drei Schritten:

1. Rufe \`get_watchdog_agenda\` auf. Die Agenda ist dein vollstaendiger Auftrag — was nicht darin steht, ist nicht deine Aufgabe.
2. Ist die Agenda leer: rufe \`submit_watchdog_report\` mit \`clear: true\` auf und beende den Lauf. Suche keine Ersatzarbeit.
3. Andernfalls lies die genannten Tickets und rufe \`submit_watchdog_report\` genau einmal auf — ein Befund je Agenda-Punkt, jeder mit einem Satz, was zu tun ist und von wem.

Verbindliche Grenzen fuer jeden Lauf:

- Du aenderst an keinem Ticket Status oder Zuweisung. Ein solcher Wechsel wird vom Board zurueckgenommen, und dein Lauf war umsonst.
- Du implementierst nichts, checkst nichts aus und schreibst keinen Code — auch nicht "schnell", auch nicht, wenn ein Ticket fertig verfeinert dasteht und niemand daran arbeitet.
- Das Wecken der zustaendigen Rolle uebernimmt das Board aus deinem Bericht. Du benennst, wer dran ist; du uebernimmst nicht.
- Nach \`submit_watchdog_report\` ist der Lauf zu Ende.`;

const FEATURE_BRANCH_DELIVERY = `${FEATURE_BRANCH_DELIVERY_MARKER}

Diese Regel hat Vorrang vor frueheren Anweisungen zu Ticket-Branches oder Ticket-Pull-Requests. Ein Ticket ist eine Liefertranche innerhalb eines Features, keine Pull-Request-Einheit.

- Arbeite auf dem vorgegebenen Feature-Branch des zugehoerigen Features und pushe die Ticket-Commits dorthin. Erstelle keinen Pull Request pro Ticket.
- Der Ready-for-Review-Kommentar eines Tickets nennt den Feature-Branch und nur die Commits dieses Tickets; ein PR-Link gehoert dort nicht hinein.
- QA schliesst ein Ticket erst nach der vollstaendigen Einzelpruefung seiner Akzeptanzkriterien ab. Das Done eines einzelnen Tickets erstellt, merged oder genehmigt keinen Pull Request.
- Erst wenn alle Tickets eines Features durch QA abgeschlossen und ihre Commits auf dem Feature-Branch liegen, erstellt der fuer den Feature-Branch verantwortliche Developer genau einen Pull Request fuer das gesamte Feature.`;

export const REPORTING_LINE_INSTRUCTIONS: Record<TeamAgentKey, string> = {
  'product-owner': `${REPORTING_LINE_MARKER}

## Reporting Line

Wenn ein Company Lead (CEO) existiert, berichtest du direkt an diese Rolle. Du verantwortest Produktvision, Backlog und Priorisierung, bist jedoch keine technische oder disziplinarische Vorgesetztenrolle fuer die anderen Scrum-Rollen.`,
  'scrum-master': `${REPORTING_LINE_MARKER}

## Reporting Line

Wenn ein Company Lead (CEO) existiert, berichtest du direkt an diese Rolle. Du steuerst Prozess und Flow als unabhaengiger Facilitator; du uebernimmst keine Vorgesetztenrolle fuer Product Owner, Technical Lead, QA oder Developers.`,
  'technical-lead': `${REPORTING_LINE_MARKER}

## Reporting Line

Wenn ein Company Lead (CEO) existiert, berichtest du direkt an diese Rolle. Developer 1 und Developer 2 berichten fuer technische Anleitung, Architektur und Eskalationen an dich. Product Owner, Scrum Master und QA bleiben deine fachlichen Peers.`,
  'qa-engineer': `${REPORTING_LINE_MARKER}

## Reporting Line

Wenn ein Company Lead (CEO) existiert, berichtest du direkt an diese Rolle. Deine QA- und Done-Entscheidungen bleiben unabhaengig von Produktpriorisierung, Prozesssteuerung und Delivery-Druck.`,
  'developer-1': `${REPORTING_LINE_MARKER}

## Reporting Line

Du berichtest fuer technische Anleitung, Architektur und technische Eskalationen an den Technical Lead. Product Owner, Scrum Master und QA sind fachliche Partner mit eigenen Entscheidungsrechten, keine direkten Vorgesetzten.`,
  'developer-2': `${REPORTING_LINE_MARKER}

## Reporting Line

Du berichtest fuer technische Anleitung, Architektur und technische Eskalationen an den Technical Lead. Product Owner, Scrum Master und QA sind fachliche Partner mit eigenen Entscheidungsrechten, keine direkten Vorgesetzten.`,
};

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

/**
 * Entfernt Bloecke, die eine frueher fehlerhafte Marker-Pruefung angehaengt hat.
 *
 * Die Pruefung suchte `agent-scrum:reporting-line`, die ausgelieferten Bundles
 * tragen `scrum-team:reporting-line`. Sie schlug damit bei *jeder*
 * Reconciliation fehl und hat den Abschnitt erneut angehaengt — das Ergebnis
 * waren zwei konkurrierende Reporting-Line-Abschnitte je Agent, bei Developern
 * zusaetzlich zwei Fassungen derselben Commit-Nachweis-Pflicht.
 *
 * Entfernt wird ausschliesslich der exakte, vom Plugin erzeugte Text. Eigene
 * Anpassungen eines Betreibers bleiben unberuehrt.
 */
export function repairInstructionBundle(agentKey: TeamAgentKey, bundle: string): string {
  let repaired = bundle;

  const appendedReportingLine = REPORTING_LINE_INSTRUCTIONS[agentKey];
  // Nur der Legacy-Marker beweist eine *ausgelieferte* Reporting-Line. Auf die
  // Ueberschrift zu pruefen wuerde auch den selbst angehaengten Block treffen —
  // die Reparatur nimmt dann zurueck, was die Ergaenzung zurecht gesetzt hat.
  const hasShippedReportingLine = repaired.includes(LEGACY_REPORTING_LINE_MARKER);
  if (hasShippedReportingLine && repaired.includes(appendedReportingLine)) {
    repaired = removeBlock(repaired, appendedReportingLine);
  }

  const isDeveloper = agentKey === 'developer-1' || agentKey === 'developer-2';
  const commitMentions = repaired.match(/agent-scrum:commit:v1/g)?.length ?? 0;
  if (isDeveloper && commitMentions > 1 && repaired.includes(GITHUB_COMMIT_EVIDENCE)) {
    repaired = removeBlock(repaired, GITHUB_COMMIT_EVIDENCE);
  }

  return repaired;
}

/** Schneidet einen Block samt seiner umgebenden Leerzeilen heraus. */
function removeBlock(bundle: string, block: string): string {
  return bundle.replace(block, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Keeps existing customized instructions intact while adding the activation rule once. */
export function heartbeatAwareInstructions(agentKey: TeamAgentKey, existing: string | null): string {
  const source = !existing || !existing.trim()
    ? MANAGED_AGENT_INSTRUCTIONS[agentKey]
    : repairInstructionBundle(agentKey, existing);
  const hasReportingLine =
    source.includes(REPORTING_LINE_MARKER) ||
    source.includes(LEGACY_REPORTING_LINE_MARKER) ||
    /^##\s+Reporting[- ]line\s*$/im.test(source);
  const withReportingLine = hasReportingLine
    ? source
    : `${source.trimEnd()}\n\n${REPORTING_LINE_INSTRUCTIONS[agentKey]}\n`;
  const withEventRouting = withReportingLine.includes(EVENT_ROUTING_MARKER)
    ? withReportingLine
    : `${withReportingLine.trimEnd()}\n\n${EVENT_ROUTING_INSTRUCTIONS[agentKey]}\n`;

  const withScopeGuard = withEventRouting.includes(HUMAN_SCOPE_GUARD_MARKER)
    ? withEventRouting
    : `${withEventRouting.trimEnd()}\n\n${HUMAN_SCOPE_GUARD}\n`;
  const withSprintAutonomy = withScopeGuard.includes(SPRINT_AUTONOMY_MARKER)
    ? withScopeGuard
    : `${withScopeGuard.trimEnd()}\n\n${SPRINT_AUTONOMY}\n`;

  const withBoundedProcessExecution = withSprintAutonomy.includes(BOUNDED_PROCESS_EXECUTION_MARKER)
    ? withSprintAutonomy
    : `${withSprintAutonomy.trimEnd()}\n\n${BOUNDED_PROCESS_EXECUTION}\n`;

  // Die ausgelieferten Developer-Bundles fuehren dieselbe Regel bereits als
  // "### GitHub Commit-Nachweis". Nur den Marker zu pruefen haengt sie ein
  // zweites Mal an — mit abweichendem Wortlaut zur selben Pflicht.
  const hasCommitEvidence =
    withBoundedProcessExecution.includes(GITHUB_COMMIT_EVIDENCE_MARKER) ||
    withBoundedProcessExecution.includes('agent-scrum:commit:v1');
  const withCommitEvidence =
    (agentKey === 'developer-1' || agentKey === 'developer-2') && !hasCommitEvidence
      ? `${withBoundedProcessExecution.trimEnd()}\n\n${GITHUB_COMMIT_EVIDENCE}\n`
      : withBoundedProcessExecution;

  const withFeatureBranchDelivery =
    (agentKey === 'developer-1' || agentKey === 'developer-2' || agentKey === 'qa-engineer') &&
    !withCommitEvidence.includes(FEATURE_BRANCH_DELIVERY_MARKER)
      ? `${withCommitEvidence.trimEnd()}\n\n${FEATURE_BRANCH_DELIVERY}\n`
      : withCommitEvidence;

  const structuredInput = STRUCTURED_INPUT[agentKey];
  const withStructuredInput =
    structuredInput && !withFeatureBranchDelivery.includes(STRUCTURED_INPUT_MARKER)
      ? `${withFeatureBranchDelivery.trimEnd()}\n\n${structuredInput}\n`
      : withFeatureBranchDelivery;

  const withProjectRefinementRun =
    agentKey === 'technical-lead' && !withStructuredInput.includes(PROJECT_REFINEMENT_RUN_MARKER)
      ? `${withStructuredInput.trimEnd()}\n\n${PROJECT_REFINEMENT_RUN}\n`
      : withStructuredInput;

  // Der Watchdog ist die einzige Rolle mit Timer — und damit die einzige, die
  // ohne Auftrag startet.
  const withWatchdogProtocol =
    agentKey === 'scrum-master' && !withProjectRefinementRun.includes(WATCHDOG_PROTOCOL_MARKER)
      ? `${withProjectRefinementRun.trimEnd()}\n\n${WATCHDOG_PROTOCOL}\n`
      : withProjectRefinementRun;

  if (agentKey !== 'qa-engineer' || withWatchdogProtocol.includes(QA_REWORK_HANDOFF_MARKER)) {
    return withWatchdogProtocol;
  }
  return `${withWatchdogProtocol.trimEnd()}\n\n${QA_REWORK_HANDOFF}\n`;
}