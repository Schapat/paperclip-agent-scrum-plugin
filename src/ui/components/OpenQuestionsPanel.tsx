/**
 * Die offenen Rueckfragen des Teams — an einer Stelle, oben auf der Boardseite.
 *
 * Ein Agent, der im Ticket nach einer Entscheidung fragt, haelt damit das
 * Ticket an. Das Board wusste das bisher auch, sagte aber nur *dass* etwas
 * wartet: die Frage selbst stand im Ticket, und wer sie beantworten wollte,
 * musste sie erst finden. Bei einer Lieferkette aus vier Stories ist das die
 * Stelle, an der ein Sprint stehen bleibt, ohne dass es jemand merkt.
 *
 * Hier steht die Frage im Klartext, mit dem Ticket, aus dem sie stammt, und
 * einem Antwortfeld daneben. Die Boardseite muss dafuer nicht verlassen werden.
 */

import React, { useState } from "react";
import type { OpenTicketQuestion } from "../../core/types";

export interface OpenQuestionsPanelProps {
  questions: OpenTicketQuestion[];
  /**
   * Beantwortet eine Frage.
   *
   * `answer` ist Freitext: die Plugin-Bruecke kann eine Auswahl nicht
   * strukturiert zurueckgeben, sie kennt Zustimmung, Ablehnung und eine
   * Begruendung. Der Text landet als Kommentar im Ticket — also genau dort, wo
   * der Agent seinen naechsten Lauf beginnt.
   */
  onAnswer: (
    taskId: string,
    action: "accept" | "reject",
    answer: string
  ) => Promise<string | null>;
  /** Fehlt die Freigabe, wird die Frage gezeigt, aber nicht beantwortbar. */
  readOnly?: boolean;
}

function since(iso: string): string | null {
  const asked = Date.parse(iso);
  if (!Number.isFinite(asked)) return null;

  const minutes = Math.floor((Date.now() - asked) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `seit ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `seit ${hours} h`;
  return `seit ${Math.floor(hours / 24)} d`;
}

function QuestionCard({
  question,
  onAnswer,
  readOnly,
}: {
  question: OpenTicketQuestion;
  onAnswer: OpenQuestionsPanelProps["onAnswer"];
  readOnly: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (action: "accept" | "reject") => {
    // Eine Zustimmung ohne Inhalt ist bei einer offenen Frage keine Antwort:
    // "Welches Spiel?" laesst sich nicht mit OK beantworten.
    if (action === "accept" && !answer.trim()) {
      setError("Bitte schreib eine Antwort — der Agent liest sie im Ticket.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Die Meldung des Workers wird durchgereicht, nicht ersetzt: sie nennt
      // den Grund — etwa eine fehlende Freigabe — und ein allgemeines
      // "hat nicht geklappt" haette genau den verschluckt.
      setError(await onAnswer(question.taskId, action, answer.trim()));
    } finally {
      setBusy(false);
    }
  };

  const waited = since(question.askedAt);
  const label = question.identifier ? `${question.identifier} — ${question.taskTitle}` : question.taskTitle;

  return (
    <li className="open-question">
      <div className="open-question-head">
        <span className="open-question-ticket">{label}</span>
        {waited && <span className="open-question-age">{waited}</span>}
      </div>

      {question.title && <p className="open-question-title">{question.title}</p>}
      {question.summary && <p className="open-question-summary">{question.summary}</p>}

      {question.options.length > 0 && (
        <ul className="open-question-options">
          {question.options.map((option, index) => (
            <li key={`${question.interactionId}-${index}`}>{option}</li>
          ))}
        </ul>
      )}

      {readOnly ? (
        <p className="open-question-readonly">
          Antworten vom Board ist nicht freigegeben. Erteile dem Plugin in seinen
          Einstellungen die Berechtigung <code>issue.interactions.respond</code> — bis dahin
          entscheidest du im Ticket selbst.
        </p>
      ) : (
        <>
          <textarea
            className="open-question-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Deine Antwort — sie wird als Kommentar ins Ticket gestellt und weckt den zuständigen Agenten."
            rows={3}
            disabled={busy}
          />
          <div className="open-question-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => submit("accept")}>
              {busy ? "Wird gesendet…" : "Antworten und fortsetzen"}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => submit("reject")}>
              Ablehnen
            </button>
          </div>
        </>
      )}

      {error && <p className="open-question-error">{error}</p>}
    </li>
  );
}

export function OpenQuestionsPanel({ questions, onAnswer, readOnly = false }: OpenQuestionsPanelProps) {
  // Kein leerer Rahmen: ohne offene Frage soll die Seite nicht so aussehen, als
  // fehle eine Eingabe.
  if (questions.length === 0) return null;

  return (
    <section className="open-questions" aria-label="Offene Rückfragen">
      <header className="open-questions-head">
        <h2 className="open-questions-title">
          {questions.length === 1
            ? "Eine Frage wartet auf dich"
            : `${questions.length} Fragen warten auf dich`}
        </h2>
        <p className="open-questions-hint">
          Das Team ist hier stehen geblieben. Beantworte die Frage, und die betroffenen Tickets
          laufen weiter.
        </p>
      </header>
      <ul className="open-questions-list">
        {questions.map((question) => (
          <QuestionCard
            key={question.interactionId || question.taskId}
            question={question}
            onAnswer={onAnswer}
            readOnly={readOnly}
          />
        ))}
      </ul>
    </section>
  );
}
