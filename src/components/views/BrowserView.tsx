import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Radar, RotateCcw, Inbox, Send, X, XCircle, Loader2, Eye,
  ChevronRight, ChevronDown, Copy,
} from "lucide-react";

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
  const [pollErr,   setPollErr]   = useState<string | null>(null); // silent error from polling

  // Peek state — selected queue and messages
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [messages,      setMessages]      = useState<PeekedMessage[]>([]);
  const [peekLoading,   setPeekLoading]   = useState(false);
  const [peekErr,       setPeekErr]       = useState<string | null>(null);
  const [peekMax,       setPeekMax]       = useState(PEEK_DEFAULT_MAX);
  const [openMessageIdx, setOpenMessageIdx] = useState<number | null>(null);

  // ─── Auto-refresh queue list (cheap call: only metrics, no message bodies) ──
  // Polls every 2.5s while view is visible AND connected AND auto enabled.
  useEffect(() => {
    if (!connected || !visible || !autoOn) return;

    // Initial load
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
        setPollErr(msg); // surface in top bar without log spam
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
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
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <Radar className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
        <span className="text-[13px] font-semibold text-t-ink">Broker Browser</span>
        {loaded && (
          <span className="text-[11px] text-t-ink5 font-mono">
            {filtered.length === queues.length ? `${queues.length} queue${queues.length !== 1 ? "s" : ""}` : `${filtered.length} / ${queues.length}`}
          </span>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {/* Polling status indicator */}
          {connected && autoOn && pollErr ? (
            <span className="flex items-center gap-1 text-[10px] text-amber-500 font-mono px-2" title={`Polling error: ${pollErr}`}>
              <span className="w-1 h-1 rounded-full bg-amber-500" />
              poll error
            </span>
          ) : connected && autoOn && loaded ? (
            <span className="flex items-center gap-1 text-[10px] text-t-ink5 font-mono px-2" title={`Auto-refresh every ${QUEUE_POLL_INTERVAL_MS / 1000}s`}>
              <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
              live
            </span>
          ) : null}

          <label className="flex items-center gap-1 text-[11px] text-t-ink4 cursor-pointer select-none px-2"
            title={autoOn ? "Auto-refresh enabled — disable to pause" : "Auto-refresh paused"}>
            <input type="checkbox" checked={autoOn} onChange={e => setAutoOn(e.target.checked)}
              className="w-3 h-3 accent-blue-600 cursor-pointer" />
            Auto
          </label>
          <label className="flex items-center gap-1 text-[11px] text-t-ink4 cursor-pointer select-none px-2">
            <input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)}
              className="w-3 h-3 accent-blue-600 cursor-pointer" />
            Hide empty
          </label>
          <button onClick={() => refreshQueues(false)} disabled={!connected || loading}
            className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-blue-500 hover:bg-blue-500/10 transition-colors flex items-center gap-1 disabled:opacity-40">
            <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ─── SEARCH BAR ─── */}
      {loaded && queues.length > 0 && (
        <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filter queues by name or address…"
            className="flex-1 bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5" />
          {search && (
            <button onClick={() => setSearch("")} className="text-t-ink5 hover:text-t-ink3"><X className="w-3 h-3" /></button>
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
            <div className="flex flex-col items-center justify-center h-full text-t-ink5 max-w-md mx-auto text-center">
              <XCircle className="w-8 h-8 mb-3 text-red-500/60" />
              <p className="text-[13px] text-red-500">Discovery failed</p>
              <p className="text-[11px] mt-1 break-all">{err}</p>
              <button onClick={() => refreshQueues(false)}
                className="mt-3 px-2.5 py-1 rounded-md text-[11px] font-medium bg-t-card border border-t-line text-t-ink2 hover:bg-t-hover transition-colors">
                Retry
              </button>
              <p className="text-[10px] mt-3 text-t-ink5">
                Requires Artemis or ActiveMQ Classic with AMQP management enabled
              </p>
            </div>
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
                        onClick={() => peekQueue(bq.address)}
                        className={`group cursor-pointer border-b border-t-line/50 transition-colors ${
                          isSel ? "bg-blue-500/10" : "hover:bg-t-hover/50"
                        }`}>
                        <td className="py-1 px-3 truncate">
                          <span className="text-t-ink">{bq.name}</span>
                        </td>
                        <td className="py-1 px-2">
                          <span className={`text-[10px] px-1 py-0 rounded font-medium ${
                            bq.routing_type === "ANYCAST" ? "bg-blue-500/15 text-blue-500" : "bg-violet-500/15 text-violet-500"
                          }`}>{bq.routing_type === "ANYCAST" ? "ANY" : "MULTI"}</span>
                        </td>
                        <td className={`py-1 px-2 text-right ${bq.message_count > 0 ? "text-t-ink font-medium" : "text-t-ink5"}`}>
                          {bq.message_count}
                        </td>
                        <td className={`py-1 px-2 text-right ${bq.consumer_count > 0 ? "text-green-500" : "text-t-ink5"}`}>
                          {bq.consumer_count}
                        </td>
                        {!selectedQueue && (
                          <td className="py-1 px-2 truncate text-t-ink4 text-[11px]">{bq.address}</td>
                        )}
                        <td className="py-1 pr-2">
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
            <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
              <span className="text-[13px] font-semibold text-t-ink truncate">{selectedQueue}</span>
              {!peekLoading && !peekErr && (
                <span className="text-[11px] text-t-ink5 font-mono">{messages.length} peeked</span>
              )}

              <div className="ml-auto flex items-center gap-1">
                <select value={peekMax} onChange={e => setPeekMax(Number(e.target.value))}
                  className="bg-t-field border border-t-line2 rounded px-1.5 py-0.5 text-[11px] text-t-ink2 outline-none"
                  title="Max messages to peek">
                  {[5, 10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <IconBtn title="Refresh" onClick={() => peekQueue(selectedQueue)} colorClass="hover:text-blue-500 hover:bg-blue-500/10">
                  <RotateCcw className={`w-3 h-3 ${peekLoading ? "animate-spin" : ""}`} />
                </IconBtn>
                <IconBtn title="Close" onClick={closePeek} colorClass="hover:text-t-ink hover:bg-t-hover">
                  <X className="w-3 h-3" />
                </IconBtn>
              </div>
            </div>

            {peekLoading ? (
              <EmptyState icon={<Loader2 className="w-8 h-8 animate-spin" />} title="Peeking messages…" subtitle="Reading from queue without consuming" />
            ) : peekErr ? (
              <div className="flex flex-col items-center justify-center h-full text-t-ink5 max-w-md mx-auto text-center">
                <XCircle className="w-8 h-8 mb-3 text-red-500/60" />
                <p className="text-[13px] text-red-500">Peek failed</p>
                <p className="text-[11px] mt-1 break-all">{peekErr}</p>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState icon={<Inbox className="w-8 h-8" />} title="Queue is empty" />
            ) : (
              <>
                {/* Compact message table — id + datetime + size + content type */}
                <div className="flex-1 overflow-auto min-h-0 border-b border-t-line">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="sticky top-0 z-10 bg-t-panel border-b border-t-line">
                      <tr className="text-[10px] uppercase tracking-wider text-t-ink4">
                        <th className="text-left py-1 pl-3 w-8">#</th>
                        <th className="text-left py-1 pr-2">Message ID</th>
                        <th className="text-left py-1 px-2 w-24">Time</th>
                        <th className="text-right py-1 px-2 w-16">Size</th>
                        <th className="text-left py-1 pr-3 w-28">Content type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {messages.map((msg, i) => {
                        const isOpen = openMessageIdx === i;
                        const idText = msg.message_id ?? <em className="text-t-ink5">—</em>;
                        const timeText = msg.creation_time
                          ? new Date(msg.creation_time).toLocaleTimeString()
                          : <em className="text-t-ink5">—</em>;
                        const ct = msg.content_type ?? msg.body_kind;
                        return (
                          <tr key={i}
                            onClick={() => setOpenMessageIdx(isOpen ? null : i)}
                            className={`cursor-pointer border-b border-t-line/40 transition-colors ${
                              isOpen ? "bg-blue-500/10" : "hover:bg-t-hover/50"
                            }`}>
                            <td className="py-1 pl-3 text-t-ink5">{i + 1}</td>
                            <td className="py-1 pr-2 truncate text-t-ink2" title={msg.message_id ?? ""}>{idText}</td>
                            <td className="py-1 px-2 text-t-ink3 whitespace-nowrap">{timeText}</td>
                            <td className="py-1 px-2 text-right text-t-ink4">{msg.body_size}</td>
                            <td className="py-1 pr-3 truncate text-t-ink3" title={ct}>
                              <span className="text-[10px] px-1 py-0 rounded bg-t-hover text-t-ink3">{ct}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-t-ink5">
      <div className="opacity-40 mb-3">{icon}</div>
      <p className="text-[13px]">{title}</p>
      {subtitle && <p className="text-[11px] mt-1">{subtitle}</p>}
    </div>
  );
}

function MessageDetails({ msg, idx, onLog }: { msg: PeekedMessage; idx: number; onLog: (k: "info" | "ok" | "err", t: string) => void }) {
  const [bodyOpen,  setBodyOpen]  = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);
  const [appOpen,   setAppOpen]   = useState(true);

  const appProps = Object.entries(msg.application_properties);

  const prettyBody = (() => {
    if (!msg.body_text) return null;
    if (msg.content_type?.includes("json") || msg.body_text.trimStart().startsWith("{") || msg.body_text.trimStart().startsWith("[")) {
      try { return JSON.stringify(JSON.parse(msg.body_text), null, 2); } catch { return null; }
    }
    return null;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-t-ink5 font-mono">#{idx + 1}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-hover text-t-ink3 font-medium uppercase">{msg.body_kind}</span>
        <span className="text-t-ink5 font-mono">{msg.body_size} B</span>
        {msg.delivery_count > 0 && (
          <span className="text-t-ink4" title="Delivery count">↻ {msg.delivery_count}</span>
        )}
        {msg.priority !== null && msg.priority !== 4 && <span className="text-t-ink4">P{msg.priority}</span>}
      </div>

      <CollapsibleSection title="Properties" open={propsOpen} onToggle={() => setPropsOpen(o => !o)}>
        <PropsTable items={[
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
        <CollapsibleSection title={`Application Properties (${appProps.length})`} open={appOpen} onToggle={() => setAppOpen(o => !o)}>
          <PropsTable items={appProps} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Body"
        open={bodyOpen}
        onToggle={() => setBodyOpen(o => !o)}
        action={msg.body_text ? (
          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(msg.body_text!); onLog("info", "Body copied"); }}
            className="flex items-center gap-1 text-[10px] text-t-ink4 hover:text-t-ink2 transition-colors px-1.5 py-0.5 rounded hover:bg-t-hover">
            <Copy className="w-3 h-3" /> Copy
          </button>
        ) : null}
      >
        <pre className="text-[11px] text-t-ink2 font-mono bg-t-field border border-t-line rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
          {prettyBody ?? msg.body_text ?? <em className="text-t-ink5">no body</em>}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({ title, open, onToggle, action, children }: {
  title: string; open: boolean; onToggle: () => void; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="border border-t-line rounded-md overflow-hidden bg-t-panel">
      <div className="flex items-center justify-between px-2 py-1 bg-t-card/60">
        <button onClick={onToggle}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-t-ink4 font-semibold hover:text-t-ink2 transition-colors">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

function PropsTable({ items }: { items: Array<[string, string | null | undefined]> }) {
  const visible = items.filter(([_, v]) => v !== null && v !== undefined && v !== "");
  if (visible.length === 0) return <p className="text-[11px] text-t-ink5">—</p>;
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 text-[11px] font-mono">
      {visible.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-t-ink4 truncate">{k}</span>
          <span className="text-t-ink2 break-all">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}
