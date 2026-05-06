import { useEffect, useRef } from "react";
import { CheckCircle, XCircle, Info, Trash2 } from "lucide-react";
import { LogEntry } from "../types";

interface Props { logs: LogEntry[]; onClear: () => void; }

const icons = {
  ok:   <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />,
  err:  <XCircle     className="w-3.5 h-3.5 text-red-500   shrink-0 mt-px" />,
  info: <Info        className="w-3.5 h-3.5 text-t-ink4    shrink-0 mt-px" />,
};

const colors = {
  ok:   "text-green-500",
  err:  "text-red-500",
  info: "text-t-ink3",
};

export default function LogPanel({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  return (
    <div className="h-[140px] bg-t-panel overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-t-line">
        <span className="text-[11px] font-semibold text-t-ink4 uppercase tracking-widest">Log</span>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-t-ink5 hover:text-t-ink3 transition-colors text-[11px]"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1 log-selectable font-mono">
        {logs.length === 0 && (
          <p className="text-t-ink5 text-xs text-center mt-4">No events yet</p>
        )}
        {logs.map(entry => (
          <div key={entry.id} className="flex items-start gap-2 text-xs leading-5">
            <span className="text-t-ink5 shrink-0">{entry.ts}</span>
            {icons[entry.kind]}
            <span className={colors[entry.kind]}>{entry.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
