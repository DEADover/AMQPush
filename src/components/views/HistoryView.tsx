import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, Search, Trash2, Copy, RotateCcw, ChevronDown, ChevronRight, FileText, Tag, Clock, Hash } from "lucide-react";
import { HistoryEntry } from "../../types";

interface Props {
  connected: boolean;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onResend: (address: string, body: string) => void;
}

const INPUT = "bg-t-field border border-t-line2 rounded-md px-3 py-2 text-sm text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

function EntryCard({ entry, onResend, onLog }: { entry: HistoryEntry; onResend: (a: string, b: string) => void; onLog: (k: "info" | "ok" | "err", t: string) => void; }) {
  const [expanded, setExpanded] = useState(false);
  const hasProps = Object.keys(entry.properties).length > 0;

  return (
    <div className="border border-t-line rounded-lg overflow-hidden hover:border-t-line2 transition-colors">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-t-hover transition-colors">
        <span className="shrink-0 mt-0.5">
          {entry.is_file ? <FileText className="w-3.5 h-3.5 text-amber-500" /> : <Hash className="w-3.5 h-3.5 text-t-ink5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-mono text-blue-500 truncate">{entry.address}</span>
            {hasProps && <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-t-ink4"><Tag className="w-2.5 h-2.5" />{Object.keys(entry.properties).length}</span>}
          </div>
          <span className="text-sm text-t-ink2 font-mono truncate block">
            {entry.is_file ? `📎 ${entry.file_name ?? entry.body_preview}` : entry.body_preview}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-t-ink5 font-mono">{entry.timestamp}</span>
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-t-ink5" /> : <ChevronRight className="w-3.5 h-3.5 text-t-ink5" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-t-line p-4 space-y-3">
          <div className="flex items-center gap-4 text-[11px] text-t-ink4 font-mono">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{entry.timestamp}</span>
            <span className="text-blue-500">{entry.address}</span>
            <span className="ml-auto text-t-ink5 truncate max-w-[200px]">{entry.id}</span>
          </div>
          {!entry.is_file && (
            <pre className="text-xs text-t-ink2 font-mono bg-t-card rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {entry.body_full ?? entry.body_preview}
            </pre>
          )}
          {hasProps && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-t-ink5 font-medium">Properties</span>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(entry.properties).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 bg-t-hover rounded px-2 py-1 text-xs font-mono">
                    <span className="text-t-ink4">{k}</span>
                    <span className="text-t-ink3 truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!entry.is_file && (
              <button onClick={() => onResend(entry.address, entry.body_full ?? entry.body_preview)}
                className="flex items-center gap-1.5 text-xs text-t-ink3 hover:text-blue-500 transition-colors">
                <RotateCcw className="w-3 h-3" /> Resend
              </button>
            )}
            {!entry.is_file && (
              <button onClick={() => { navigator.clipboard.writeText(entry.body_full ?? entry.body_preview); onLog("info", "Copied"); }}
                className="flex items-center gap-1.5 text-xs text-t-ink4 hover:text-t-ink2 transition-colors">
                <Copy className="w-3 h-3" /> Copy
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryView({ onLog, onResend }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await invoke<HistoryEntry[]>("get_history")); }
    catch (e) { onLog("err", `History load failed: ${e}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  async function clearAll() {
    try { await invoke("clear_history"); setEntries([]); onLog("info", "History cleared"); }
    catch (e) { onLog("err", String(e)); }
  }

  const q = search.toLowerCase();
  const filtered = entries.filter(e =>
    !q || e.address.toLowerCase().includes(q) || e.body_preview.toLowerCase().includes(q) ||
    (e.file_name?.toLowerCase().includes(q) ?? false)
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3.5 border-b border-t-line flex items-center gap-3">
        <Search className="w-3.5 h-3.5 text-t-ink5 shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by address or body…" className={`${INPUT} flex-1 py-1.5`} />
        <button onClick={load} className="p-1.5 text-t-ink4 hover:text-t-ink2 transition-colors rounded" title="Refresh">
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-t-ink5">
            <History className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">{search ? "No matching entries" : "No sent messages yet"}</p>
            {!search && <p className="text-xs mt-1">Messages you send will appear here</p>}
          </div>
        ) : filtered.map(entry => (
          <EntryCard key={entry.id} entry={entry} onResend={onResend} onLog={onLog} />
        ))}
      </div>

      {entries.length > 0 && (
        <div className="px-5 py-3 border-t border-t-line flex items-center justify-between shrink-0">
          <span className="text-xs text-t-ink4">
            {filtered.length !== entries.length ? `${filtered.length} / ${entries.length} messages` : `${entries.length} message${entries.length !== 1 ? "s" : ""}`}
          </span>
          <button onClick={clearAll} className="flex items-center gap-1.5 text-xs text-t-ink4 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Clear all
          </button>
        </div>
      )}
    </div>
  );
}
