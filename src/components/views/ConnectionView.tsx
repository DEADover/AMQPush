import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Save, Trash2, Plug, Unplug, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Profile } from "../../types";

interface Props {
  connected: boolean;
  onConnected: (addr: string) => void;
  onDisconnected: () => void;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
}

const LABEL = "block text-[11px] font-medium text-t-ink4 uppercase tracking-wider mb-1.5";
const INPUT  = "w-full bg-t-field border border-t-line2 rounded-md px-3 py-2 text-sm text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

export default function ConnectionView({ connected, onConnected, onDisconnected, onLog }: Props) {
  const [profiles,   setProfiles]   = useState<Profile[]>([]);
  const [sel,        setSel]        = useState("");
  const [connecting, setConnecting] = useState(false);
  const [host,       setHost]       = useState("127.0.0.1");
  const [port,       setPort]       = useState("61616");
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [queue,      setQueue]      = useState("test_queue");
  const [useTls,     setUseTls]     = useState(false);

  useEffect(() => { loadProfiles(); }, []);

  async function loadProfiles() {
    try {
      const list = await invoke<Profile[]>("get_profiles");
      setProfiles(list);
      if (list.length > 0 && !sel) { apply(list[0]); setSel(list[0].name); }
    } catch {}
  }

  function apply(p: Profile) {
    setHost(p.host); setPort(String(p.port));
    setUsername(p.username); setPassword(p.password);
    setQueue(p.queue); setUseTls(p.use_tls);
  }

  async function saveProfile() {
    let name = sel.trim();
    if (!name) { name = window.prompt("Profile name:") ?? ""; if (!name) return; }
    try {
      await invoke("save_profile", { profile: { name, host, port: Number(port), username, password, queue, use_tls: useTls } });
      await loadProfiles(); setSel(name);
      onLog("ok", `Profile '${name}' saved`);
    } catch (e) { onLog("err", String(e)); }
  }

  async function deleteProfile() {
    if (!sel) return;
    try { await invoke("delete_profile", { name: sel }); setSel(""); await loadProfiles(); }
    catch (e) { onLog("err", String(e)); }
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
      await invoke("connect", { host, port: Number(port), address: queue, username, password, useTls });
      onConnected(queue);
      onLog("ok", `Connected → ${host}:${port}  (${queue})`);
    } catch (e) {
      onLog("err", `Connection failed: ${e}`);
    } finally { setConnecting(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-lg">
      <h2 className="text-base font-semibold text-t-ink mb-6">Connection Settings</h2>

      {/* Status banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-6 text-sm ${
        connected
          ? "bg-green-500/10 border border-green-500/25 text-green-500"
          : "bg-t-card border border-t-line text-t-ink4"
      }`}>
        {connected
          ? <><CheckCircle2 className="w-4 h-4 shrink-0" /> Connected to {host}:{port}</>
          : <><XCircle      className="w-4 h-4 shrink-0" /> Not connected</>
        }
      </div>

      {/* Profile */}
      <div className="mb-5">
        <label className={LABEL}>Profile</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <select
              value={sel}
              onChange={e => { setSel(e.target.value); const p = profiles.find(x => x.name === e.target.value); if (p) apply(p); }}
              className={`${INPUT} pr-8 appearance-none cursor-pointer`}
            >
              <option value="">(no profile)</option>
              {profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-t-ink4 pointer-events-none" />
          </div>
          <button onClick={saveProfile}  className="px-3 py-2 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-t-ink hover:border-t-line2 transition-colors" title="Save"><Save    className="w-3.5 h-3.5" /></button>
          <button onClick={deleteProfile} disabled={!sel} className="px-3 py-2 rounded-md bg-t-card border border-t-line text-t-ink4 hover:text-red-500 hover:border-red-500/50 disabled:opacity-30 transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div><label className={LABEL}>Host</label><input value={host} onChange={e => setHost(e.target.value)} placeholder="127.0.0.1" className={INPUT} /></div>
        <div><label className={LABEL}>Port</label><input value={port} onChange={e => setPort(e.target.value)} placeholder="61616"     className={INPUT} /></div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div><label className={LABEL}>Username</label><input value={username} onChange={e => setUsername(e.target.value)} placeholder="optional" className={INPUT} /></div>
        <div><label className={LABEL}>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="optional" className={INPUT} /></div>
      </div>

      <div className="mb-5">
        <label className={LABEL}>Default Queue / Address</label>
        <input value={queue} onChange={e => setQueue(e.target.value)} placeholder="test_queue" className={INPUT} />
      </div>

      {/* TLS toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-t-card border border-t-line mb-6">
        <span className="text-sm text-t-ink2">TLS / AMQPS</span>
        <button
          onClick={() => setUseTls(!useTls)}
          style={{ height: "22px", width: "40px" }}
          className={`relative rounded-full transition-colors ${useTls ? "bg-blue-600" : "bg-t-active"}`}
        >
          <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${useTls ? "left-[21px]" : "left-[3px]"}`} />
        </button>
      </div>

      <button
        onClick={toggle}
        disabled={connecting}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 ${
          connected
            ? "bg-t-card border border-t-line2 text-t-ink2 hover:bg-t-hover"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        }`}
      >
        {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : connected ? <Unplug className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
        {connecting ? "Connecting…" : connected ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
