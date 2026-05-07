import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, Search, Trash2, Copy, RotateCcw, FileText, Tag, Clock, Hash, Download, Inbox, User, Layers, Mail } from "lucide-react";
import { HistoryEntry } from "../../types";

interface ResendArg { address: string; body?: string; fileName?: string; fileDataB64?: string; properties?: Record<string, string> }

interface Props {
  connected: boolean;
  refreshVersion?: number;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onResend: (entry: ResendArg) => void;
}

export default function HistoryView({ refreshVersion, onLog, onResend }: Props) {
  const [entries,    setEntries]    = useState<HistoryEntry[]>([]);
  const [search,     setSearch]     = useState("");
  const [loading,    setLoading]    = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await invoke<HistoryEntry[]>("get_history")); }
    catch (e) { onLog("err", `History load failed: ${e}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  // Auto-refresh when App signals a new send
  useEffect(() => {
    if (refreshVersion === undefined || refreshVersion === 0) return;
    load();
  }, [refreshVersion]);

  async function clearAll() {
    try { await invoke("clear_history"); setEntries([]); setSelectedId(null); onLog("info", "History cleared"); }
    catch (e) { onLog("err", String(e)); }
  }

  async function exportAs(format: "json" | "csv") {
    try {
      const path = await invoke<string>("export_history", { format });
      onLog("ok", `Exported → ${path}`);
    } catch (e) { onLog("err", `Export failed: ${e}`); }
  }

  const q = search.toLowerCase();
  const filtered = useMemo(
    () => entries.filter(e => {
      if (!q) return true;
      // Search across: id, profile, queue, body, file_name
      if (e.id.toLowerCase().includes(q)) return true;
      if (e.profile?.toLowerCase().includes(q)) return true;
      if (e.address.toLowerCase().includes(q)) return true;
      if (e.body_preview.toLowerCase().includes(q)) return true;
      if (e.body_full?.toLowerCase().includes(q)) return true;
      if (e.file_name?.toLowerCase().includes(q)) return true;
      return false;
    }),
    [entries, q]
  );

  // Auto-select first entry when list loads (or when current selection disappears)
  useEffect(() => {
    if (selectedId && filtered.some(e => e.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected = filtered.find(e => e.id === selectedId) ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
        <span className="text-[13px] font-semibold text-t-ink">History</span>
        <span className="text-[11px] text-t-ink5 font-mono">{entries.length} sent</span>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => exportAs("json")} disabled={entries.length === 0}
            className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors disabled:opacity-40 disabled:hover:text-t-ink4 disabled:hover:bg-transparent flex items-center gap-1">
            <Download className="w-3 h-3" /> JSON
          </button>
          <button onClick={() => exportAs("csv")} disabled={entries.length === 0}
            className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors disabled:opacity-40 disabled:hover:text-t-ink4 disabled:hover:bg-transparent flex items-center gap-1">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={clearAll} disabled={entries.length === 0}
            className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:text-t-ink4 disabled:hover:bg-transparent flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        </div>
      </div>

      {/* ─── FILTER BAR ─── */}
      <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-t-ink5 shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by ID, profile, queue, or body…"
          className="flex-1 bg-transparent text-xs text-t-ink outline-none placeholder:text-t-ink5" />
        {filtered.length !== entries.length && (
          <span className="text-[11px] text-t-ink4 shrink-0">{filtered.length} / {entries.length}</span>
        )}
        <button onClick={load} className="p-1 text-t-ink4 hover:text-t-ink2 transition-colors rounded" title="Refresh">
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ─── SPLIT BODY: list (left) + preview (right) ─── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ─── LIST ─── */}
        <div className="w-[40%] min-w-[280px] max-w-[480px] border-r border-t-line flex flex-col min-h-0 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-t-ink5">
              <History className="w-8 h-8 mb-3 opacity-40" />
              <p className="text-[13px]">{search ? "No matching entries" : "No sent messages yet"}</p>
              {!search && <p className="text-[11px] mt-1">Messages you send will appear here</p>}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {filtered.map(entry => (
                <ListItem key={entry.id} entry={entry}
                  selected={entry.id === selectedId}
                  onClick={() => setSelectedId(entry.id)} />
              ))}
            </div>
          )}
        </div>

        {/* ─── PREVIEW PANE ─── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
          {selected ? (
            <PreviewPane entry={selected} onResend={onResend} onLog={onLog} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-t-ink5">
              <Inbox className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-[13px]">Select a message to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List item — compact row in left pane ────────────────────────────────────

function ListItem({ entry, selected, onClick }: { entry: HistoryEntry; selected: boolean; onClick: () => void }) {
  const propCount = Object.keys(entry.properties).length;

  return (
    <button onClick={onClick}
      className={`w-full flex items-start gap-2 px-3 py-2 text-left border-b border-t-line/40 transition-colors ${
        selected ? "bg-blue-500/10" : "hover:bg-t-hover/60"
      }`}>
      <span className="shrink-0 mt-0.5">
        {entry.is_file
          ? <FileText className="w-3.5 h-3.5 text-amber-500" />
          : <Mail     className="w-3.5 h-3.5 text-t-ink4" />}
      </span>
      <div className="flex-1 min-w-0">
        {/* Row 1 — date / time (primary visual line) */}
        <div className="flex items-center gap-1 text-[11px] text-t-ink2 font-mono">
          <Clock className="w-2.5 h-2.5 text-t-ink4 shrink-0" />
          {entry.timestamp}
        </div>

        {/* Row 2 — full message ID */}
        <div className="text-[11px] font-mono text-t-ink truncate mt-0.5" title={entry.id}>
          {entry.id}
        </div>

        {/* Row 3 — profile · queue */}
        <div className="flex items-center gap-2 text-[10px] text-t-ink4 font-mono mt-1">
          {entry.profile && (
            <>
              <span className="flex items-center gap-0.5 truncate min-w-0" title={`Profile: ${entry.profile}`}>
                <User className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{entry.profile}</span>
              </span>
              <span className="text-t-ink5 shrink-0">·</span>
            </>
          )}
          <span className="flex items-center gap-0.5 text-blue-500 truncate min-w-0" title={`Queue: ${entry.address}`}>
            <Layers className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{entry.address}</span>
          </span>
        </div>

        {propCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[9px] text-t-ink4 mt-1">
            <Tag className="w-2.5 h-2.5" />{propCount} {propCount === 1 ? "prop" : "props"}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Preview pane — full details on the right ───────────────────────────────

function PreviewPane({ entry, onResend, onLog }: {
  entry: HistoryEntry;
  onResend: (a: ResendArg) => void;
  onLog: (k: "info" | "ok" | "err", t: string) => void;
}) {
  const hasProps = Object.keys(entry.properties).length > 0;

  // Pretty-format JSON body if applicable
  const bodyText = entry.body_full ?? entry.body_preview;
  const prettyBody = useMemo(() => {
    if (!bodyText || entry.is_file) return null;
    const trimmed = bodyText.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return JSON.stringify(JSON.parse(bodyText), null, 2); } catch { return null; }
    }
    return null;
  }, [bodyText, entry.is_file]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden select-text">
      {/* Preview header — title row */}
      <div className="shrink-0 px-4 py-2.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        {entry.is_file
          ? <FileText className="w-4 h-4 text-amber-500 shrink-0" />
          : <Hash className="w-4 h-4 text-t-ink4 shrink-0" />}
        <span className="text-[13px] font-mono text-blue-500 font-medium truncate">{entry.address}</span>
        <span className="ml-auto text-[11px] text-t-ink5 font-mono shrink-0 flex items-center gap-1">
          <Clock className="w-3 h-3" /> {entry.timestamp}
        </span>
      </div>

      {/* Action buttons */}
      <div className="shrink-0 px-4 py-2 border-b border-t-line flex items-center gap-2 bg-t-panel/60">
        {!entry.is_file ? (
          <>
            <button onClick={() => onResend({ address: entry.address, body: bodyText, properties: entry.properties })}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors flex items-center gap-1.5">
              <RotateCcw className="w-3 h-3" /> Resend
            </button>
            <button onClick={() => { navigator.clipboard.writeText(bodyText); onLog("info", "Body copied"); }}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-t-line text-t-ink3 hover:text-t-ink hover:bg-t-hover transition-colors flex items-center gap-1.5">
              <Copy className="w-3 h-3" /> Copy body
            </button>
          </>
        ) : entry.file_data_b64 ? (
          <button onClick={() => onResend({ address: entry.address, fileName: entry.file_name ?? "file", fileDataB64: entry.file_data_b64!, properties: entry.properties })}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Resend file
          </button>
        ) : (
          <span className="text-[11px] text-t-ink5 italic">file content not retained — too large or older entry</span>
        )}
      </div>

      {/* Scrollable detail body */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">

        {/* ─── METADATA — message header info ─── */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-t-ink5 font-semibold mb-1.5 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            Message
          </p>
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[11px] font-mono border border-t-line rounded-md p-2.5 bg-t-card/40">
            <span className="text-t-ink4 flex items-center gap-1"><Hash className="w-2.5 h-2.5" /> ID</span>
            <span className="text-t-ink2 break-all">{entry.id}</span>

            <span className="text-t-ink4 flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Time</span>
            <span className="text-t-ink2">{entry.timestamp}</span>

            <span className="text-t-ink4 flex items-center gap-1"><User className="w-2.5 h-2.5" /> Profile</span>
            <span className="text-t-ink2">{entry.profile ?? <em className="text-t-ink5">— no profile —</em>}</span>

            <span className="text-t-ink4 flex items-center gap-1"><Layers className="w-2.5 h-2.5" /> Queue</span>
            <span className="text-blue-500 break-all">{entry.address}</span>

            {entry.is_file && entry.file_name && (
              <>
                <span className="text-t-ink4 flex items-center gap-1"><FileText className="w-2.5 h-2.5" /> File</span>
                <span className="text-t-ink2 break-all">{entry.file_name}</span>
              </>
            )}
          </div>
        </div>

        {/* ─── AUTO-SET — what AMQPush adds to every message ─── */}
        {Object.keys(entry.auto_properties ?? {}).length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t-ink5 font-semibold mb-1.5 flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Auto-set headers / properties ({Object.keys(entry.auto_properties).length})
              <span className="normal-case font-normal text-t-ink5">— added by AMQPush, sent over the wire</span>
            </p>
            <div className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono border border-t-line rounded-md p-2.5 bg-t-card/40">
              {Object.entries(entry.auto_properties).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="text-t-ink4 truncate" title={k}>{k}</span>
                  <span className="text-t-ink2 break-all">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── USER PROPERTIES — what user set in the Properties tab ─── */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-t-ink5 font-semibold mb-1.5 flex items-center gap-1">
            <Tag className="w-3 h-3" />
            Custom properties ({Object.keys(entry.properties).length})
            <span className="normal-case font-normal text-t-ink5">— from the Properties tab in Send</span>
          </p>
          {hasProps ? (
            <div className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono border border-t-line rounded-md p-2.5 bg-t-card/40">
              {Object.entries(entry.properties).map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="text-t-ink4 truncate" title={k}>{k}</span>
                  <span className="text-t-ink2 break-all">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-t-ink5 italic px-2.5">— none —</p>
          )}
        </div>

        {/* ─── BODY ─── */}
        {!entry.is_file ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wider text-t-ink5 font-semibold flex items-center gap-1">
                <FileText className="w-3 h-3" /> Body
              </p>
              <span className="text-[10px] text-t-ink5 font-mono">
                {new TextEncoder().encode(bodyText).length} B
                {prettyBody && " · JSON"}
              </span>
            </div>
            <pre className="text-[11px] text-t-ink2 font-mono bg-t-field border border-t-line rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {prettyBody ?? bodyText}
            </pre>
          </div>
        ) : (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-t-ink5 font-semibold mb-1.5 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Body (binary)
            </p>
            <p className="text-[11px] text-t-ink3 px-2.5">
              File: <span className="font-mono text-t-ink2">{entry.file_name}</span>
              <span className={`ml-2 ${entry.file_data_b64 ? "text-green-500" : "text-t-ink5"}`}>
                {entry.file_data_b64 ? "· content stored — can resend" : "· content not retained"}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
