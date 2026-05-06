import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Play, Square, Trash2, Copy, ChevronDown, ChevronRight, Inbox } from "lucide-react";
import { ReceivedMessage } from "../../types";
import QueuePicker from "../QueuePicker";

interface Props {
  connected: boolean;
  defaultAddress: string;
  pendingAddress?: { address: string; nonce: number } | null;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onMessageCountChange: (n: number) => void;
}

function tryPrettyJson(s: string): string | null {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return null; }
}

function MessageCard({ msg }: { msg: ReceivedMessage }) {
  const [expanded, setExpanded] = useState(false);
  const pretty = tryPrettyJson(msg.body);

  return (
    <div className="border border-t-line rounded-lg overflow-hidden hover:border-t-line2 transition-colors">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-t-hover transition-colors"
      >
        <span className="text-xs text-t-ink5 font-mono mt-0.5 shrink-0">{msg.timestamp}</span>
        <span className="text-sm text-t-ink2 truncate flex-1 font-mono">{msg.body}</span>
        {msg.is_truncated && <span className="text-xs text-amber-500 shrink-0">truncated</span>}
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-t-ink5 shrink-0 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 text-t-ink5 shrink-0 mt-0.5" />}
      </button>

      {expanded && (
        <div className="border-t border-t-line p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-t-ink5 font-mono">ID: {msg.id}</span>
            <button onClick={() => navigator.clipboard.writeText(msg.body)}
              className="flex items-center gap-1 text-xs text-t-ink4 hover:text-t-ink2 transition-colors">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <pre className="text-xs text-t-ink2 font-mono bg-t-card rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {pretty ?? msg.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SubscriberView({ connected, defaultAddress, pendingAddress, onLog, onMessageCountChange }: Props) {
  const [address,   setAddress]   = useState(defaultAddress);
  const [listening, setListening] = useState(false);
  const [messages,  setMessages]  = useState<ReceivedMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!pendingAddress) return; setAddress(pendingAddress.address); }, [pendingAddress?.nonce]);
  useEffect(() => { onMessageCountChange(messages.length); }, [messages.length]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  useEffect(() => {
    const u1 = listen<ReceivedMessage>("message_received", e => setMessages(prev => [...prev, e.payload]));
    const u2 = listen<string>("subscriber_error",  e => { onLog("err", `Subscriber error: ${e.payload}`); setListening(false); });
    const u3 = listen("subscriber_stopped",        () => setListening(false));
    return () => { u1.then(f => f()); u2.then(f => f()); u3.then(f => f()); };
  }, []);

  async function toggleSubscribe() {
    if (listening) {
      try { await invoke("stop_subscriber"); setListening(false); onLog("info", "Subscriber stopped"); }
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-t-line flex items-center gap-3">
        <span className="text-xs font-medium text-t-ink4 uppercase tracking-wider shrink-0">Queue</span>
        <QueuePicker value={address} onChange={setAddress} disabled={listening} showSave={!listening} className="flex-1" />
        <button
          onClick={toggleSubscribe}
          disabled={!connected && !listening}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap disabled:opacity-40 ${
            listening
              ? "bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20"
              : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {listening ? <><Square className="w-3.5 h-3.5" /> Stop</> : <><Play className="w-3.5 h-3.5" /> Start</>}
        </button>
      </div>

      {listening && (
        <div className="px-5 py-2 bg-green-500/5 border-b border-green-500/15 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-500">Listening on <span className="font-mono">{address}</span></span>
          <span className="ml-auto text-xs text-t-ink4">{messages.length} received</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-t-ink5">
            <Inbox className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No messages received</p>
            <p className="text-xs mt-1 text-t-ink5">Start listening and send a message</p>
          </div>
        ) : (
          <>{messages.map(msg => <MessageCard key={msg.id} msg={msg} />)}<div ref={bottomRef} /></>
        )}
      </div>

      {messages.length > 0 && (
        <div className="px-5 py-3 border-t border-t-line flex items-center justify-between shrink-0">
          <span className="text-xs text-t-ink4">{messages.length} message{messages.length !== 1 ? "s" : ""}</span>
          <button onClick={() => { setMessages([]); onMessageCountChange(0); }}
            className="flex items-center gap-1.5 text-xs text-t-ink4 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      )}
    </div>
  );
}
