import { useState, useCallback, useEffect, useRef } from "react";
import { Sun, Moon, Monitor, Plug, ChevronDown, Check, User, Terminal } from "lucide-react";
import Sidebar from "./components/Sidebar";
import ConnectionView from "./components/views/ConnectionView";
import PublisherView from "./components/views/PublisherView";
import SubscriberView from "./components/views/SubscriberView";
import HistoryView from "./components/views/HistoryView";
import StatsView, { StatsData, emptyStats, trackSentInStats, trackReceivedInStats, trackSendErrorInStats } from "./components/views/StatsView";
import ConsoleView from "./components/views/ConsoleView";
import BrowserView from "./components/views/BrowserView";
import { useTheme } from "./hooks/useTheme";
import { LogEntry, View, Profile } from "./types";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

let logId = 0;
function ts() { return new Date().toTimeString().slice(0, 8); }

const VIEW_KEYS: Record<string, View> = {
  "1": "connection", "2": "publisher", "3": "subscriber", "4": "browser",
  "5": "history",    "6": "stats",     "7": "console",
};


const THEME_LABEL_FULL: Record<string, string> = { light: "Light", dark: "Dark", system: "Use system preference" };
const THEME_OPTIONS: Array<{ id: "light" | "dark" | "system"; label: string; icon: React.ReactNode }> = [
  { id: "light",  label: "Light",                  icon: <Sun     className="w-3.5 h-3.5" /> },
  { id: "dark",   label: "Dark",                   icon: <Moon    className="w-3.5 h-3.5" /> },
  { id: "system", label: "Use system preference",  icon: <Monitor className="w-3.5 h-3.5" /> },
];

