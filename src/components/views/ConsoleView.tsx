import { useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Info, Trash2, Terminal, Search, X, Filter } from "lucide-react";
import { LogEntry } from "../../types";

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

type LevelFilter = "all" | LogEntry["kind"];

const ICONS = {
  ok:   <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-px" />,
  err:  <XCircle     className="w-3.5 h-3.5 text-red-500   shrink-0 mt-px" />,
  info: <Info        className="w-3.5 h-3.5 text-t-ink4    shrink-0 mt-px" />,
};

const COLORS = {
  ok:   "text-green-500",
  err:  "text-red-500",
  info: "text-t-ink3",
};

export default function ConsoleView({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [level,  setLevel]  = useState<LevelFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length, autoScroll]);

  const filtered = logs.filter(e => {
    if (level !== "all" && e.kind !== level) return false;
    if (search && !e.text.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    all:  logs.length,
    ok:   logs.filter(e => e.kind === "ok").length,
    info: logs.filter(e => e.kind === "info").length,
    err:  logs.filter(e => e.kind === "err").length,
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
        <span className="text-[13px] font-semibold text-t-ink">Logs</span>
        <span className="text-[11px] text-t-ink5 font-mono">{logs.length} event{logs.length !== 1 ? "s" : ""}</span>
        <button onClick={onClear}
          disabled={logs.length === 0}
          className="ml-auto shrink-0 flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:text-t-ink4 disabled:hover:bg-transparent">
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>

      {/* ─── FILTER BAR ─── */}
      <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-t-ink5 shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search logs…"
          className="flex-1 bg-transparent text-xs text-t-ink outline-none placeholder:text-t-ink5" />
        {search && (
          <button onClick={() => setSearch("")} className="text-t-ink5 hover:text-t-ink3 transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}

        {/* Level filter pills */}
        <div className="flex items-center gap-0.5 bg-t-card border border-t-line rounded-md p-0.5 ml-2">
          {(["all", "ok", "info", "err"] as const).map(l => (
            <button key={l} onClick={() => setLevel(l)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-all ${
                level === l ? "bg-t-panel text-t-ink shadow-sm" : "text-t-ink4 hover:text-t-ink2"
              }`}>
              {l === "all" ? "All" : l === "ok" ? "OK" : l === "err" ? "Err" : "Info"}
              {counts[l] > 0 && <span className="ml-1 text-t-ink5">{counts[l]}</span>}
            </button>
          ))}
        </div>

        <button
          onClick={() => setAutoScroll(a => !a)}
          className={`text-[11px] transition-colors px-1.5 py-0.5 rounded shrink-0 ${autoScroll ? "text-blue-500 bg-blue-500/10" : "text-t-ink5 hover:text-t-ink3"}`}
          title="Auto-scroll to newest"
        >
          {autoScroll ? "● auto" : "○ auto"}
        </button>
      </div>

      {/* ─── LOG LIST ─── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1 log-selectable font-mono">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-t-ink5">
            <Terminal className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-[13px]">No events yet</p>
            <p className="text-[11px] mt-1">Application logs will appear here</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-t-ink5">
            <Filter className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-[13px]">No logs match filter</p>
            <button onClick={() => { setSearch(""); setLevel("all"); }}
              className="text-[11px] text-blue-500 hover:text-blue-400 mt-1 transition-colors">Clear filters</button>
          </div>
        ) : (
          <>
            {filtered.map(entry => (
              <div key={entry.id} className="flex items-start gap-2 text-[11px] leading-5">
                <span className="text-t-ink5 shrink-0">{entry.ts}</span>
                {ICONS[entry.kind]}
                <span className={`${COLORS[entry.kind]} break-all`}>{entry.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
