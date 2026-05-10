import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Radar, RotateCcw, Inbox, Send, X, Loader2, Eye,
  Tag, MessageSquare, Search, Trash2, AlertTriangle,
} from "lucide-react";
import CollapsibleSection from "../CollapsibleSection";
import PropsList from "../PropsList";
import EmptyState from "../EmptyState";
import ViewTopBar from "../ViewTopBar";
import CopyButton from "../CopyButton";
import { fmtBytes } from "../../utils/format";
import { tryPrettyJson, tryPrettyXml, hexDump, detectFormat } from "../../utils/bodyView";

interface BrokerQueue {
  name: string;
  address: string;
  message_count: number;
  consumer_count: number;
  routing_type: string;
}

interface PeekedMessage {
  message_id: string | null;
  user_id: string | null;
  to: string | null;
  subject: string | null;
  reply_to: string | null;
  correlation_id: string | null;
  content_type: string | null;
  content_encoding: string | null;
  absolute_expiry_time: number | null;
  creation_time: number | null;
  group_id: string | null;
  group_sequence: number | null;
  reply_to_group_id: string | null;
  application_properties: Record<string, string>;
  body_text: string | null;
  body_kind: string;
  body_size: number;
  priority: number | null;
  durable: boolean | null;
  ttl_ms: number | null;
  delivery_count: number;
}

interface Props {
  connected: boolean;
  visible: boolean;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onPublishTo: (address: string) => void;
  onSubscribeTo: (address: string) => void;
}

const PEEK_DEFAULT_MAX = 20;
const PEEK_DEFAULT_TIMEOUT_MS = 1500;
const QUEUE_POLL_INTERVAL_MS = 2500;

type SortKey = "name" | "messages" | "consumers" | "type";
type SortDir = "asc" | "desc";

