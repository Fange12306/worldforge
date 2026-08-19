import { useRef, useState } from "react";
import { CircleHelp, X, ArrowUp } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { UserQuestion, AskUserResult } from "@/lib/agent-loop";

type Props = {
  questions: UserQuestion[];
  onSubmit: (answers: AskUserResult[]) => void;
};

/**
 * Clarification panel — shown above the input box while the agent loop is
 * blocked on AskUserQuestion. Questions are presented one at a time; each one
 * offers the agent's options plus a final line where the user can type a
 * custom answer. Clicking an option (or submitting the custom answer) advances
 * to the next question, and onSubmit fires after the last one.
 */
export function AskUserQuestions({ questions, onSubmit }: Props) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [custom, setCustom] = useState("");
  const answersRef = useRef<AskUserResult[]>([]);
  const finishedRef = useRef(false);

  const total = questions.length;
  const question = questions[index];

  const finish = (answers: AskUserResult[]) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onSubmit(answers);
  };

  const submitAnswer = (answer: string, isCustom: boolean) => {
    answersRef.current.push({ answer, custom: isCustom, skipped: false });
    setCustom("");
    if (index + 1 < total) {
      setIndex(index + 1);
    } else {
      finish(answersRef.current);
    }
  };

  const skip = () => {
    answersRef.current.push({ answer: "", custom: false, skipped: true });
    setCustom("");
    if (index + 1 < total) {
      setIndex(index + 1);
    } else {
      finish(answersRef.current);
    }
  };

  // Cancel everything: mark every unanswered question as skipped and resolve.
  const cancelAll = () => {
    while (answersRef.current.length < total) {
      answersRef.current.push({ answer: "", custom: false, skipped: true });
    }
    finish(answersRef.current);
  };

  const submitCustom = () => {
    const value = custom.trim();
    if (value) submitAnswer(value, true);
  };

  const at = t.chat.askUser;

  return (
    <div className="animate-slide-up px-4 mb-2">
      <div className="max-w-3xl mx-auto bg-surface-800 rounded-2xl border border-surface-700/80 shadow-xl shadow-black/20 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-2.5 pb-2">
          <CircleHelp className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-[0.688rem] text-ink-secondary">{at.title}</span>
          <span className="ml-auto text-[0.688rem] text-ink-muted">
            {at.progress(index + 1, total)}
          </span>
          <button
            onClick={cancelAll}
            title={at.cancel}
            className="p-0.5 rounded text-ink-muted hover:text-ink hover:bg-surface-700 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Question body — keyed so each question animates in */}
        <div key={index} className="animate-fade-in px-4 pb-3">
          {question.header && (
            <div className="text-[0.688rem] font-medium text-brand-400 mb-1">{question.header}</div>
          )}
          <div className="text-sm text-ink leading-relaxed mb-2.5">{question.question}</div>

          {Array.isArray(question.options) && question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {question.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => submitAnswer(opt, false)}
                  className="px-3 py-1.5 text-[0.8125rem] rounded-lg bg-surface-700 text-ink-secondary hover:text-ink hover:bg-surface-600 border border-transparent hover:border-brand-500/40 transition-colors text-left max-w-full"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {/* Final line: custom answer */}
          <div className="flex items-center gap-1.5">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCustom();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  skip();
                }
              }}
              placeholder={at.customPlaceholder}
              className="flex-1 h-8 text-sm bg-surface-700 rounded-lg px-3 text-ink outline-none placeholder:text-ink-muted min-w-0"
            />
            <button
              onClick={submitCustom}
              disabled={!custom.trim()}
              className="flex-shrink-0 h-8 px-3 flex items-center gap-1 text-[0.688rem] rounded-lg bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40 transition-colors"
            >
              <ArrowUp className="w-3 h-3" />
              {at.submit}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[0.688rem] text-ink-muted">{at.hint}</span>
            <button
              onClick={skip}
              className="text-[0.688rem] text-ink-muted hover:text-ink transition-colors"
            >
              {at.skip}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
