// customer-ui/src/components/shell/TaskRow.tsx
import { Link } from "react-router-dom";
import { TONE_CLASS, glyphFor, toneForStage } from "../../lib/status";
import type { TaskView } from "../../lib/viewmodels/tasks";

/**
 * One row of the Home quarter checklist. Later steps are locked rather than
 * hidden, so the whole quarter stays visible; a completed step is struck
 * through. The glyph and its tone come from status.ts — never inline here.
 */
export function TaskRow({ task }: { task: TaskView }) {
  const tone = toneForStage(task.state);
  const completed = task.state === "complete";
  const locked = task.state === "pending" && !task.current;

  return (
    <li
      data-state={task.state}
      className={`flex items-center gap-3 border rounded-[var(--radius)] px-4 py-3 ${
        task.current ? "border-[var(--accent-border)]" : "border-[var(--border)]"
      } ${completed ? "bg-[var(--canvas)]" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`border rounded-[var(--radius-sm)] px-1.5 text-[12px] ${TONE_CLASS[tone]}`}
      >
        {glyphFor(task.state)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] ${completed ? "line-through text-[var(--ink-muted)]" : "font-medium"}`}>
          {task.index}. {task.title}
        </div>
        <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">
          {task.meta}
          {task.dueLabel ? ` · ${task.dueLabel}` : ""}
        </div>
      </div>
      {task.actionLabel ? (
        locked ? (
          <span className="text-[12px] text-[var(--ink-subtle)] border border-[var(--hairline)] rounded-[var(--radius)] px-3 py-1.5">
            Locked
          </span>
        ) : (
          <Link
            to={task.href}
            className={`text-[13px] font-medium rounded-[var(--radius)] px-3 py-1.5 ${
              task.current ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"
            }`}
          >
            {task.actionLabel}
          </Link>
        )
      ) : null}
    </li>
  );
}