export default function BrowserView({ connected, visible, onLog, onPublishTo, onSubscribeTo }: Props) {
  const [queues,    setQueues]    = useState<BrokerQueue[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [err,       setErr]       = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [loaded,    setLoaded]    = useState(false);
  const [sortKey,   setSortKey]   = useState<SortKey>("name");
  const [sortDir,   setSortDir]   = useState<SortDir>("asc");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [autoOn,    setAutoOn]    = useState(true);
  const [pollErr,   setPollErr]   = useState<string | null>(null);

  // Peek state — selected queue and messages
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [messages,      setMessages]      = useState<PeekedMessage[]>([]);
  const [peekLoading,   setPeekLoading]   = useState(false);
  const [peekErr,       setPeekErr]       = useState<string | null>(null);
  const [peekMax,       setPeekMax]       = useState(PEEK_DEFAULT_MAX);
  const [openMessageIdx, setOpenMessageIdx] = useState<number | null>(null);
  /** Set to a queue address while a Purge-confirm modal is open for it. */
  const [purgeConfirm,  setPurgeConfirm]  = useState<string | null>(null);
  const [purging,       setPurging]       = useState(false);

  // ─── Auto-refresh queue list (cheap call: only metrics, no message bodies) ──
  useEffect(() => {
    if (!connected || !visible || !autoOn) return;

    if (!loaded && !loading) refreshQueues(false);

    const id = setInterval(() => { refreshQueues(true); }, QUEUE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [connected, visible, autoOn, loaded]);

  /** Reload queue list. `silent` = no spinner / no log entries (used by polling). */
  async function refreshQueues(silent: boolean) {
    if (!connected) { setErr("Not connected to broker"); return; }
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const list = await invoke<BrokerQueue[]>("list_broker_queues");
      setQueues(list);
      setLoaded(true);
      setPollErr(null);
      if (!silent) {
        setErr(null);
        onLog("ok", `Discovered ${list.length} queue${list.length !== 1 ? "s" : ""} on broker`);
      }
    } catch (e) {
      const msg = String(e);
      if (silent) {
        setPollErr(msg);
      } else {
        setErr(msg);
        onLog("err", `Browse failed: ${msg}`);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function peekQueue(queue: string) {
    setSelectedQueue(queue);
    setPeekLoading(true);
    setPeekErr(null);
    setMessages([]);
    setOpenMessageIdx(null);
    try {
      const msgs = await invoke<PeekedMessage[]>("peek_messages", {
        queue, max: peekMax, timeoutMs: PEEK_DEFAULT_TIMEOUT_MS,
      });
      setMessages(msgs);
      onLog("ok", `Peeked ${msgs.length} message${msgs.length !== 1 ? "s" : ""} from '${queue}' (released back)`);
    } catch (e) {
      const msg = String(e);
      setPeekErr(msg);
      onLog("err", `Peek failed on '${queue}': ${msg}`);
    } finally {
      setPeekLoading(false);
    }
  }

  function closePeek() {
    setSelectedQueue(null);
    setMessages([]);
    setPeekErr(null);
    setOpenMessageIdx(null);
  }

  /**
   * Invoke the destructive `purge_queue` Tauri command. Caller is expected
   * to have already shown a confirm dialog. On success we re-peek to show
   * the (now empty) queue so the user immediately sees the result.
   */
  async function purgeQueue(queue: string) {
    setPurging(true);
    try {
      const removed = await invoke<number>("purge_queue", { queue });
      onLog("ok", `Purged ${removed} message${removed !== 1 ? "s" : ""} from '${queue}'`);
      setPurgeConfirm(null);
      // Refresh both: the queue list (msg count went to 0) and the peek pane.
      await refreshQueues(true);
      await peekQueue(queue);
    } catch (e) {
      onLog("err", `Purge failed: ${e}`);
    } finally {
      setPurging(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function skipIfSelecting(): boolean {
    const sel = window.getSelection?.()?.toString();
    return !!sel && sel.length > 0;
  }

  // Filter + sort
  let filtered = queues;
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(it =>
      it.name.toLowerCase().includes(q) || it.address.toLowerCase().includes(q));
  }
  if (hideEmpty) filtered = filtered.filter(it => it.message_count > 0);
  filtered = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":      return a.name.localeCompare(b.name) * dir;
      case "type":      return a.routing_type.localeCompare(b.routing_type) * dir;
      case "messages":  return (a.message_count - b.message_count) * dir;
      case "consumers": return (a.consumer_count - b.consumer_count) * dir;
    }
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR ─── */}
      <ViewTopBar
        icon={<Radar className="w-3.5 h-3.5" />}
        title="Broker Browser"
        count={loaded ? (
          filtered.length === queues.length
            ? `${queues.length} queue${queues.length !== 1 ? "s" : ""}`
            : `${filtered.length} / ${queues.length}`
        ) : null}
        status={connected && autoOn && pollErr ? (
          <span className="flex items-center gap-1 text-[10px] text-amber-500 font-mono" title={`Polling error: ${pollErr}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            poll error
          </span>
        ) : connected && autoOn && loaded ? (
          <span className="flex items-center gap-1 text-[10px] text-t-ink5 font-mono" title={`Auto-refresh every ${QUEUE_POLL_INTERVAL_MS / 1000}s`}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            live
          </span>
        ) : null}
      >
        <button
          onClick={() => setAutoOn(a => !a)}
          aria-pressed={autoOn}
          className={`text-[11px] transition-colors px-1.5 py-0.5 rounded ${
            autoOn ? "text-blue-500 bg-blue-500/10" : "text-t-ink4 hover:text-t-ink3"
          }`}
          title={autoOn ? "Auto-refresh on — click to pause" : "Auto-refresh paused"}
        >
          {autoOn ? "● auto" : "○ auto"}
        </button>
        <button
          onClick={() => setHideEmpty(h => !h)}
          aria-pressed={hideEmpty}
          className={`text-[11px] transition-colors px-1.5 py-0.5 rounded ${
            hideEmpty ? "text-blue-500 bg-blue-500/10" : "text-t-ink4 hover:text-t-ink3"
          }`}
          title="Hide queues with zero messages"
        >
          Hide empty
        </button>
        <button onClick={() => refreshQueues(false)} disabled={!connected || loading}
          className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-blue-500 hover:bg-blue-500/10 transition-colors flex items-center gap-1 disabled:opacity-40">
          <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </ViewTopBar>

      {/* ─── FILTER BAR — only when there are queues to filter ─── */}
      {loaded && queues.length > 0 && (
        <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-t-ink5 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter queues by name or address…"
            className="flex-1 bg-transparent text-xs text-t-ink outline-none placeholder:text-t-ink5" />
          {search && (
            <button onClick={() => setSearch("")} className="text-t-ink5 hover:text-t-ink3 transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* ─── BODY: split — left list / right peek ─── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ─── LEFT: QUEUE TABLE ─── */}
        <div className={`${selectedQueue ? "w-[45%] border-r border-t-line" : "flex-1"} flex flex-col min-w-0 min-h-0 overflow-hidden`}>
          {!connected ? (
            <EmptyState icon={<Radar className="w-8 h-8" />} title="Not connected" subtitle="Connect to a broker to discover queues" />
          ) : loading && queues.length === 0 ? (
            <EmptyState icon={<Loader2 className="w-8 h-8 animate-spin" />} title="Querying broker…" />
          ) : err ? (
            <EmptyState
              variant="error"
              title="Discovery failed"
              subtitle={<>
                {err}
                <p className="text-[10px] mt-3 text-t-ink5">Requires Artemis or ActiveMQ Classic with AMQP management enabled</p>
              </>}
              action={
                <button onClick={() => refreshQueues(false)}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-t-card border border-t-line text-t-ink2 hover:bg-t-hover transition-colors">
                  Retry
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Radar className="w-8 h-8" />} title={search || hideEmpty ? "No queues match" : "No queues on broker"} />
          ) : (
            <div className="flex-1 overflow-auto min-h-0">
              <table className="w-full text-[12px] font-mono table-fixed">
                <thead className="sticky top-0 z-10 bg-t-panel border-b border-t-line">
                  <tr className="text-[10px] uppercase tracking-wider text-t-ink4 select-none">
                    <SortableHeader label="Name"  sortKey="name"      current={sortKey} dir={sortDir} onClick={toggleSort} className="text-left  pl-3" />
                    <SortableHeader label="Type"  sortKey="type"      current={sortKey} dir={sortDir} onClick={toggleSort} className="text-left  w-24" />
                    <SortableHeader label="Msgs"  sortKey="messages"  current={sortKey} dir={sortDir} onClick={toggleSort} className="text-right w-14" />
                    <SortableHeader label="Cons"  sortKey="consumers" current={sortKey} dir={sortDir} onClick={toggleSort} className="text-right w-12" />
                    {!selectedQueue && <th className="text-left w-44 font-semibold py-1.5 px-2">Address</th>}
                    <th className="w-24 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(bq => {
                    const isSel = selectedQueue === bq.address;
                    return (
                      <tr key={bq.name}
                        onClick={() => { if (skipIfSelecting()) return; peekQueue(bq.address); }}
                        className={`group cursor-pointer border-b border-t-line/40 transition-colors ${
                          isSel ? "bg-blue-500/10" : "hover:bg-t-hover/50"
                        }`}>
                        <td className="py-1.5 px-3 truncate">
                          <span className="text-t-ink">{bq.name}</span>
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={`text-[10px] px-1 rounded font-medium ${
                            bq.routing_type === "ANYCAST" ? "bg-blue-500/15 text-blue-500" : "bg-violet-500/15 text-violet-500"
                          }`}>{bq.routing_type === "ANYCAST" ? "ANY" : "MULTI"}</span>
                        </td>
                        <td className={`py-1.5 px-2 text-right ${bq.message_count > 0 ? "text-t-ink font-medium" : "text-t-ink5"}`}>
                          {bq.message_count}
                        </td>
                        <td className={`py-1.5 px-2 text-right ${bq.consumer_count > 0 ? "text-green-500" : "text-t-ink5"}`}>
                          {bq.consumer_count}
                        </td>
                        {!selectedQueue && (
                          <td className="py-1.5 px-2 truncate text-t-ink4 text-[11px]">{bq.address}</td>
                        )}
                        <td className="py-1.5 pr-2">
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <IconBtn title="Publish to" onClick={(e) => { e.stopPropagation(); onPublishTo(bq.address); }} colorClass="hover:text-blue-500 hover:bg-blue-500/10">
                              <Send className="w-3 h-3" />
                            </IconBtn>
                            <IconBtn title="Subscribe" onClick={(e) => { e.stopPropagation(); onSubscribeTo(bq.address); }} colorClass="hover:text-green-500 hover:bg-green-500/10">
                              <Inbox className="w-3 h-3" />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── RIGHT: PEEK PANE ─── */}
        {selectedQueue && (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Peek pane header — matches SubscriberView preview header style */}
            <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
              <span className="text-[12px] text-t-ink font-mono truncate" title={selectedQueue}>{selectedQueue}</span>
              {!peekLoading && !peekErr && (
                <span className="text-[11px] text-t-ink5 font-mono">{messages.length} peeked</span>
              )}

              <div className="ml-auto flex items-center gap-1">
                <select value={peekMax} onChange={e => setPeekMax(Number(e.target.value))}
                  className="bg-t-field border border-t-line2 rounded px-1.5 py-0.5 text-[11px] text-t-ink2 outline-none"
                  title="Max messages to peek">
                  {[5, 10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <button onClick={() => peekQueue(selectedQueue)}
                  title="Refresh"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-blue-500 hover:bg-blue-500/10 transition-colors">
                  <RotateCcw className={`w-3 h-3 ${peekLoading ? "animate-spin" : ""}`} /> Refresh
                </button>
                <button
                  onClick={() => setPurgeConfirm(selectedQueue)}
                  disabled={messages.length === 0 || peekLoading}
                  title={messages.length === 0
                    ? "Queue is empty — nothing to purge"
                    : "Permanently delete all messages from this queue"}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:text-t-ink4 disabled:hover:bg-transparent"
                >
                  <Trash2 className="w-3 h-3" /> Purge
                </button>
                <button onClick={closePeek}
                  title="Close peek"
                  className="p-1 rounded text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {peekLoading ? (
              <EmptyState icon={<Loader2 className="w-8 h-8 animate-spin" />} title="Peeking messages…" subtitle="Reading from queue without consuming" />
            ) : peekErr ? (
              <EmptyState variant="error" title="Peek failed" subtitle={peekErr} />
            ) : messages.length === 0 ? (
              <EmptyState icon={<Inbox className="w-8 h-8" />} title="Queue is empty" />
            ) : (
              <>
                {/* List of peeked messages — visually matches SubscriberView's received list */}
                <div className="flex-1 overflow-auto min-h-0 border-b border-t-line">
                  {messages.map((msg, i) => {
                    const isOpen = openMessageIdx === i;
                    const idShort = msg.message_id ?? "—";
                    const ct = msg.content_type ?? msg.body_kind;
                    const timeText = msg.creation_time
                      ? new Date(msg.creation_time).toLocaleTimeString()
                      : "—";
                    return (
                      <button
                        key={i}
                        onClick={() => { if (skipIfSelecting()) return; setOpenMessageIdx(isOpen ? null : i); }}
                        className={`w-full text-left flex flex-col gap-0.5 px-3 py-2 border-b border-t-line/40 transition-colors border-l-2 border-l-transparent ${
                          isOpen ? "bg-blue-500/10" : "hover:bg-t-hover/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-[11px]">
                          <MessageSquare className="w-3 h-3 text-t-ink5 shrink-0" />
                          <span className="text-t-ink5 font-mono shrink-0">#{i + 1}</span>
                          <span className="text-t-ink2 font-mono truncate flex-1" title={msg.message_id ?? ""}>{idShort}</span>
                          <span className="text-t-ink5 font-mono shrink-0">{timeText}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] pl-5">
                          <span className="px-1 rounded bg-t-hover text-t-ink3 font-mono">{ct}</span>
                          <span className="text-t-ink5 font-mono">{fmtBytes(msg.body_size)}</span>
                          {msg.priority !== null && msg.priority !== 4 && (
                            <span className="text-t-ink4 font-mono">P{msg.priority}</span>
                          )}
                          {msg.delivery_count > 0 && (
                            <span className="text-t-ink4 font-mono" title="Delivery count">↻ {msg.delivery_count}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected message details */}
                {openMessageIdx !== null && messages[openMessageIdx] && (
                  <div className="shrink-0 max-h-[55%] overflow-auto p-3 bg-t-card/40 border-t border-t-line">
                    <MessageDetails msg={messages[openMessageIdx]} idx={openMessageIdx} onLog={onLog} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── PURGE CONFIRM MODAL ─── */}
      {purgeConfirm && (
        <PurgeConfirmModal
          queue={purgeConfirm}
          messageCount={queues.find(q => q.address === purgeConfirm)?.message_count ?? messages.length}
          purging={purging}
          onConfirm={() => purgeQueue(purgeConfirm)}
          onCancel={() => setPurgeConfirm(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PurgeConfirmModal({ queue, messageCount, purging, onConfirm, onCancel }: {
  queue: string;
  messageCount: number;
  purging: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        className="bg-t-bg border border-t-line rounded-lg shadow-2xl w-[460px] max-w-[90vw] flex flex-col overflow-hidden">

        <div className="shrink-0 px-4 py-2.5 border-b border-t-line bg-t-panel flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[13px] font-semibold text-t-ink">Purge queue</span>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-t-hover text-t-ink4 hover:text-t-ink">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2 text-[13px] text-t-ink2">
          <p>
            Permanently delete <span className="font-mono font-bold text-t-ink">{messageCount.toLocaleString()}</span>{" "}
            message{messageCount !== 1 ? "s" : ""} from queue{" "}
            <span className="font-mono text-blue-500">{queue}</span>?
          </p>
          <p className="text-[11px] text-t-ink5">
            This calls Artemis's <code className="text-t-ink4">removeAllMessages</code> management
            operation. The action cannot be undone — drained messages do <em>not</em> go to the DLQ.
          </p>
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-t-line bg-t-panel flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={purging}
            className="px-3 py-1 rounded-md text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={purging}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-500 hover:bg-red-600 text-white text-[11px] font-semibold transition-colors disabled:opacity-40"
          >
            {purging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            {purging ? "Purging…" : `Delete ${messageCount.toLocaleString()} message${messageCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SortableHeader({ label, sortKey, current, dir, onClick, className }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
  onClick: (k: SortKey) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <th onClick={() => onClick(sortKey)}
      className={`font-semibold py-1.5 px-2 cursor-pointer select-none hover:text-t-ink2 ${className ?? ""}`}>
      {label}{active && (dir === "asc" ? " ↑" : " ↓")}
    </th>
  );
}

function IconBtn({ title, onClick, colorClass, children }: {
  title: string; onClick: (e: React.MouseEvent) => void; colorClass: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`p-1 rounded text-t-ink4 transition-colors ${colorClass}`}>
      {children}
    </button>
  );
}

function MessageDetails({ msg, idx, onLog }: { msg: PeekedMessage; idx: number; onLog: (k: "info" | "ok" | "err", t: string) => void }) {
  const [bodyOpen,  setBodyOpen]  = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);
  const [appOpen,   setAppOpen]   = useState(true);
  const [bodyMode,  setBodyMode]  = useState<"auto" | "raw" | "hex">("auto");

  // Reset body view-mode when switching message
  useEffect(() => { setBodyMode("auto"); }, [idx]);

  // Rust's HashMap doesn't preserve insertion order, so sort alphabetically
  // for a stable display — otherwise the same message peeked twice can show
  // its properties in different orders, which looks like a UI bug.
  const appProps = Object.entries(msg.application_properties)
    .sort(([a], [b]) => a.localeCompare(b));
  const detected = detectFormat({ contentType: msg.content_type, bodyText: msg.body_text });

  const bodyContent = (() => {
    const raw = msg.body_text ?? "";
    if (!raw) return null;
    if (bodyMode === "hex") return hexDump(raw);
    if (bodyMode === "raw") return raw;
    if (detected === "json") return tryPrettyJson(raw) ?? raw;
    if (detected === "xml")  return tryPrettyXml(raw)  ?? raw;
    return raw;
  })();

  return (
    <div className="space-y-3">
      {/* Header chips — match Subscriber/History */}
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-t-ink5 font-mono">#{idx + 1}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-hover text-t-ink3 font-medium uppercase">{msg.body_kind}</span>
        <span className="text-t-ink5 font-mono">{fmtBytes(msg.body_size)}</span>
        {msg.delivery_count > 0 && (
          <span className="text-t-ink4" title="Delivery count">↻ {msg.delivery_count}</span>
        )}
        {msg.priority !== null && msg.priority !== 4 && <span className="text-t-ink4">P{msg.priority}</span>}
        {msg.durable && <span className="text-blue-500">durable</span>}
      </div>

      <CollapsibleSection title="Properties" icon={<Tag className="w-3 h-3" />} open={propsOpen} onToggle={() => setPropsOpen(o => !o)}>
        <PropsList onLog={onLog} items={[
          ["message-id",       msg.message_id],
          ["correlation-id",   msg.correlation_id],
          ["reply-to",         msg.reply_to],
          ["to",               msg.to],
          ["subject",          msg.subject],
          ["content-type",     msg.content_type],
          ["content-encoding", msg.content_encoding],
          ["user-id",          msg.user_id],
          ["group-id",         msg.group_id],
          ["group-sequence",   msg.group_sequence?.toString() ?? null],
          ["reply-to-group-id", msg.reply_to_group_id],
          ["creation-time",    msg.creation_time ? new Date(msg.creation_time).toISOString() : null],
          ["absolute-expiry",  msg.absolute_expiry_time ? new Date(msg.absolute_expiry_time).toISOString() : null],
          ["priority",         msg.priority?.toString() ?? null],
          ["durable",          msg.durable?.toString() ?? null],
          ["ttl-ms",           msg.ttl_ms?.toString() ?? null],
          ["delivery-count",   msg.delivery_count.toString()],
        ]} />
      </CollapsibleSection>

      {appProps.length > 0 && (
        <CollapsibleSection title={`Application Properties (${appProps.length})`} icon={<Tag className="w-3 h-3" />} open={appOpen} onToggle={() => setAppOpen(o => !o)}>
          <PropsList onLog={onLog} items={appProps} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Body"
        icon={<MessageSquare className="w-3 h-3" />}
        open={bodyOpen}
        onToggle={() => setBodyOpen(o => !o)}
        action={
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center bg-t-card border border-t-line rounded overflow-hidden">
              {(["auto", "raw", "hex"] as const).map(m => (
                <button
                  key={m}
                  onClick={(e) => { e.stopPropagation(); setBodyMode(m); }}
                  className={`px-1.5 py-0.5 text-[10px] font-mono uppercase transition-colors ${
                    bodyMode === m ? "bg-blue-500/15 text-blue-500" : "text-t-ink4 hover:text-t-ink2 hover:bg-t-hover"
                  }`}
                  title={
                    m === "auto" ? `Auto (${detected})` :
                    m === "raw"  ? "Raw text" : "Hex dump"
                  }
                >
                  {m}
                </button>
              ))}
            </div>
            {msg.body_text && (
              <CopyButton
                value={msg.body_text}
                onCopied={() => onLog("info", "Body copied")}
                label="Copy"
                className="flex items-center gap-1 text-[10px] text-t-ink4 hover:text-t-ink2 transition-colors px-1.5 py-0.5 rounded hover:bg-t-hover"
              />
            )}
          </div>
        }
      >
        <pre className="text-[11px] text-t-ink2 font-mono bg-t-field border border-t-line rounded-md p-2.5 overflow-x-auto whitespace-pre break-all max-h-64 overflow-y-auto select-text">
          {bodyContent ?? <em className="text-t-ink5">no body</em>}
        </pre>
      </CollapsibleSection>
    </div>
  );
}
