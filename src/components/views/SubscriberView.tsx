import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { Play, Square, Trash2, Copy, ChevronDown, ChevronRight, Inbox, Search, X, Loader2 } from "lucide-react";
import { ReceivedMessage } from "../../types";
import QueuePicker from "../QueuePicker";

interface Props {
  connected: boolean;
  defaultAddress: string;
  pendingAddress?: { address: string; nonce: number } | null;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onMessageCountChange: (n: number) => void;
  onMessageReceived?: (bytes: number, queue: string) => void;
}

function tryPrettyJson(s: string): string | null {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return null; }
}

function matchesFilter(msg: ReceivedMessage, filter: string): boolean {
  if (!filter.trim()) return true;
  try { return new RegExp(filter, "i").test(msg.body); }
  catch { return msg.body.toLowerCase().includes(filter.toLowerCase()); }
}

function MessageCard({ msg }: { msg: ReceivedMessage }) {
  const [expanded, setExpanded] = useState(false);
  const pretty = tryPrettyJson(msg.body);

  return (
    <div className="border border-t-line rounded-lg overflow-hidden hover:border-t-line2 transition-colors">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-t-hover transition-colors"
      >
        <span className="text-[11px] text-t-ink5 font-mono mt-0.5 shrink-0">{msg.timestamp}</span>
        <span className="text-[13px] text-t-ink2 truncate flex-1 font-mono">{msg.body}</span>
        {msg.is_truncated && <span className="text-[11px] text-amber-500 shrink-0">truncated</span>}
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-t-ink5 shrink-0 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 text-t-ink5 shrink-0 mt-0.5" />}
      </button>

      {expanded && (
        <div className="border-t border-t-line p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-t-ink5 font-mono">ID: {msg.id}</span>
            <button onClick={() => navigator.clipboard.writeText(msg.body)}
              className="flex items-center gap-1 text-[11px] text-t-ink4 hover:text-t-ink2 transition-colors">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <pre className="text-[11px] text-t-ink2 font-mono bg-t-card rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {pretty ?? msg.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SubscriberView({ connected, defaultAddress, pendingAddress, onLog, onMessageCountChange, onMessageReceived }: Props) {
  const [address,      setAddress]      = useState(defaultAddress);
  const [listening,    setListening]    = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [messages,     setMessages]     = useState<ReceivedMessage[]>([]);
  const [filter,       setFilter]       = useState("");
  const [filterErr,    setFilterErr]    = useState(false);
  const [autoScroll,   setAutoScroll]   = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pending notification burst (debounced)
  const pendingNotif = useRef(0);
  const notifTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!pendingAddress) return; setAddress(pendingAddress.address); }, [pendingAddress?.nonce]);
  useEffect(() => { onMessageCountChange(messages.length); }, [messages.length]);
  useEffect(() => { if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, autoScroll]);

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

  useEffect(() => {
    const u1 = listen<ReceivedMessage>("message_received", e => {
      setMessages(prev => [...prev, e.payload]);
      maybeNotify();
      if (onMessageReceived) {
        onMessageReceived(new TextEncoder().encode(e.payload.body).length, address || "(unknown)");
      }
    });
    const u2 = listen<string>("subscriber_error", e => {
      onLog("err", `Subscriber error: ${e.payload}`);
      setListening(false);
      setReconnecting(false);
    });
    const u3 = listen<number>("subscriber_reconnecting", e => {
      setReconnecting(true);
      onLog("info", `Connection lost, reconnecting in ${(e.payload / 1000).toFixed(0)}s…`);
    });
    const u4 = listen("subscriber_reconnected", () => {
      setReconnecting(false);
      onLog("ok", "Subscriber reconnected");
    });
    const u5 = listen("subscriber_stopped", () => {
      setListening(false);
      setReconnecting(false);
    });
    return () => {
      u1.then(f => f()); u2.then(f => f()); u3.then(f => f());
      u4.then(f => f()); u5.then(f => f());
      if (notifTimer.current) clearTimeout(notifTimer.current);
    };
  }, []);

  async function toggleSubscribe() {
    if (listening) {
      try { await invoke("stop_subscriber"); setListening(false); setReconnecting(false); onLog("info", "Subscriber stopped"); }
      catch (e) { onLog("err", String(e)); }
      return;
    }
    if (!connected)      { onLog("err", "Not connected to broker"); return; }
    if (!address.trim()) { onLog("err", "Queue address is required"); return; }
    try {
      await invoke("start_subscriber", { address: address.trim() });
      setListening(true);
      onLog("ok", `Listening on '${address}'…`);
    } catch (e) { onLog("err", `Subscriber failed: ${e}`); }
  }

  const filtered = filter && !filterErr
    ? messages.filter(m => matchesFilter(m, filter))
    : messages;
  const isFiltering = filter.trim().length > 0 && !filterErr;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR: Queue + Start/Stop button (Postman style) ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <span className="text-[10px] font-bold text-t-ink4 uppercase tracking-widest shrink-0">Queue</span>
        <QueuePicker value={address} onChange={setAddress} connected={connected} disabled={listening} showSave={!listening} className="flex-1" />
        <button
          onClick={toggleSubscribe}
          disabled={!connected && !listening}
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shadow-sm ${
            listening
              ? "bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20"
              : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {listening ? <><Square className="w-3.5 h-3.5" /> Stop</> : <><Play className="w-3.5 h-3.5" /> Start</>}
        </button>
      </div>

      {/* ─── STATUS BAR ─── */}
      {listening && (
        <div className={`shrink-0 px-3 py-1 border-b flex items-center gap-2 ${
          reconnecting
            ? "bg-amber-500/5 border-amber-500/20"
            : "bg-green-500/5 border-green-500/15"
        }`}>
          {reconnecting
            ? <><Loader2 className="w-3 h-3 text-amber-500 animate-spin" /><span className="text-[11px] text-amber-500">Reconnecting…</span></>
            : <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /><span className="text-[11px] text-green-500">Listening on <span className="font-mono">{address}</span></span></>
          }
          <span className="ml-auto text-[11px] text-t-ink4">{messages.length} received</span>
        </div>
      )}

      {/* ─── FILTER BAR (sub-toolbar style) ─── */}
      {messages.length > 0 && (
        <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
          <Search className={`w-3.5 h-3.5 shrink-0 ${filterErr ? "text-red-500" : "text-t-ink5"}`} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter messages (regex)…"
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
            title="Auto-scroll to newest messages"
          >
            {autoScroll ? "● auto" : "○ auto"}
          </button>
          <button onClick={() => { setMessages([]); onMessageCountChange(0); setFilter(""); }}
            className="flex items-center gap-1 text-[11px] text-t-ink4 hover:text-red-500 transition-colors shrink-0">
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {/* ─── MESSAGE LIST ─── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-t-ink5">
            <Inbox className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-[13px]">No messages received</p>
            <p className="text-[11px] mt-1">Start listening and send a message</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-t-ink5">
            <Search className="w-8 h-8 mb-3 opacity-40" />
            <p className="text-[13px]">No messages match filter</p>
            <button onClick={() => setFilter("")} className="text-[11px] text-blue-500 hover:text-blue-400 mt-1 transition-colors">Clear filter</button>
          </div>
        ) : (
          <>{filtered.map(msg => <MessageCard key={msg.id} msg={msg} />)}<div ref={bottomRef} /></>
        )}
      </div>
    </div>
  );
}