export default function App() {
  const { mode, setMode } = useTheme();

  const [view,           setView]           = useState<View>("publisher");
  const [prevView,       setPrevView]       = useState<View>("publisher");
  const [connected,      setConnected]      = useState(false);
  const [defaultAddress, setDefaultAddress] = useState("test_queue");
  // Logs persist across restarts via localStorage (last 500 entries).
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    try {
      const raw = localStorage.getItem("amqpush.logs");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LogEntry[];
      // Bring logId past restored entries to avoid duplicate ids
      const maxId = parsed.reduce((m, l) => Math.max(m, l.id ?? 0), 0);
      logId = maxId;
      return parsed;
    } catch { return []; }
  });
  const [sendTrigger,    setSendTrigger]    = useState(0);
  const [stats,          setStats]          = useState<StatsData>(emptyStats);

  const [resendPayload,  setResendPayload]  = useState<{
    address: string;
    body: string;
    fileName?: string;
    fileDataB64?: string;
    properties?: Record<string, string>;
    /** Pre-fill standard AMQP correlation-id (used by Reply flow). */
    correlationId?: string;
    nonce: number;
  } | null>(null);
  const [pendingSubAddr, setPendingSubAddr] = useState<{ address: string; nonce: number } | null>(null);

  // Sidebar collapsed/expanded — persisted across sessions
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("amqpush.sidebarCollapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("amqpush.sidebarCollapsed", sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed]);

  // Connection form state — lifted to App so values persist across view switches
  const [connForm, setConnForm] = useState({
    host:     "127.0.0.1",
    port:     "5672",
    username: "",
    password: "",
    queue:    "",
    useTls:   false,
    containerId: "",
    heartbeatSecs: "",
    connectTimeoutSecs: "10",
    tlsSkipVerify: false,
    saslAnonymous: false,
  });

  // Track previous view to support Cmd+L toggle
  function changeView(v: View) {
    setPrevView(view);
    setView(v);
  }

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLogs(prev => [...prev.slice(-499), { id: ++logId, ts: ts(), kind, text }]);
  }, []);

  // Persist logs to localStorage — debounced, last 500 entries only
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem("amqpush.logs", JSON.stringify(logs.slice(-500)));
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [logs]);

  // History refresh trigger — increments after every successful send so HistoryView reloads
  const [historyVersion, setHistoryVersion] = useState(0);

  // Track stats — extended payload (queue, content kind) feeds richer Stats view
  const trackSent = useCallback((bytes: number, queue: string, kind: string = "text") => {
    setStats(s => trackSentInStats(s, bytes, queue, kind));
    setHistoryVersion(v => v + 1);
  }, []);

  const trackReceived = useCallback((bytes: number, queue: string = "(unknown)") => {
    setStats(s => trackReceivedInStats(s, bytes, queue));
  }, []);

  const trackSendError = useCallback(() => {
    setStats(s => trackSendErrorInStats(s));
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const targetView = VIEW_KEYS[e.key];
      if (targetView) { e.preventDefault(); changeView(targetView); return; }

      if (e.key === "Enter" && view === "publisher") {
        e.preventDefault(); setSendTrigger(n => n + 1); return;
      }
      // Cmd+L: toggle to/from console
      if (e.key === "l") {
        e.preventDefault();
        changeView(view === "console" ? prevView : "console");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, prevView]);

  function handleConnected(addr: string) { setConnected(true); setDefaultAddress(addr); setStats(emptyStats()); }
  function handleResend(arg: { address: string; body?: string; fileName?: string; fileDataB64?: string; properties?: Record<string, string>; correlationId?: string }) {
    setResendPayload({
      address: arg.address,
      body: arg.body ?? "",
      fileName: arg.fileName,
      fileDataB64: arg.fileDataB64,
      properties: arg.properties,
      correlationId: arg.correlationId,
      nonce: Date.now(),
    });
    changeView("publisher");
  }
  function handlePublishTo(address: string) { setResendPayload({ address, body: "", nonce: Date.now() }); changeView("publisher"); }
  function handleSubscribeTo(address: string) { setPendingSubAddr({ address, nonce: Date.now() }); changeView("subscriber"); }

  // ─── Profile management (lifted to App so status bar can switch quickly) ──
  const [profiles,      setProfiles]      = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("");

  const loadProfiles = useCallback(async () => {
    try { setProfiles(await invoke<Profile[]>("get_profiles")); }
    catch (e) { addLog("err", `Load profiles: ${e}`); }
  }, [addLog]);

  useEffect(() => { loadProfiles(); }, []);

  function applyProfile(p: Profile) {
    setConnForm({
      host: p.host,
      port: String(p.port),
      username: p.username,
      password: p.password,
      queue: p.queue,
      useTls: p.use_tls,
      containerId:        p.container_id ?? "",
      heartbeatSecs:      p.heartbeat_secs ? String(p.heartbeat_secs) : "",
      connectTimeoutSecs: p.connect_timeout_secs !== undefined ? String(p.connect_timeout_secs) : "10",
      tlsSkipVerify:      p.tls_skip_verify ?? false,
      saslAnonymous:      p.sasl_anonymous ?? false,
    });
    setActiveProfile(p.name);
  }

  // Persist active profile (any change — via header picker, ConnectionView, etc.)
  useEffect(() => {
    if (activeProfile) {
      try { localStorage.setItem("amqpush.lastProfile", activeProfile); } catch {}
    }
  }, [activeProfile]);

  // ─── Auto-connect to last used profile on startup ─────────────────────────
  // Runs once when profiles are first loaded — applies last-used profile and
  // attempts to connect with it.
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    if (profiles.length === 0) return;
    autoConnectAttempted.current = true;

    const lastName = localStorage.getItem("amqpush.lastProfile");
    let target: Profile | undefined;
    if (lastName) {
      target = profiles.find(p => p.name === lastName);
      if (!target) {
        addLog("info", `Last-used profile '${lastName}' is gone — picking first available`);
      }
    }
    // Fallback: if no lastProfile saved or it's missing, use the first profile
    if (!target) target = profiles[0];
    if (!target) return;

    applyProfile(target);
    addLog("info", `Auto-connecting to '${target.name}' (${target.host}:${target.port})…`);

    (async () => {
      try {
        await invoke("connect", {
          host: target.host, port: target.port, address: target.queue,
          username: target.username, password: target.password, useTls: target.use_tls,
          containerId: target.container_id ?? "",
          heartbeatSecs: target.heartbeat_secs ?? 0,
          connectTimeoutSecs: target.connect_timeout_secs ?? 10,
          saslAnonymous: target.sasl_anonymous ?? false,
        });
        handleConnected(target.queue);
        addLog("ok", `Auto-connected → ${target.host}:${target.port}${target.queue ? `  (${target.queue})` : ""}  via '${target.name}'`);
      } catch (e) {
        addLog("err", `Auto-connect to '${target.name}' failed: ${e}`);
      }
    })();
  }, [profiles]);

  // ─── Dropdown state for header (profile + theme) ──────────────────────────
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [themeMenuOpen,   setThemeMenuOpen]   = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef   = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setProfileMenuOpen(false);
      if (themeMenuRef.current   && !themeMenuRef.current.contains(e.target as Node))   setThemeMenuOpen(false);
    }
    if (profileMenuOpen || themeMenuOpen) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [profileMenuOpen, themeMenuOpen]);

  const themeOption = THEME_OPTIONS.find(t => t.id === mode) ?? THEME_OPTIONS[2];

  const publisherView = (
    <PublisherView
      connected={connected}
      defaultAddress={defaultAddress}
      activeProfile={activeProfile}
      resendPayload={resendPayload}
      sendTrigger={sendTrigger}
      onLog={addLog}
      onSent={trackSent}
      onSendError={trackSendError}
    />
  );

  const subscriberView = (
    <SubscriberView
      connected={connected}
      defaultAddress={defaultAddress}
      pendingAddress={pendingSubAddr}
      onLog={addLog}
      onMessageReceived={trackReceived}
      onReply={handleResend}
    />
  );

  // Recent log indicator (last entry kind for header dot)
  const lastLog = logs[logs.length - 1];
  const logDotColor = !lastLog ? "" :
    lastLog.kind === "err" ? "bg-red-500" :
    lastLog.kind === "ok"  ? "bg-green-500" :
    "bg-t-ink4";

  return (
    <div className="flex flex-col h-screen bg-t-bg overflow-hidden select-none">
      {/* Toolbar — system title bar above shows window title; here we only put controls */}
      <header className="h-10 shrink-0 flex items-center justify-between px-3 bg-t-panel border-b border-t-line">

        {/* ─── LEFT: Profile + Connection state ─── */}
        <div className="flex items-center gap-2">
          {/* Profile picker — globally visible across all views */}
          <div ref={profileMenuRef} className="relative">
            <button
              onClick={() => setProfileMenuOpen(o => !o)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-t-ink3 hover:text-t-ink hover:bg-t-hover transition-colors text-[12px] border border-t-line"
              title="Switch broker profile"
            >
              <User className="w-3 h-3 text-t-ink4" />
              <span className="font-medium">{activeProfile || <span className="italic text-t-ink5">no profile</span>}</span>
              <ChevronDown className="w-3 h-3 text-t-ink4" />
            </button>
            {profileMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-t-card border border-t-line rounded-md shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-t-ink5 font-semibold border-b border-t-line">
                  Broker profile
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {profiles.length === 0 ? (
                    <p className="text-[11px] text-t-ink5 text-center py-3">No saved profiles</p>
                  ) : profiles.map(p => (
                    <button key={p.name}
                      onClick={() => { applyProfile(p); setProfileMenuOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-t-hover transition-colors ${
                        p.name === activeProfile ? "bg-blue-500/5" : ""
                      }`}>
                      {p.name === activeProfile
                        ? <Check className="w-3 h-3 text-blue-500 shrink-0" />
                        : <span className="w-3 shrink-0" />}
                      <span className="text-[12px] text-t-ink truncate">{p.name}</span>
                      <span className="ml-auto text-[10px] text-t-ink5 font-mono shrink-0">{p.host}:{p.port}{p.use_tls ? " · TLS" : ""}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { changeView("connection"); setProfileMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-t-hover transition-colors border-t border-t-line text-[12px] text-blue-500"
                >
                  <Plug className="w-3 h-3" />
                  Manage profiles…
                </button>
              </div>
            )}
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-1.5 px-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-green-500" : "bg-t-ink5"}`} />
            <span className={`text-[11px] font-medium hidden sm:inline ${connected ? "text-green-500" : "text-t-ink4"}`}>
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>

        {/* ─── RIGHT: stats + console + theme ─── */}
        <div className="flex items-center gap-2">
          {(stats.sentCount > 0 || stats.receivedCount > 0) && (
            <span className="text-[11px] text-t-ink5 font-mono">
              ↑{stats.sentCount} ↓{stats.receivedCount}
            </span>
          )}

          {view !== "console" && (
            <button
              onClick={() => changeView("console")}
              title={`Logs — ${logs.length} event${logs.length !== 1 ? "s" : ""}  ⌘L`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-[11px] border ${
                lastLog?.kind === "err"
                  ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
                  : "border-t-line text-t-ink4 hover:text-t-ink hover:bg-t-hover"
              }`}
            >
              <Terminal className="w-3 h-3" />
              <span>Logs</span>
              {logs.length > 0 && (
                <>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${logDotColor}`} />
                  <span className="font-mono text-t-ink5">{logs.length}</span>
                </>
              )}
            </button>
          )}

          {/* Theme dropdown — explicit options instead of cycling */}
          <div ref={themeMenuRef} className="relative">
            <button
              onClick={() => setThemeMenuOpen(o => !o)}
              title={`Theme: ${THEME_LABEL_FULL[mode]}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors text-[11px]"
            >
              {themeOption.icon}
              <span className="hidden sm:inline">Theme</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {themeMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-t-card border border-t-line rounded-md shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-t-ink5 font-semibold border-b border-t-line">
                  Color theme
                </div>
                <div className="py-1">
                  {THEME_OPTIONS.map(opt => (
                    <button key={opt.id}
                      onClick={() => { setMode(opt.id); setThemeMenuOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-t-hover transition-colors ${
                        opt.id === mode ? "bg-blue-500/5" : ""
                      }`}>
                      {opt.id === mode
                        ? <Check className="w-3 h-3 text-blue-500 shrink-0" />
                        : <span className="w-3 shrink-0" />}
                      <span className="shrink-0 text-t-ink4">{opt.icon}</span>
                      <span className="text-[12px] text-t-ink2">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          active={view}
          onChange={changeView}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
        />

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/*
            All views stay mounted — visibility toggled via CSS so state is preserved
            across navigation. The container is a flex-row so split view can show
            publisher + subscriber side-by-side simultaneously.
          */}
          <div className="flex-1 overflow-hidden flex min-h-0">

            {/* Publisher pane */}
            <div className={view === "publisher" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              {publisherView}
            </div>

            {/* Subscriber pane */}
            <div className={view === "subscriber" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              {subscriberView}
            </div>

            {/* Browser */}
            <div className={view === "browser" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              <BrowserView connected={connected} visible={view === "browser"} onLog={addLog} onPublishTo={handlePublishTo} onSubscribeTo={handleSubscribeTo} />
            </div>

            {/* History */}
            <div className={view === "history" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              <HistoryView connected={connected} refreshVersion={historyVersion} onLog={addLog} onResend={handleResend} />
            </div>

            {/* Stats */}
            <div className={view === "stats" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              <StatsView stats={stats} />
            </div>

            {/* Console */}
            <div className={view === "console" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              <ConsoleView logs={logs} onClear={() => setLogs([])} />
            </div>

            {/* Connection */}
            <div className={view === "connection" ? "flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" : "hidden"}>
              <ConnectionView
                connected={connected}
                form={connForm}
                setForm={setConnForm}
                logs={logs}
                profiles={profiles}
                activeProfile={activeProfile}
                onProfilesChanged={loadProfiles}
                onProfileSelected={(name) => setActiveProfile(name)}
                onConnected={handleConnected}
                onDisconnected={() => setConnected(false)}
                onLog={addLog}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
