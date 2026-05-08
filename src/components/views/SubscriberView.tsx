import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  Play, Square, Trash2, Copy, Inbox, Search, X, Loader2, Pause, CornerUpLeft,
  Tag, MessageSquare, Download, Palette, Plus, Edit3,
  Database, GitCompare, ChevronDown,
} from "lucide-react";
import { ReceivedMessage, SubEvent } from "../../types";
import QueuePicker from "../QueuePicker";
import CollapsibleSection from "../CollapsibleSection";
import PropsList from "../PropsList";
import EmptyState from "../EmptyState";
import { fmtBytes, fmtDuration, csvEscape } from "../../utils/format";
import { tryPrettyJson, tryPrettyXml, hexDump, detectFormat } from "../../utils/bodyView";

interface ReplyArg {
  address: string;
  body?: string;
  properties?: Record<string, string>;
  correlationId?: string;
}

interface Props {
  connected: boolean;
  defaultAddress: string;
  pendingAddress?: { address: string; nonce: number } | null;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onMessageReceived?: (bytes: number, queue: string) => void;
  onReply?: (arg: ReplyArg) => void;
}

// ── highlight rules ──────────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = ["red", "amber", "green", "blue", "purple", "pink"] as const;
type HighlightColor = typeof HIGHLIGHT_COLORS[number];

interface HighlightRule {
  id: string;
  name: string;
  pattern: string;
  color: HighlightColor;
  enabled: boolean;
}

const RULES_STORAGE_KEY   = "amqpush.subscriber.highlightRules";
const PERSIST_FLAG_KEY    = "amqpush.subscriber.persistEnabled";
const PERSIST_DATA_KEY    = "amqpush.subscriber.persistedMessages";
const PERSIST_MAX_ENTRIES = 500;

function loadRules(): HighlightRule[] {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => r && typeof r.id === "string");
  } catch { return []; }
}
function saveRules(rules: HighlightRule[]) {
  try { localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules)); } catch {}
}

