import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Save, Trash2, Plug, Unplug, Loader2, Settings2, Plus, Copy, Check, CheckCircle, XCircle, Info, Activity, SlidersHorizontal, Sliders } from "lucide-react";
import { Profile, LogEntry } from "../../types";
import Tabs, { TabItem } from "../Tabs";

type MainTab = "main" | "advanced";

export interface ConnForm {
  host: string;
  port: string;
  username: string;
  password: string;
  queue: string;          // optional — empty allowed
  useTls: boolean;

  // Advanced
  containerId: string;            // empty = auto-generated UUID
  heartbeatSecs: string;          // 0 / empty = disabled
  connectTimeoutSecs: string;     // 0 = no timeout
  tlsSkipVerify: boolean;
  saslAnonymous: boolean;
}

interface Props {
  connected: boolean;
  form: ConnForm;
  setForm: React.Dispatch<React.SetStateAction<ConnForm>>;
  logs: LogEntry[];
  profiles: Profile[];
  activeProfile: string;
  onProfilesChanged: () => Promise<void> | void;
  onProfileSelected: (name: string) => void;
  onConnected: (addr: string) => void;
  onDisconnected: () => void;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
}

const LABEL = "block text-[10px] font-bold text-t-ink4 uppercase tracking-widest mb-1.5";
const INPUT = "w-full bg-t-field border border-t-line2 rounded-md px-2.5 py-1.5 text-[12px] text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

const DEFAULTS: ConnForm = {
  host: "127.0.0.1",
  port: "61616",
  username: "",
  password: "",
  queue: "",
  useTls: false,
  containerId: "",
  heartbeatSecs: "",
  connectTimeoutSecs: "10",
  tlsSkipVerify: false,
  saslAnonymous: false,
};

// Heuristic: which log entries are "connection-related" — to filter the activity panel
const CONN_KEYWORDS = /connect|disconnect|broker|listen|subscriber|reconnect|profile|amqp|tls|auth|reachable|verify|discover/i;

