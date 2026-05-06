import { useState, useCallback } from "react";
import { Zap, ChevronDown, ChevronUp, Sun, Moon, Monitor } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ConnectionView from "./components/views/ConnectionView";
import PublisherView from "./components/views/PublisherView";
import SubscriberView from "./components/views/SubscriberView";
import HistoryView from "./components/views/HistoryView";
import QueuesView from "./components/views/QueuesView";
import LogPanel from "./components/LogPanel";
import { useTheme } from "./hooks/useTheme";
import { LogEntry, View } from "./types";
import "./App.css";

let logId = 0;
function ts() { return new Date().toTimeString().slice(0, 8); }

const THEME_ICON  = { light: <Sun className="w-3.5 h-3.5" />, dark: <Moon className="w-3.5 h-3.5" />, system: <Monitor className="w-3.5 h-3.5" /> };
const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" };

export default function App() {
  const { mode, cycleMode } = useTheme();

  const [view,           setView]           = useState<View>("publisher");
  const [connected,      setConnected]      = useState(false);
  const [defaultAddress, setDefaultAddress] = useState("test_queue");
  const [msgCount,       setMsgCount]       = useState(0);
  const [logs,           setLogs]           = useState<LogEntry[]>([]);
  const [logOpen,        setLogOpen]        = useState(true);

  const [resendPayload, setResendPayload] = useState<{ address: string; body: string; nonce: number } | null>(null);
  const [pendingSubAddr, setPendingSubAddr] = useState<{ address: string; nonce: number } | null>(null);

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLogs(prev => [...prev.slice(-199), { id: ++logId, ts: ts(), kind, text }]);
  }, []);

  function handleConnected(addr: string) { setConnected(true); setDefaultAddress(addr); }
  function handleResend(address: string, body: string) { setResendPayload({ address, body, nonce: Date.now() }); setView("publisher"); }
  function handlePublishTo(address: string) { setResendPayload({ address, body: "", nonce: Date.now() }); setView("publisher"); }
  function handleSubscribeTo(address: string) { setPendingSubAddr({ address, nonce: Date.now() }); setView("subscriber"); }

  return (
    <div className="flex flex-col h-screen bg-t-bg overflow-hidden select-none">
      {/* Title bar */}
      <header className="h-10 shrink-0 flex items-center justify-between px-4 bg-t-panel border-b border-t-line">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center">
            <Zap className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold text-t-ink text-sm tracking-tight">AMQPush</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-t-ink5"}`} />
            <span className={`text-xs font-medium ${connected ? "text-green-500" : "text-t-ink4"}`}>
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>

          <button
            onClick={cycleMode}
            title={`Theme: ${THEME_LABEL[mode]} — click to cycle`}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors text-[11px]"
          >
            {THEME_ICON[mode]}
            <span className="hidden sm:inline">{THEME_LABEL[mode]}</span>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <Sidebar active={view} onChange={setView} msgCount={msgCount} />

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {view === "publisher"  && <PublisherView  connected={connected} defaultAddress={defaultAddress} resendPayload={resendPayload} onLog={addLog} onSent={() => {}} />}
            {view === "subscriber" && <SubscriberView connected={connected} defaultAddress={defaultAddress} pendingAddress={pendingSubAddr}   onLog={addLog} onMessageCountChange={setMsgCount} />}
            {view === "history"    && <HistoryView    connected={connected} onLog={addLog} onResend={handleResend} />}
            {view === "queues"     && <QueuesView     connected={connected} onLog={addLog} onPublishTo={handlePublishTo} onSubscribeTo={handleSubscribeTo} />}
            {view === "connection" && <ConnectionView connected={connected} onConnected={handleConnected} onDisconnected={() => setConnected(false)} onLog={addLog} />}
          </div>

          {/* Log console */}
          <div className="shrink-0 border-t border-t-line">
            <button
              onClick={() => setLogOpen(o => !o)}
              className="w-full flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold text-t-ink4 uppercase tracking-widest hover:text-t-ink2 transition-colors"
            >
              {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              Console
              {logs.length > 0 && (
                <span className="ml-auto normal-case text-[10px] font-normal text-t-ink5">
                  {logs.length} event{logs.length !== 1 ? "s" : ""}
                </span>
              )}
            </button>
            {logOpen && <LogPanel logs={logs} onClear={() => setLogs([])} />}
          </div>
        </div>
      </div>
    </div>
  );
}