const COLOR_BORDER: Record<HighlightColor, string> = {
  red:    "border-l-red-500",
  amber:  "border-l-amber-500",
  green:  "border-l-green-500",
  blue:   "border-l-blue-500",
  purple: "border-l-purple-500",
  pink:   "border-l-pink-500",
};
const COLOR_DOT: Record<HighlightColor, string> = {
  red:    "bg-red-500",
  amber:  "bg-amber-500",
  green:  "bg-green-500",
  blue:   "bg-blue-500",
  purple: "bg-purple-500",
  pink:   "bg-pink-500",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function matchesFilter(msg: ReceivedMessage, filter: string): boolean {
  if (!filter.trim()) return true;
  const meta = msg.meta;
  const haystack = [
    msg.body, msg.queue,
    meta.message_id ?? "",
    meta.correlation_id ?? "",
    meta.content_type ?? "",
    ...Object.entries(meta.application_properties).map(([k, v]) => `${k}=${v}`),
  ].join("\n");
  try { return new RegExp(filter, "i").test(haystack); }
  catch { return haystack.toLowerCase().includes(filter.toLowerCase()); }
}

function ruleHaystack(msg: ReceivedMessage): string {
  const meta = msg.meta;
  return [
    msg.body, msg.queue,
    meta.message_id ?? "",
    meta.correlation_id ?? "",
    meta.content_type ?? "",
    ...Object.entries(meta.application_properties).map(([k, v]) => `${k}=${v}`),
  ].join("\n");
}

/**
 * Per-queue connection status tracked from the per-queue lifecycle events.
 * The Rust subscriber emits events with a `queue` field and we mirror state
 * here so the UI can show separate spinners / dots per subscription.
 */
interface QueueState {
  queue: string;
  reconnecting: boolean;
}

// ── component ────────────────────────────────────────────────────────────────

export default function SubscriberView({ connected, defaultAddress, pendingAddress, onLog, onMessageReceived, onReply }: Props) {
  const [picker,       setPicker]       = useState(defaultAddress);
  const [paused,       setPaused]       = useState(false);
  const [messages,     setMessages]     = useState<ReceivedMessage[]>([]);
  const [filter,       setFilter]       = useState("");
  const [filterErr,    setFilterErr]    = useState(false);
  const [autoScroll,   setAutoScroll]   = useState(true);
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);

  // Active queue subscriptions (multi-queue)
  const [queues, setQueues] = useState<QueueState[]>([]);
  const listening = queues.length > 0;

  // Diff feature: id of message marked as comparison reference + visible flag
  const [refId,         setRefId]         = useState<string | null>(null);
  const [diffOpen,      setDiffOpen]      = useState(false);

  // Session stats
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [sessionBytes, setSessionBytes] = useState(0);
  const [now,          setNow]          = useState(Date.now());
  const recentTsRef = useRef<number[]>([]);

  // Highlight rules
  const [rules,        setRules]        = useState<HighlightRule[]>(() => loadRules());
  const [rulesOpen,    setRulesOpen]    = useState(false);

  // Persistence toggle
  const [persistEnabled, setPersistEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(PERSIST_FLAG_KEY) === "1"; } catch { return false; }
  });

  // Export menu
  const [exportOpen,   setExportOpen]   = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Body viewer mode
  const [bodyMode,     setBodyMode]     = useState<"auto" | "raw" | "hex">("auto");

  const listEndRef = useRef<HTMLDivElement>(null);
  const pausedRef  = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const pendingNotif = useRef(0);
  const notifTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { saveRules(rules); }, [rules]);

  // Restore persisted messages on mount (opt-in)
  useEffect(() => {
    if (!persistEnabled) return;
    try {
      const raw = localStorage.getItem(PERSIST_DATA_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
        onLog("info", `Restored ${parsed.length} persisted message${parsed.length !== 1 ? "s" : ""}`);
      }
    } catch { /* ignore */ }
  }, []);

  // Persist messages to localStorage (debounced, capped to PERSIST_MAX_ENTRIES)
  useEffect(() => {
    if (!persistEnabled) return;
    const t = setTimeout(() => {
      try {
        const sliced = messages.slice(-PERSIST_MAX_ENTRIES);
        localStorage.setItem(PERSIST_DATA_KEY, JSON.stringify(sliced));
      } catch (e) {
        // localStorage quota errors are common with large bodies — log and disable
        onLog("err", `Persistence failed (storage full?): ${e}`);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [messages, persistEnabled]);

  // Toggle handler — also clears the stored snapshot when turning off
  function togglePersist() {
    setPersistEnabled(p => {
      const next = !p;
      try {
        localStorage.setItem(PERSIST_FLAG_KEY, next ? "1" : "0");
        if (!next) localStorage.removeItem(PERSIST_DATA_KEY);
      } catch {}
      onLog("info", next ? "Persistence enabled — messages saved across restarts" : "Persistence disabled");
      return next;
    });
  }

  // Reset body viewer mode when selection changes
  useEffect(() => { setBodyMode("auto"); }, [selectedId]);

  // Tick `now` every second while listening
  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [listening]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    function onClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [exportOpen]);

  useEffect(() => { if (!pendingAddress) return; setPicker(pendingAddress.address); }, [pendingAddress?.nonce]);
  useEffect(() => { if (autoScroll) listEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, autoScroll]);

  useEffect(() => {
    if (!filter) { setFilterErr(false); return; }
    try { new RegExp(filter); setFilterErr(false); }
    catch { setFilterErr(true); }
  }, [filter]);

  async function maybeNotify() {
    if (document.hasFocus()) return;
    pendingNotif.current += 1;
    if (notifTimer.current) clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(async () => {
      const count = pendingNotif.current;
      pendingNotif.current = 0;
      try {
        let permitted = await isPermissionGranted();
        if (!permitted) {
          const result = await requestPermission();
          permitted = result === "granted";
        }
        if (permitted) {
          sendNotification({
            title: "AMQPush",
            body: count === 1 ? "New message received" : `${count} new messages received`,
          });
        }
      } catch { /* notifications not available */ }
    }, 800);
  }

  // Refresh subscriber list from backend (after start/stop or on reconnects)
  async function refreshSubscriberList() {
    try {
      const list = await invoke<string[]>("list_subscribers");
      setQueues(prev => list.map(q => ({
        queue: q,
        reconnecting: prev.find(p => p.queue === q)?.reconnecting ?? false,
      })));
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const u1 = listen<ReceivedMessage>("message_received", e => {
      if (pausedRef.current) {
        setDroppedCount(c => c + 1);
        return;
      }
      const t = Date.now();
      recentTsRef.current = recentTsRef.current.filter(x => t - x <= 5000);
      recentTsRef.current.push(t);

      setMessages(prev => [...prev, e.payload]);
      setSessionBytes(b => b + e.payload.meta.body_size);
      maybeNotify();
      if (onMessageReceived) {
        onMessageReceived(e.payload.meta.body_size, e.payload.queue || "(unknown)");
      }
    });
    const u2 = listen<SubEvent>("subscriber_error", e => {
      onLog("err", `Subscriber error on '${e.payload.queue}': ${e.payload.message ?? "unknown"}`);
      setQueues(prev => prev.filter(q => q.queue !== e.payload.queue));
    });
    const u3 = listen<SubEvent>("subscriber_reconnecting", e => {
      setQueues(prev => prev.map(q => q.queue === e.payload.queue ? { ...q, reconnecting: true } : q));
      const ms = Number(e.payload.message ?? "0");
      onLog("info", `'${e.payload.queue}': lost connection, reconnecting in ${(ms / 1000).toFixed(0)}s…`);
    });
    const u4 = listen<SubEvent>("subscriber_reconnected", e => {
      setQueues(prev => prev.map(q => q.queue === e.payload.queue ? { ...q, reconnecting: false } : q));
      onLog("ok", `'${e.payload.queue}': reconnected`);
    });
    const u5 = listen<SubEvent>("subscriber_stopped", e => {
      setQueues(prev => prev.filter(q => q.queue !== e.payload.queue));
    });
    return () => {
      u1.then(f => f()); u2.then(f => f()); u3.then(f => f());
      u4.then(f => f()); u5.then(f => f());
      if (notifTimer.current) clearTimeout(notifTimer.current);
    };
  }, []);

  // Refresh subscriber list when component mounts or connection state changes,
  // so re-entering the view reflects what the backend actually has.
  useEffect(() => { if (connected) refreshSubscriberList(); }, [connected]);

  async function addSubscription() {
    if (!connected)        { onLog("err", "Not connected to broker"); return; }
    const addr = picker.trim();
    if (!addr)             { onLog("err", "Queue address is required"); return; }
    if (queues.some(q => q.queue === addr)) { onLog("err", `Already subscribed to '${addr}'`); return; }
    try {
      await invoke("start_subscriber", { address: addr });
      setQueues(prev => [...prev, { queue: addr, reconnecting: false }]);
      if (sessionStart === null) {
        setSessionStart(Date.now());
        setSessionBytes(0);
        recentTsRef.current = [];
      }
      onLog("ok", `Listening on '${addr}'…`);
    } catch (e) { onLog("err", `Subscriber failed: ${e}`); }
  }

  async function removeSubscription(addr: string) {
    try {
      await invoke("stop_subscriber", { address: addr });
      setQueues(prev => {
        const next = prev.filter(q => q.queue !== addr);
        if (next.length === 0) setSessionStart(null);
        return next;
      });
      onLog("info", `Stopped '${addr}'`);
    } catch (e) { onLog("err", String(e)); }
  }

  async function stopAll() {
    try {
      await invoke("stop_subscriber", { address: null });
      setQueues([]);
      setSessionStart(null);
      setPaused(false);
      setDroppedCount(0);
      onLog("info", "All subscribers stopped");
    } catch (e) { onLog("err", String(e)); }
  }

  function togglePause() {
    setPaused(p => {
      const next = !p;
      if (!next) setDroppedCount(0);
      onLog("info", next ? "Paused — incoming messages will be dropped" : "Resumed");
      return next;
    });
  }

  function clearMessages() {
    setMessages([]);
    setSelectedId(null);
    setRefId(null);
    setFilter("");
    setDroppedCount(0);
    setSessionBytes(0);
    setSessionStart(listening ? Date.now() : null);
    recentTsRef.current = [];
    if (persistEnabled) {
      try { localStorage.removeItem(PERSIST_DATA_KEY); } catch {}
    }
  }

  function downloadBlob(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amqpush-received-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    setExportOpen(false);
    downloadBlob(JSON.stringify(messages, null, 2), "application/json", "json");
    onLog("ok", `Exported ${messages.length} message${messages.length !== 1 ? "s" : ""} to JSON`);
  }

  function exportCsv() {
    setExportOpen(false);
    const header = [
      "id", "timestamp", "queue", "message_id", "correlation_id", "reply_to",
      "content_type", "body_size", "priority", "durable",
      "delivery_count", "creation_time", "body",
    ].join(",");
    const rows = messages.map(m => [
      csvEscape(m.id),
      csvEscape(m.timestamp),
      csvEscape(m.queue),
      csvEscape(m.meta.message_id ?? ""),
      csvEscape(m.meta.correlation_id ?? ""),
      csvEscape(m.meta.reply_to ?? ""),
      csvEscape(m.meta.content_type ?? ""),
      csvEscape(String(m.meta.body_size)),
      csvEscape(m.meta.priority?.toString() ?? ""),
      csvEscape(m.meta.durable?.toString() ?? ""),
      csvEscape(String(m.meta.delivery_count)),
      csvEscape(m.meta.creation_time ? new Date(m.meta.creation_time).toISOString() : ""),
      csvEscape(m.meta.body_text ?? m.body),
    ].join(",")).join("\n");
    downloadBlob(header + "\n" + rows, "text/csv", "csv");
    onLog("ok", `Exported ${messages.length} message${messages.length !== 1 ? "s" : ""} to CSV`);
  }

  function handleReply(msg: ReceivedMessage) {
    const replyTarget = msg.meta.reply_to;
    if (!replyTarget) {
      onLog("err", "This message has no reply-to address — cannot Reply");
      return;
    }
    if (!onReply) return;
    onReply({
      address: replyTarget,
      body: "",
      correlationId: msg.meta.correlation_id ?? msg.meta.message_id ?? undefined,
    });
    onLog("info", `Reply → ${replyTarget}${msg.meta.correlation_id ? `  (correlation-id: ${msg.meta.correlation_id})` : ""}`);
  }

  // Compile rules once
  const compiledRules = useMemo(() => rules
    .filter(r => r.enabled && r.pattern.trim())
    .map(r => {
      try { return { ...r, regex: new RegExp(r.pattern, "i") }; }
      catch { return null; }
    })
    .filter((r): r is HighlightRule & { regex: RegExp } => r !== null), [rules]);

  function matchRule(msg: ReceivedMessage): (HighlightRule & { regex: RegExp }) | null {
    const hay = ruleHaystack(msg);
    return compiledRules.find(r => r.regex.test(hay)) ?? null;
  }

  const filtered = filter && !filterErr
    ? messages.filter(m => matchesFilter(m, filter))
    : messages;
  const isFiltering = filter.trim().length > 0 && !filterErr;
  const selected = selectedId ? messages.find(m => m.id === selectedId) ?? null : null;
  const refMsg   = refId      ? messages.find(m => m.id === refId)      ?? null : null;

  // Session stats
  const sessionDurationMs = sessionStart ? now - sessionStart : 0;
  const recentRate = (() => {
    if (recentTsRef.current.length < 2) return 0;
    const window = (recentTsRef.current[recentTsRef.current.length - 1] - recentTsRef.current[0]) / 1000;
    return window > 0 ? recentTsRef.current.length / Math.max(window, 1) : 0;
  })();
  const avgSize = messages.length > 0 ? sessionBytes / messages.length : 0;

  const rulesActiveCount = rules.filter(r => r.enabled && r.pattern.trim()).length;
  const anyReconnecting = queues.some(q => q.reconnecting);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <span className="text-[10px] font-bold text-t-ink4 uppercase tracking-widest shrink-0">Queue</span>
        <QueuePicker value={picker} onChange={setPicker} connected={connected} disabled={false} showSave className="flex-1" />

        {listening && (
          <button
            onClick={togglePause}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors border ${
              paused
                ? "bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20"
                : "border-t-line text-t-ink3 hover:text-t-ink hover:bg-t-hover"
            }`}
            title={paused ? "Resume" : "Pause — drop incoming messages"}
          >
            {paused ? <><Play className="w-3 h-3" /> Resume</> : <><Pause className="w-3 h-3" /> Pause</>}
          </button>
        )}

        <button
          onClick={addSubscription}
          disabled={!connected}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-semibold bg-green-600 hover:bg-green-500 text-white transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          title={listening ? "Add another queue to listen to" : "Start listening on this queue"}
        >
          {listening ? <><Plus className="w-3.5 h-3.5" /> Add</> : <><Play className="w-3.5 h-3.5" /> Start</>}
        </button>

        {listening && (
          <button
            onClick={stopAll}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20 transition-colors"
            title="Stop all subscribers"
          >
            <Square className="w-3 h-3" /> Stop all
          </button>
        )}
      </div>

      {/* ─── ACTIVE SUBSCRIPTIONS BAR ─── */}
      {listening && (
        <div className={`shrink-0 px-3 py-1.5 border-b flex items-center gap-2 flex-wrap ${
          paused
            ? "bg-amber-500/5 border-amber-500/20"
            : anyReconnecting
              ? "bg-amber-500/5 border-amber-500/20"
              : "bg-green-500/5 border-green-500/15"
        }`}>
          {paused && (
            <span className="flex items-center gap-1 text-[11px] text-amber-500">
              <Pause className="w-3 h-3" /> Paused
              {droppedCount > 0 && <span className="text-amber-500/70">· {droppedCount} dropped</span>}
            </span>
          )}
          {!paused && (
            <span className="text-[11px] text-t-ink4 uppercase tracking-wider font-semibold mr-1">
              Listening
            </span>
          )}
          {/* Per-queue chips */}
          <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
            {queues.map(q => (
              <span key={q.queue}
                className={`group flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-mono text-[11px] ${
                  q.reconnecting
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                    : "bg-t-card border-t-line text-t-ink2"
                }`}
                title={q.reconnecting ? `Reconnecting to '${q.queue}'…` : `Listening on '${q.queue}'`}
              >
                {q.reconnecting
                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
                {q.queue}
                <button
                  onClick={() => removeSubscription(q.queue)}
                  className="opacity-50 group-hover:opacity-100 hover:text-red-500 transition-opacity"
                  title={`Stop '${q.queue}'`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Session stats */}
          <div className="ml-auto flex items-center gap-3 text-[11px] font-mono text-t-ink4 shrink-0">
            <span title="Total received this session"><span className="text-t-ink3">{messages.length}</span> msg</span>
            {sessionBytes > 0 && (
              <span title="Total bytes received"><span className="text-t-ink3">{fmtBytes(sessionBytes)}</span></span>
            )}
            {avgSize > 0 && (
              <span title="Average message size"><span className="text-t-ink5">avg</span> {fmtBytes(avgSize)}</span>
            )}
            {recentRate > 0 && (
              <span title="Rate over last 5s"><span className="text-t-ink3">{recentRate.toFixed(1)}</span><span className="text-t-ink5">/s</span></span>
            )}
            {sessionStart && (
              <span title="Session duration" className="text-t-ink5">{fmtDuration(sessionDurationMs)}</span>
            )}
          </div>
        </div>
      )}

      {/* ─── FILTER BAR ─── */}
      {messages.length > 0 && (
        <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
          <Search className={`w-3.5 h-3.5 shrink-0 ${filterErr ? "text-red-500" : "text-t-ink5"}`} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by body, queue, id, content-type, app-property…"
            className={`flex-1 bg-transparent text-xs text-t-ink outline-none placeholder:text-t-ink5 ${filterErr ? "text-red-500" : ""}`}
          />
          {filter && (
            <button onClick={() => setFilter("")} className="text-t-ink5 hover:text-t-ink3 transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
          {isFiltering && <span className="text-[11px] text-t-ink4 shrink-0">{filtered.length} / {messages.length}</span>}
          {filterErr && <span className="text-[11px] text-red-500 shrink-0">invalid regex</span>}
          <button
            onClick={() => setAutoScroll(a => !a)}
            className={`text-[11px] transition-colors px-1.5 py-0.5 rounded shrink-0 ${autoScroll ? "text-blue-500 bg-blue-500/10" : "text-t-ink5 hover:text-t-ink3"}`}
            title="Auto-scroll to newest"
          >
            {autoScroll ? "● auto" : "○ auto"}
          </button>

          <button
            onClick={togglePersist}
            className={`flex items-center gap-1 text-[11px] transition-colors px-1.5 py-0.5 rounded shrink-0 ${
              persistEnabled ? "text-blue-500 bg-blue-500/10" : "text-t-ink4 hover:text-t-ink3"
            }`}
            title={persistEnabled
              ? `Persistence on — last ${PERSIST_MAX_ENTRIES} messages saved across restarts`
              : `Click to save messages across app restarts (max ${PERSIST_MAX_ENTRIES})`
            }
          >
            <Database className="w-3 h-3" /> Persist
          </button>

          <button
            onClick={() => setRulesOpen(true)}
            className={`flex items-center gap-1 text-[11px] transition-colors px-1.5 py-0.5 rounded shrink-0 ${
              rulesActiveCount > 0 ? "text-blue-500 bg-blue-500/10" : "text-t-ink4 hover:text-t-ink3"
            }`}
            title={`Highlight rules ${rulesActiveCount > 0 ? `(${rulesActiveCount} active)` : ""}`}
          >
            <Palette className="w-3 h-3" /> Rules{rulesActiveCount > 0 && <span className="font-mono">{rulesActiveCount}</span>}
          </button>

          <div ref={exportMenuRef} className="relative shrink-0">
            <button onClick={() => setExportOpen(o => !o)}
              className="flex items-center gap-1 text-[11px] text-t-ink4 hover:text-blue-500 transition-colors px-1.5 py-0.5"
              title="Export received messages">
              <Download className="w-3 h-3" /> Export
              <ChevronDown className="w-3 h-3" />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-32 bg-t-card border border-t-line rounded-md shadow-lg overflow-hidden">
                <button onClick={exportJson}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-t-ink2 hover:bg-t-hover transition-colors">
                  JSON
                </button>
                <button onClick={exportCsv}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-t-ink2 hover:bg-t-hover transition-colors border-t border-t-line">
                  CSV
                </button>
              </div>
            )}
          </div>

          <button onClick={clearMessages}
            className="flex items-center gap-1 text-[11px] text-t-ink4 hover:text-red-500 transition-colors shrink-0">
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {/* ─── REFERENCE / DIFF BAR ─── */}
      {refMsg && (
        <div className="shrink-0 px-3 py-1 border-b border-t-line bg-blue-500/5 flex items-center gap-2 text-[11px]">
          <GitCompare className="w-3 h-3 text-blue-500" />
          <span className="text-t-ink4">Reference for diff:</span>
          <span className="font-mono text-t-ink2 truncate max-w-[300px]" title={refMsg.meta.message_id ?? ""}>
            {refMsg.meta.message_id ?? "(no message-id)"}
          </span>
          <span className="text-t-ink5 font-mono">{refMsg.queue}</span>
          {selected && selected.id !== refMsg.id && (
            <button
              onClick={() => setDiffOpen(true)}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
            >
              <GitCompare className="w-3 h-3" /> Compare with selected
            </button>
          )}
          <button
            onClick={() => setRefId(null)}
            className={`${selected && selected.id !== refMsg.id ? "" : "ml-auto"} text-t-ink4 hover:text-red-500 transition-colors`}
            title="Clear reference"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ─── BODY: split — left list / right preview ─── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ─── LEFT: MESSAGE LIST ─── */}
        <div className={`${selected ? "w-[42%] border-r border-t-line" : "flex-1"} flex flex-col min-w-0 min-h-0 overflow-hidden`}>
          {messages.length === 0 ? (
            <EmptyState
              icon={<Inbox className="w-8 h-8" />}
              title="No messages received"
              subtitle={listening ? "Send something to a subscribed queue" : "Pick a queue and click Start"}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Search className="w-8 h-8" />}
              title="No messages match filter"
              action={<button onClick={() => setFilter("")} className="text-[11px] text-blue-500 hover:text-blue-400 transition-colors">Clear filter</button>}
            />
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              {filtered.map(msg => {
                const isSel = selectedId === msg.id;
                const isRef = refId === msg.id;
                const idShort = msg.meta.message_id ?? "—";
                const ct = msg.meta.content_type ?? msg.meta.body_kind;
                const rule = matchRule(msg);
                const borderClass = rule
                  ? `border-l-2 ${COLOR_BORDER[rule.color]}`
                  : isRef
                    ? "border-l-2 border-l-blue-500"
                    : "border-l-2 border-l-transparent";
                return (
                  <button
                    key={msg.id}
                    onClick={() => setSelectedId(msg.id)}
                    className={`w-full text-left flex flex-col gap-0.5 px-3 py-2 border-b border-t-line/40 transition-colors ${borderClass} ${
                      isSel ? "bg-blue-500/10" : isRef ? "bg-blue-500/5" : "hover:bg-t-hover/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      {rule
                        ? <span className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT[rule.color]}`} title={`Rule: ${rule.name}`} />
                        : <MessageSquare className="w-3 h-3 text-t-ink5 shrink-0" />
                      }
                      <span className="text-t-ink2 font-mono truncate flex-1">{idShort}</span>
                      {isRef && <span className="text-[9px] uppercase tracking-wider text-blue-500 font-bold shrink-0">REF</span>}
                      <span className="text-t-ink5 font-mono shrink-0">{msg.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] pl-5">
                      {/* Queue chip — only show when multiple queues are subscribed */}
                      {queues.length > 1 && (
                        <span className="px-1 rounded bg-blue-500/15 text-blue-500 font-mono font-medium" title={`From queue: ${msg.queue}`}>
                          {msg.queue}
                        </span>
                      )}
                      <span className="px-1 rounded bg-t-hover text-t-ink3 font-mono">{ct}</span>
                      <span className="text-t-ink5 font-mono">{fmtBytes(msg.meta.body_size)}</span>
                      {msg.meta.priority !== null && msg.meta.priority !== 4 && (
                        <span className="text-t-ink4 font-mono">P{msg.meta.priority}</span>
                      )}
                      {msg.meta.reply_to && (
                        <span className="text-t-ink4 font-mono truncate" title={`reply-to: ${msg.meta.reply_to}`}>
                          ↩ {msg.meta.reply_to}
                        </span>
                      )}
                      {rule && (
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-t-ink3"
                          title={`Rule: ${rule.name} — pattern /${rule.pattern}/`}>
                          {rule.name}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              <div ref={listEndRef} />
            </div>
          )}
        </div>

        {/* ─── RIGHT: PREVIEW ─── */}
        {selected && (
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
              <span className="text-[12px] text-t-ink font-mono truncate" title={selected.meta.message_id ?? ""}>
                {selected.meta.message_id ?? "(no message-id)"}
              </span>
              <span className="text-[11px] text-t-ink5 font-mono shrink-0">{selected.timestamp}</span>
              <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-500 font-mono shrink-0" title={`Queue: ${selected.queue}`}>
                {selected.queue}
              </span>

              <div className="ml-auto flex items-center gap-1">
                {/* Diff: mark as ref OR compare to ref */}
                {refMsg && refMsg.id !== selected.id ? (
                  <button
                    onClick={() => setDiffOpen(true)}
                    title={`Compare to '${refMsg.meta.message_id ?? "ref"}'`}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-blue-500 hover:bg-blue-500/10 transition-colors"
                  >
                    <GitCompare className="w-3 h-3" /> Diff
                  </button>
                ) : (
                  <button
                    onClick={() => setRefId(refId === selected.id ? null : selected.id)}
                    title={refId === selected.id ? "Clear reference" : "Mark as comparison reference"}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      refId === selected.id ? "text-blue-500 bg-blue-500/10" : "text-t-ink4 hover:text-t-ink hover:bg-t-hover"
                    }`}
                  >
                    <GitCompare className="w-3 h-3" /> {refId === selected.id ? "Ref ✓" : "Mark ref"}
                  </button>
                )}

                {selected.meta.reply_to && onReply && (
                  <button
                    onClick={() => handleReply(selected)}
                    title={`Send a reply to '${selected.meta.reply_to}'${selected.meta.correlation_id ? ` (correlation-id: ${selected.meta.correlation_id})` : ""}`}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-blue-500 hover:bg-blue-500/10 transition-colors"
                  >
                    <CornerUpLeft className="w-3 h-3" /> Reply
                  </button>
                )}
                <button
                  onClick={() => navigator.clipboard.writeText(selected.meta.body_text ?? selected.body)}
                  title="Copy body"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <button
                  onClick={() => setSelectedId(null)}
                  title="Close preview"
                  className="p-1 rounded text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <PreviewDetails msg={selected} bodyMode={bodyMode} setBodyMode={setBodyMode} onLog={onLog} />
            </div>
          </div>
        )}
      </div>

      {rulesOpen && (
        <RulesModal
          rules={rules}
          onChange={setRules}
          onClose={() => setRulesOpen(false)}
        />
      )}

      {diffOpen && refMsg && selected && (
        <DiffModal
          left={refMsg}
          right={selected}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function PreviewDetails({ msg, bodyMode, setBodyMode, onLog }: {
  msg: ReceivedMessage;
  bodyMode: "auto" | "raw" | "hex";
  setBodyMode: (m: "auto" | "raw" | "hex") => void;
  onLog: (k: "info" | "ok" | "err", t: string) => void;
}) {
  const [propsOpen, setPropsOpen] = useState(true);
  const [appOpen,   setAppOpen]   = useState(true);
  const [bodyOpen,  setBodyOpen]  = useState(true);

  const meta = msg.meta;
  const appProps = Object.entries(meta.application_properties);

  const detected = detectFormat({ contentType: meta.content_type, bodyText: meta.body_text });
  const bodyContent = (() => {
    const raw = meta.body_text ?? "";
    if (!raw) return null;
    if (bodyMode === "hex") return hexDump(raw);
    if (bodyMode === "raw") return raw;
    if (detected === "json") return tryPrettyJson(raw) ?? raw;
    if (detected === "xml")  return tryPrettyXml(raw)  ?? raw;
    return raw;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-t-hover text-t-ink3 font-medium uppercase">{meta.body_kind}</span>
        <span className="text-t-ink5 font-mono">{fmtBytes(meta.body_size)}</span>
        {meta.delivery_count > 0 && (
          <span className="text-t-ink4" title="Delivery count">↻ {meta.delivery_count}</span>
        )}
        {meta.priority !== null && meta.priority !== 4 && (
          <span className="text-t-ink4">P{meta.priority}</span>
        )}
        {meta.durable && <span className="text-blue-500">durable</span>}
      </div>

      <CollapsibleSection
        title="Properties"
        icon={<Tag className="w-3 h-3" />}
        open={propsOpen}
        onToggle={() => setPropsOpen(o => !o)}
      >
        <PropsList onLog={onLog} items={[
          ["message-id",        meta.message_id],
          ["correlation-id",    meta.correlation_id],
          ["reply-to",          meta.reply_to],
          ["to",                meta.to],
          ["subject",           meta.subject],
          ["content-type",      meta.content_type],
          ["content-encoding",  meta.content_encoding],
          ["user-id",           meta.user_id],
          ["group-id",          meta.group_id],
          ["group-sequence",    meta.group_sequence?.toString() ?? null],
          ["reply-to-group-id", meta.reply_to_group_id],
          ["creation-time",     meta.creation_time ? new Date(meta.creation_time).toISOString() : null],
          ["absolute-expiry",   meta.absolute_expiry_time ? new Date(meta.absolute_expiry_time).toISOString() : null],
          ["priority",          meta.priority?.toString() ?? null],
          ["durable",           meta.durable?.toString() ?? null],
          ["ttl-ms",            meta.ttl_ms?.toString() ?? null],
          ["delivery-count",    meta.delivery_count.toString()],
        ]} />
      </CollapsibleSection>

      {appProps.length > 0 && (
        <CollapsibleSection
          title={`Application Properties (${appProps.length})`}
          icon={<Tag className="w-3 h-3" />}
          open={appOpen}
          onToggle={() => setAppOpen(o => !o)}
        >
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
            {meta.body_text && (
              <button onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(meta.body_text!);
                onLog("info", "Body copied");
              }}
                className="flex items-center gap-1 text-[10px] text-t-ink4 hover:text-t-ink2 transition-colors px-1.5 py-0.5 rounded hover:bg-t-hover">
                <Copy className="w-3 h-3" /> Copy
              </button>
            )}
          </div>
        }
      >
        <pre className="text-[11px] text-t-ink2 font-mono bg-t-field border border-t-line rounded-md p-2.5 overflow-x-auto whitespace-pre break-all max-h-80 overflow-y-auto select-text">
          {bodyContent ?? <em className="text-t-ink5">no body</em>}
        </pre>
        {msg.is_truncated && (
          <p className="text-[10px] text-amber-500 mt-1">⚠ Truncated for list display.</p>
        )}
      </CollapsibleSection>
    </div>
  );
}

// ── highlight rules modal ───────────────────────────────────────────────────

function RulesModal({ rules, onChange, onClose }: {
  rules: HighlightRule[];
  onChange: (r: HighlightRule[]) => void;
  onClose: () => void;
}) {
  function update(id: string, patch: Partial<HighlightRule>) {
    onChange(rules.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function remove(id: string) {
    onChange(rules.filter(r => r.id !== id));
  }
  function add() {
    const id = `r-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    onChange([...rules, { id, name: "New rule", pattern: "", color: "blue", enabled: true }]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-t-bg border border-t-line rounded-lg shadow-2xl w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">

        <div className="shrink-0 px-4 py-2.5 border-b border-t-line bg-t-panel flex items-center gap-2">
          <Palette className="w-3.5 h-3.5 text-t-ink4" />
          <span className="text-[13px] font-semibold text-t-ink">Highlight rules</span>
          <span className="text-[11px] text-t-ink5">— colour-tag matching messages in the list</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-t-hover text-t-ink4 hover:text-t-ink">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]">
          {rules.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-t-ink5 py-8">
              <Edit3 className="w-7 h-7 opacity-40 mb-3" />
              <p className="text-[13px]">No rules defined</p>
              <p className="text-[11px] mt-1">Each rule paints matching messages with its colour</p>
              <button onClick={add}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium">
                <Plus className="w-3 h-3" /> Add first rule
              </button>
            </div>
          ) : (
            rules.map(r => {
              let regexErr = "";
              if (r.enabled && r.pattern.trim()) {
                try { new RegExp(r.pattern); } catch (e) { regexErr = String(e).replace(/^SyntaxError:\s*/, ""); }
              }
              return (
                <div key={r.id} className={`border rounded-md p-2 bg-t-card/40 transition-colors ${
                  regexErr ? "border-red-500/40" : "border-t-line"
                }`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={e => update(r.id, { enabled: e.target.checked })}
                      className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                    />
                    <input
                      value={r.name}
                      onChange={e => update(r.id, { name: e.target.value })}
                      placeholder="Rule name"
                      className="bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 px-1.5 py-1 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30 flex-1 font-medium"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      {HIGHLIGHT_COLORS.map(c => (
                        <button key={c}
                          onClick={() => update(r.id, { color: c })}
                          title={c}
                          className={`w-4 h-4 rounded-full transition-all ${COLOR_DOT[c]} ${
                            r.color === c ? "ring-2 ring-offset-1 ring-offset-t-bg ring-blue-500 scale-110" : "opacity-60 hover:opacity-100"
                          }`} />
                      ))}
                    </div>
                    <button onClick={() => remove(r.id)}
                      className="p-1 text-t-ink5 hover:text-red-500 transition-colors rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 pl-6">
                    <input
                      value={r.pattern}
                      onChange={e => update(r.id, { pattern: e.target.value })}
                      placeholder="Regex pattern (case-insensitive) — matches body / queue / id / content-type / app-property values"
                      className="w-full bg-t-field border border-t-line2 rounded-md px-2 py-1 text-[11px] text-t-ink font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                    {regexErr && <p className="text-[10px] text-red-500 mt-1 font-mono">⚠ {regexErr}</p>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-t-line bg-t-panel flex items-center gap-2">
          {rules.length > 0 && (
            <button onClick={add}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-t-ink3 hover:text-t-ink hover:bg-t-hover transition-colors">
              <Plus className="w-3 h-3" /> Add rule
            </button>
          )}
          <span className="ml-auto text-[10px] text-t-ink5">Saved automatically</span>
          <button onClick={onClose}
            className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── diff modal ──────────────────────────────────────────────────────────────

/**
 * Simple line-by-line diff via Longest Common Subsequence (LCS). For body
 * comparison only — properties get a per-key diff in the table view.
 *
 * Returns operations: "eq" (line in both), "del" (only in left), "add" (only
 * in right). We use a O(n*m) DP over lines which is fine for typical message
 * payloads.
 */
type DiffOp = { kind: "eq" | "del" | "add"; left?: string; right?: string };
function diffLines(a: string, b: string): DiffOp[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = la.length, m = lb.length;
  // DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) { ops.push({ kind: "eq", left: la[i], right: lb[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: "del", left: la[i] }); i++; }
    else { ops.push({ kind: "add", right: lb[j] }); j++; }
  }
  while (i < n) { ops.push({ kind: "del", left: la[i++] }); }
  while (j < m) { ops.push({ kind: "add", right: lb[j++] }); }
  return ops;
}

function DiffModal({ left, right, onClose }: { left: ReceivedMessage; right: ReceivedMessage; onClose: () => void }) {
  // Properties diff — collect union of keys, mark equal/different/only-left/only-right
  const allKeys = useMemo(() => {
    const std = [
      "message-id", "correlation-id", "reply-to", "to", "subject", "content-type",
      "content-encoding", "user-id", "group-id", "group-sequence",
      "reply-to-group-id", "creation-time", "absolute-expiry", "priority",
      "durable", "ttl-ms", "delivery-count",
    ];
    const appKeys = new Set([
      ...Object.keys(left.meta.application_properties),
      ...Object.keys(right.meta.application_properties),
    ]);
    return { std, app: Array.from(appKeys).sort() };
  }, [left, right]);

  function stdProp(m: ReceivedMessage, k: string): string {
    const x = m.meta as any;
    switch (k) {
      case "message-id":        return x.message_id ?? "";
      case "correlation-id":    return x.correlation_id ?? "";
      case "reply-to":          return x.reply_to ?? "";
      case "to":                return x.to ?? "";
      case "subject":           return x.subject ?? "";
      case "content-type":      return x.content_type ?? "";
      case "content-encoding":  return x.content_encoding ?? "";
      case "user-id":           return x.user_id ?? "";
      case "group-id":          return x.group_id ?? "";
      case "group-sequence":    return x.group_sequence?.toString() ?? "";
      case "reply-to-group-id": return x.reply_to_group_id ?? "";
      case "creation-time":     return x.creation_time ? new Date(x.creation_time).toISOString() : "";
      case "absolute-expiry":   return x.absolute_expiry_time ? new Date(x.absolute_expiry_time).toISOString() : "";
      case "priority":          return x.priority?.toString() ?? "";
      case "durable":           return x.durable?.toString() ?? "";
      case "ttl-ms":            return x.ttl_ms?.toString() ?? "";
      case "delivery-count":    return x.delivery_count.toString();
      default:                  return "";
    }
  }

  // Body diff — try pretty-format both to align json/xml structure better
  const fmt = (m: ReceivedMessage) => {
    const raw = m.meta.body_text ?? "";
    const fmtType = detectFormat({ contentType: m.meta.content_type, bodyText: m.meta.body_text });
    if (fmtType === "json") return tryPrettyJson(raw) ?? raw;
    if (fmtType === "xml")  return tryPrettyXml(raw)  ?? raw;
    return raw;
  };
  const leftFmt  = fmt(left);
  const rightFmt = fmt(right);
  const ops = useMemo(() => diffLines(leftFmt, rightFmt), [leftFmt, rightFmt]);

  // Counts
  const propDiffCount = (() => {
    let n = 0;
    for (const k of allKeys.std) { if (stdProp(left, k) !== stdProp(right, k)) n++; }
    for (const k of allKeys.app) {
      const lv = left.meta.application_properties[k]  ?? "";
      const rv = right.meta.application_properties[k] ?? "";
      if (lv !== rv) n++;
    }
    return n;
  })();
  const bodyDiffCount = ops.filter(o => o.kind !== "eq").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-t-bg border border-t-line rounded-lg shadow-2xl w-[1040px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">

        <div className="shrink-0 px-4 py-2.5 border-b border-t-line bg-t-panel flex items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 text-t-ink4" />
          <span className="text-[13px] font-semibold text-t-ink">Compare messages</span>
          <span className="text-[11px] text-t-ink5">— {propDiffCount} property difference{propDiffCount !== 1 ? "s" : ""}, {bodyDiffCount} body line{bodyDiffCount !== 1 ? "s" : ""} differ</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-t-hover text-t-ink4 hover:text-t-ink">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Side-by-side headers */}
        <div className="shrink-0 grid grid-cols-2 gap-px bg-t-line border-b border-t-line">
          <div className="bg-t-panel px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-blue-500 font-bold">Reference</span>
              <span className="text-[11px] font-mono text-t-ink2 truncate">{left.meta.message_id ?? "(no id)"}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-t-ink5 font-mono">
              <span>{left.queue}</span>
              <span>{left.timestamp}</span>
              <span>{fmtBytes(left.meta.body_size)}</span>
            </div>
          </div>
          <div className="bg-t-panel px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-amber-500 font-bold">Selected</span>
              <span className="text-[11px] font-mono text-t-ink2 truncate">{right.meta.message_id ?? "(no id)"}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-t-ink5 font-mono">
              <span>{right.queue}</span>
              <span>{right.timestamp}</span>
              <span>{fmtBytes(right.meta.body_size)}</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Properties diff */}
          <div className="px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-t-ink4 font-semibold mb-1.5">Properties</p>
            <div className="font-mono text-[11px] space-y-px">
              {allKeys.std.map(k => {
                const lv = stdProp(left, k);
                const rv = stdProp(right, k);
                if (!lv && !rv) return null;
                const same = lv === rv;
                return (
                  <div key={k} className={`grid grid-cols-[120px_1fr_1fr] gap-2 py-0.5 px-1 rounded ${
                    same ? "" : "bg-amber-500/5"
                  }`}>
                    <span className="text-t-ink4">{k}</span>
                    <span className={`break-all ${same ? "text-t-ink3" : "text-blue-500"}`}>{lv || <em className="text-t-ink5">—</em>}</span>
                    <span className={`break-all ${same ? "text-t-ink3" : "text-amber-500"}`}>{rv || <em className="text-t-ink5">—</em>}</span>
                  </div>
                );
              })}
              {allKeys.app.length > 0 && (
                <p className="text-[10px] uppercase tracking-wider text-t-ink4 font-semibold mt-3 mb-1.5">Application properties</p>
              )}
              {allKeys.app.map(k => {
                const lv = left.meta.application_properties[k]  ?? "";
                const rv = right.meta.application_properties[k] ?? "";
                const same = lv === rv;
                return (
                  <div key={k} className={`grid grid-cols-[120px_1fr_1fr] gap-2 py-0.5 px-1 rounded ${
                    same ? "" : "bg-amber-500/5"
                  }`}>
                    <span className="text-t-ink4 truncate">{k}</span>
                    <span className={`break-all ${same ? "text-t-ink3" : "text-blue-500"}`}>{lv || <em className="text-t-ink5">—</em>}</span>
                    <span className={`break-all ${same ? "text-t-ink3" : "text-amber-500"}`}>{rv || <em className="text-t-ink5">—</em>}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Body diff */}
          <div className="px-3 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-t-ink4 font-semibold mb-1.5">Body (line diff, formatted)</p>
            <div className="font-mono text-[11px] bg-t-field border border-t-line rounded-md overflow-x-auto select-text">
              {ops.length === 0 ? (
                <p className="p-3 text-t-ink5 italic">Both bodies are empty</p>
              ) : (
                ops.map((o, i) => {
                  const cls =
                    o.kind === "eq"  ? "text-t-ink3" :
                    o.kind === "del" ? "bg-blue-500/15  text-blue-400 border-l-2 border-blue-500" :
                                       "bg-amber-500/15 text-amber-400 border-l-2 border-amber-500";
                  const prefix = o.kind === "eq" ? "  " : o.kind === "del" ? "− " : "+ ";
                  const text = o.kind === "del" ? o.left : o.kind === "add" ? o.right : o.left;
                  return (
                    <div key={i} className={`px-2 whitespace-pre ${cls}`}>
                      <span className="text-t-ink5">{prefix}</span>{text}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-3 py-2 border-t border-t-line bg-t-panel flex items-center justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