export default function ConnectionView({ connected, form, setForm, logs, profiles, activeProfile, onProfilesChanged, onProfileSelected, onConnected, onDisconnected, onLog }: Props) {
  const sel = activeProfile;
  const setSel = onProfileSelected;
  const [loaded,      setLoaded]      = useState<Profile | null>(null); // last loaded — to detect unsaved changes
  const [pickerOpen,  setPickerOpen]  = useState(false);
  const [connecting,  setConnecting]  = useState(false);
  const [savingAs,    setSavingAs]    = useState(false);       // showing inline name prompt
  const [newName,     setNewName]     = useState("");
  const [confirmDel,  setConfirmDel]  = useState(false);       // delete confirmation

  // Form value shorthands — pull from props
  const { host, port, username, password, queue, useTls } = form;
  const { containerId, heartbeatSecs, connectTimeoutSecs, tlsSkipVerify, saslAnonymous } = form;
  const setHost     = (v: string) => setForm(f => ({ ...f, host: v }));
  const setPort     = (v: string) => setForm(f => ({ ...f, port: v }));
  const setUsername = (v: string) => setForm(f => ({ ...f, username: v }));
  const setPassword = (v: string) => setForm(f => ({ ...f, password: v }));
  const setQueue    = (v: string) => setForm(f => ({ ...f, queue: v }));
  const setUseTls   = (v: boolean) => setForm(f => ({ ...f, useTls: v }));
  const setContainerId        = (v: string)  => setForm(f => ({ ...f, containerId: v }));
  const setHeartbeatSecs      = (v: string)  => setForm(f => ({ ...f, heartbeatSecs: v }));
  const setConnectTimeoutSecs = (v: string)  => setForm(f => ({ ...f, connectTimeoutSecs: v }));
  const setTlsSkipVerify      = (v: boolean) => setForm(f => ({ ...f, tlsSkipVerify: v }));
  const setSaslAnonymous      = (v: boolean) => setForm(f => ({ ...f, saslAnonymous: v }));

  const [tab, setTab] = useState<MainTab>("main");
  // Detect if any "Advanced" field has a non-default value — show a dot on the Advanced tab
  const advancedDirty =
    !!queue ||
    useTls ||
    tlsSkipVerify ||
    !!containerId ||
    (Number(heartbeatSecs) || 0) > 0 ||
    (Number(connectTimeoutSecs) || 10) !== 10;

  const pickerRef = useRef<HTMLDivElement>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);

  // Auto-select first profile when list arrives and nothing's selected yet
  useEffect(() => {
    if (profiles.length > 0 && !sel) {
      apply(profiles[0]);
      setSel(profiles[0].name);
      setLoaded(profiles[0]);
    }
    // Sync `loaded` when activeProfile changes externally (e.g. via status bar)
    if (sel) {
      const p = profiles.find(p => p.name === sel);
      if (p && (!loaded || loaded.name !== sel)) {
        setLoaded(p);
      }
    }
  }, [profiles, sel]);

  // Close picker on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    if (pickerOpen) {
      document.addEventListener("mousedown", onClick);
      return () => document.removeEventListener("mousedown", onClick);
    }
  }, [pickerOpen]);

  function apply(p: Profile) {
    setForm({
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
  }

  function selectProfile(p: Profile) {
    apply(p);
    setSel(p.name);
    setLoaded(p);
    setPickerOpen(false);
  }

  function newProfile() {
    setForm(DEFAULTS);
    setSel("");
    setLoaded(null);
    setPickerOpen(false);
  }

  // Detect unsaved changes by comparing current form to loaded profile
  const dirty = useMemo(() => {
    if (!loaded) return false;
    return loaded.host !== host
        || loaded.port !== Number(port)
        || loaded.username !== username
        || loaded.password !== password
        || loaded.queue !== queue
        || loaded.use_tls !== useTls
        || (loaded.container_id ?? "") !== containerId
        || (loaded.heartbeat_secs ?? 0) !== (Number(heartbeatSecs) || 0)
        || (loaded.connect_timeout_secs ?? 10) !== (Number(connectTimeoutSecs) || 0)
        || (loaded.tls_skip_verify ?? false) !== tlsSkipVerify
        || (loaded.sasl_anonymous ?? false) !== saslAnonymous;
  }, [loaded, host, port, username, password, queue, useTls,
      containerId, heartbeatSecs, connectTimeoutSecs, tlsSkipVerify, saslAnonymous]);

  function buildProfile(name: string): Profile {
    return {
      name,
      host,
      port: Number(port) || 0,
      username,
      password,
      queue,
      use_tls: useTls,
      container_id: containerId,
      heartbeat_secs: Number(heartbeatSecs) || 0,
      connect_timeout_secs: Number(connectTimeoutSecs) || 0,
      tls_skip_verify: tlsSkipVerify,
      sasl_anonymous: saslAnonymous,
    };
  }

  // Save changes to currently selected profile
  async function saveChanges() {
    if (!sel) return startSaveAs();
    const p = buildProfile(sel);
    try {
      await invoke("save_profile", { profile: p });
      setLoaded(p);
      await onProfilesChanged();
      onLog("ok", `Profile '${sel}' updated`);
    } catch (e) { onLog("err", `Save failed: ${e}`); }
  }

  // Open inline "Save as…" prompt
  function startSaveAs(suggestedName?: string) {
    const existing = new Set(profiles.map(p => p.name));
    let baseName = suggestedName ?? (sel ? `${sel} (copy)` : `Profile ${profiles.length + 1}`);
    while (existing.has(baseName)) baseName += " (1)";
    setNewName(baseName);
    setSavingAs(true);
    setConfirmDel(false);
  }

  // Confirm new profile creation from inline prompt
  async function confirmSaveAs() {
    const name = newName.trim();
    if (!name) { setSavingAs(false); return; }
    const p = buildProfile(name);
    try {
      await invoke("save_profile", { profile: p });
      await onProfilesChanged();
      setSel(name);
      setLoaded(p);
      setSavingAs(false);
      setNewName("");
      onLog("ok", `Profile '${name}' saved`);
    } catch (e) { onLog("err", `Save failed: ${e}`); }
  }

  function duplicateProfile() {
    if (!sel) return;
    startSaveAs(`${sel} (copy)`);
  }

  function startDelete() {
    if (!sel) return;
    setConfirmDel(true);
    setSavingAs(false);
  }

  async function confirmDelete() {
    if (!sel) return;
    try {
      await invoke("delete_profile", { name: sel });
      onLog("info", `Profile '${sel}' deleted`);
      newProfile();
      await onProfilesChanged();
    } catch (e) { onLog("err", String(e)); }
    setConfirmDel(false);
  }

  async function toggle() {
    if (connected) {
      try { await invoke("disconnect"); onDisconnected(); onLog("info", "Disconnected"); }
      catch (e) { onLog("err", String(e)); }
      return;
    }
    setConnecting(true);
    onLog("info", `Connecting to ${host}:${port}…`);
    try {
      await invoke("connect", {
        host,
        port: Number(port),
        address: queue,
        username,
        password,
        useTls,
        containerId,
        heartbeatSecs:      Number(heartbeatSecs) || 0,
        connectTimeoutSecs: Number(connectTimeoutSecs) || 0,
        saslAnonymous,
      });
      onConnected(queue);
      onLog("ok", `Connected → ${host}:${port}${queue ? `  (${queue})` : ""}`);
    } catch (e) {
      onLog("err", `Connection failed: ${e}`);
    } finally { setConnecting(false); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <Settings2 className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
        <span className="text-[13px] font-semibold text-t-ink">Connection</span>

        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={toggle}
            disabled={connecting}
            className={`px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shrink-0 flex items-center gap-1.5 ${
              connected
                ? "bg-t-card border border-t-line2 text-t-ink2 hover:bg-t-hover"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : connected ? <Unplug className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
            {connecting ? "Connecting…" : connected ? "Disconnect" : "Connect"}
          </button>
        </div>
      </div>

      {/* ─── TABS — Main / Advanced ─── */}
      <Tabs
        tabs={[
          { id: "main",     label: "General", icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
          { id: "advanced", label: "Advanced",           icon: <Sliders className="w-3.5 h-3.5" />, dot: advancedDirty },
        ] as TabItem[]}
        active={tab}
        onChange={(id) => setTab(id as MainTab)}
      />

      {/* ─── FORM ─── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3">

        {tab === "main" && <>
        {/* ─── PROFILE PICKER ROW ─── */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1.5 h-4">
            <label className="text-[10px] font-bold text-t-ink4 uppercase tracking-widest leading-none">Profile</label>
            {dirty && sel && !savingAs && !confirmDel && (
              <span className="text-[10px] text-amber-500 flex items-center gap-1 normal-case font-normal leading-none">
                <span className="w-1 h-1 rounded-full bg-amber-500" /> Unsaved changes — click Save to update '{sel}'
              </span>
            )}
          </div>
          <div className="flex gap-1.5 items-stretch">

            {/* Custom dropdown */}
            <div ref={pickerRef} className="relative flex-1">
              <button
                onClick={() => setPickerOpen(o => !o)}
                className="w-full flex items-center gap-2 bg-t-field border border-t-line2 rounded-md px-2.5 py-1.5 text-[12px] text-t-ink hover:border-t-line2 transition-colors"
              >
                {sel ? (
                  <>
                    <span className="font-medium truncate">{sel}</span>
                    {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
                    <span className="ml-auto text-[11px] text-t-ink5 font-mono shrink-0">{loaded?.host}:{loaded?.port}</span>
                  </>
                ) : (
                  <span className="text-t-ink4 italic">No profile — using current form</span>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-t-ink4 shrink-0" />
              </button>

              {pickerOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-t-card border border-t-line rounded-md shadow-lg overflow-hidden">
                  {/* Profile list */}
                  <div className="max-h-64 overflow-y-auto">
                    {profiles.length === 0 ? (
                      <p className="text-[11px] text-t-ink5 text-center py-4">No saved profiles</p>
                    ) : profiles.map(p => (
                      <button key={p.name}
                        onClick={() => selectProfile(p)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-t-hover transition-colors ${
                          p.name === sel ? "bg-blue-500/5" : ""
                        }`}>
                        {p.name === sel ? <Check className="w-3 h-3 text-blue-500 shrink-0" /> : <span className="w-3 shrink-0" />}
                        <span className="text-[12px] text-t-ink truncate">{p.name}</span>
                        <span className="ml-auto text-[10px] text-t-ink5 font-mono shrink-0">{p.host}:{p.port}{p.use_tls && " · TLS"}</span>
                      </button>
                    ))}
                  </div>
                  {/* New profile at bottom */}
                  <button
                    onClick={newProfile}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-t-hover transition-colors border-t border-t-line text-blue-500"
                  >
                    <Plus className="w-3 h-3 shrink-0" />
                    <span className="text-[12px] font-medium">New profile</span>
                  </button>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <button
              onClick={saveChanges}
              disabled={!sel || !dirty}
              title={sel ? (dirty ? "Save changes" : "No changes to save") : "Use 'Save As' for new profiles"}
              className="px-2.5 py-1.5 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-blue-500 hover:border-blue-500/50 disabled:opacity-30 disabled:hover:text-t-ink4 disabled:hover:border-t-line transition-colors flex items-center gap-1 text-[11px] font-medium"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
            <button
              onClick={() => startSaveAs()}
              title="Save as new profile"
              className="px-2.5 py-1.5 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-t-ink hover:border-t-line2 transition-colors text-[11px] font-medium"
            >
              Save as…
            </button>
            <button
              onClick={duplicateProfile}
              disabled={!sel}
              title="Duplicate"
              className="px-2.5 py-1.5 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-t-ink hover:border-t-line2 disabled:opacity-30 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={startDelete}
              disabled={!sel}
              title="Delete profile"
              className="px-2.5 py-1.5 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-red-500 hover:border-red-500/50 disabled:opacity-30 disabled:hover:text-t-ink4 disabled:hover:border-t-line transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Inline name prompt for "Save as…" / Duplicate */}
          {savingAs && (
            <div className="mt-2 flex items-center gap-2 p-2 bg-blue-500/5 border border-blue-500/20 rounded-md">
              <span className="text-[11px] text-blue-500 font-medium shrink-0">New profile name:</span>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") confirmSaveAs();
                  if (e.key === "Escape") { setSavingAs(false); setNewName(""); }
                }}
                placeholder="Profile name…"
                className={`${INPUT} flex-1`}
              />
              <button onClick={confirmSaveAs} disabled={!newName.trim()}
                className="px-2.5 py-1.5 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-500 disabled:opacity-40 transition-colors">
                Save
              </button>
              <button onClick={() => { setSavingAs(false); setNewName(""); }}
                className="px-2 py-1.5 rounded-md text-t-ink4 hover:text-t-ink hover:bg-t-hover text-[11px] transition-colors">
                Cancel
              </button>
            </div>
          )}

          {/* Inline delete confirmation */}
          {confirmDel && sel && (
            <div className="mt-2 flex items-center gap-2 p-2 bg-red-500/5 border border-red-500/20 rounded-md">
              <span className="text-[11px] text-red-500 font-medium shrink-0">
                Delete profile '{sel}'?
              </span>
              <div className="ml-auto flex gap-1">
                <button onClick={confirmDelete}
                  className="px-2.5 py-1 rounded-md bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors">
                  Delete
                </button>
                <button onClick={() => setConfirmDel(false)}
                  className="px-2 py-1 rounded-md text-t-ink4 hover:text-t-ink hover:bg-t-hover text-[11px] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Server section */}
        <div className="mb-4">
          <span className="block text-[10px] font-bold text-t-ink4 uppercase tracking-widest mb-2">Server</span>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>Host <span className="text-red-500">*</span></label><input value={host} onChange={e => setHost(e.target.value)} placeholder="127.0.0.1" className={INPUT} /></div>
            <div><label className={LABEL}>Port <span className="text-red-500">*</span></label><input value={port} onChange={e => setPort(e.target.value)} placeholder="5672" className={INPUT} /></div>
          </div>
        </div>

        {/* Auth section */}
        <div className="mb-4">
          <span className="block text-[10px] font-bold text-t-ink4 uppercase tracking-widest mb-2">Authentication</span>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>Username</label><input value={username} disabled={saslAnonymous} onChange={e => setUsername(e.target.value)} placeholder="optional" className={`${INPUT} disabled:opacity-50`} /></div>
            <div><label className={LABEL}>Password</label><input type="password" value={password} disabled={saslAnonymous} onChange={e => setPassword(e.target.value)} placeholder="optional" className={`${INPUT} disabled:opacity-50`} /></div>
          </div>
        </div>

        {/* Security section */}
        <div className="mb-4">
          <span className="block text-[10px] font-bold text-t-ink4 uppercase tracking-widest mb-2">Security</span>

          {/* TLS / AMQPS toggle card */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-t-card border border-t-line mb-2">
            <div className="flex flex-col">
              <span className="text-[13px] text-t-ink2">TLS / AMQPS</span>
              <span className="text-[10px] text-t-ink5">Encrypt connection with TLS</span>
            </div>
            <button
              onClick={() => setUseTls(!useTls)}
              style={{ height: "22px", width: "40px" }}
              className={`relative rounded-full transition-colors shrink-0 ${useTls ? "bg-blue-600" : "bg-t-active"}`}
            >
              <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${useTls ? "left-[21px]" : "left-[3px]"}`} />
            </button>
          </div>

          {/* Skip cert verification — sub-option, only when TLS on */}
          {useTls && (
            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-t-ink3 px-2.5 mb-2">
              <input type="checkbox" checked={tlsSkipVerify} onChange={e => setTlsSkipVerify(e.target.checked)}
                className="w-3 h-3 accent-blue-600 cursor-pointer" />
              Skip certificate verification
              <span className="text-amber-500 text-[10px]">(insecure — only for self-signed/test brokers)</span>
            </label>
          )}

          {/* Force SASL ANONYMOUS — same toggle-card style */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-t-card border border-t-line">
            <div className="flex flex-col">
              <span className="text-[13px] text-t-ink2">Force SASL ANONYMOUS</span>
              <span className="text-[10px] text-t-ink5">Skip credentials and connect anonymously</span>
            </div>
            <button
              onClick={() => setSaslAnonymous(!saslAnonymous)}
              style={{ height: "22px", width: "40px" }}
              className={`relative rounded-full transition-colors shrink-0 ${saslAnonymous ? "bg-blue-600" : "bg-t-active"}`}
            >
              <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${saslAnonymous ? "left-[21px]" : "left-[3px]"}`} />
            </button>
          </div>
        </div>
        </>}

        {tab === "advanced" && <>
        {/* Default Queue (optional) */}
        <div className="mb-4">
          <label className={LABEL}>Default Queue / Address <span className="text-t-ink5 normal-case font-normal">— optional, used as initial Target in Send</span></label>
          <input value={queue} onChange={e => setQueue(e.target.value)} placeholder="(none)" className={INPUT} />
        </div>

        {/* Connection options */}
        <div className="mb-4">
          <span className="block text-[10px] font-bold text-t-ink4 uppercase tracking-widest mb-2">Connection options</span>
          <div className="space-y-3">
            <div>
              <label className={LABEL}>
                Container ID
                <span className="text-t-ink5 normal-case font-normal"> — appears in broker logs; auto-generated if empty</span>
              </label>
              <input value={containerId} onChange={e => setContainerId(e.target.value)}
                placeholder="auto: amqpush-<uuid>" className={`${INPUT} font-mono`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>
                  Heartbeat
                  <span className="text-t-ink5 normal-case font-normal"> — sec, 0 = off</span>
                </label>
                <input type="number" min="0" value={heartbeatSecs}
                  onChange={e => setHeartbeatSecs(e.target.value)}
                  placeholder="0" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>
                  Connect timeout
                  <span className="text-t-ink5 normal-case font-normal"> — sec</span>
                </label>
                <input type="number" min="0" value={connectTimeoutSecs}
                  onChange={e => setConnectTimeoutSecs(e.target.value)}
                  placeholder="10" className={INPUT} />
              </div>
            </div>
            <p className="text-[10px] text-t-ink5 leading-relaxed">
              <strong className="text-t-ink4">Heartbeat</strong> sends idle keepalive frames every N seconds — useful when a firewall/NAT closes idle TCP connections. Most brokers default to 30s.<br/>
              <strong className="text-t-ink4">Connect timeout</strong> aborts the initial connection attempt if it takes longer than N seconds. 0 disables the timeout.
            </p>
          </div>
        </div>
        </>}
      </div>

      {/* Activity panel stays in fixed position — independent of tab switching */}

      {/* ─── ACTIVITY LOG (footer panel) — last connection-related logs ─── */}
      <ActivityPanel logs={logs} bottomRef={logsBottomRef} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const LOG_ICON = {
  ok:   <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />,
  err:  <XCircle     className="w-3 h-3 text-red-500   shrink-0" />,
  info: <Info        className="w-3 h-3 text-t-ink4    shrink-0" />,
};
const LOG_COLOR = { ok: "text-green-500", err: "text-red-500", info: "text-t-ink3" };

function ActivityPanel({ logs, bottomRef }: { logs: LogEntry[]; bottomRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(true);

  // Filter to connection-related entries only, last 30
  const filtered = useMemo(
    () => logs.filter(l => CONN_KEYWORDS.test(l.text)).slice(-30),
    [logs]
  );

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length, open]);

  return (
    <div className="shrink-0 border-t border-t-line bg-t-panel">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-t-ink4 uppercase tracking-widest hover:text-t-ink2 transition-colors">
        <Activity className="w-3 h-3" />
        Activity
        <span className="ml-auto normal-case text-[10px] font-normal text-t-ink5">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}{!open && " — click to expand"}
        </span>
      </button>
      {open && (
        <div className="border-t border-t-line h-[120px] overflow-y-auto p-2 space-y-0.5 font-mono log-selectable">
          {filtered.length === 0 ? (
            <p className="text-[11px] text-t-ink5 text-center py-4">No connection events yet</p>
          ) : (
            <>
              {filtered.map(entry => (
                <div key={entry.id} className="flex items-center gap-2 text-[11px] leading-5">
                  <span className="text-t-ink5 shrink-0 font-mono">{entry.ts}</span>
                  {LOG_ICON[entry.kind]}
                  <span className={`${LOG_COLOR[entry.kind]} break-all`}>{entry.text}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
