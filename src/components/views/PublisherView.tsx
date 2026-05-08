import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Send, Plus, X, FileUp, Type, Repeat2,
  Wand2, BookMarked, Save, Trash2, Braces, CornerDownLeft, Loader2, Tag,
  CheckCircle, XCircle, Clock,
} from "lucide-react";
import { PropertyRow, SendResult, Template } from "../../types";
import QueuePicker from "../QueuePicker";
import { applyVariables, VARIABLE_HINTS, UserVariable } from "../../utils/variables";
import CodeEditor from "../CodeEditor";
import Tabs, { TabItem } from "../Tabs";

interface Props {
  connected: boolean;
  defaultAddress: string;
  activeProfile: string;
  resendPayload?: {
    address: string;
    body: string;
    fileName?: string;
    fileDataB64?: string;
    properties?: Record<string, string>;
    /** When set, becomes a `correlation-id` custom property pre-filled in Properties. */
    correlationId?: string;
    nonce: number;
  } | null;
  sendTrigger?: number;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onSent: (bytes: number, queue: string, kind?: string) => void;
  onSendError?: () => void;
}

const INPUT = "bg-t-field border border-t-line2 rounded-md px-2.5 py-1.5 text-[12px] text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

type BodyMode = "none" | "raw" | "binary";
type RawType  = "text" | "json" | "xml";
type ContentHint = "text" | "json" | "xml";
type TabKey = "body" | "properties" | "variables" | "batch" | "reply" | "templates";

const RAW_TYPE_LABEL: Record<RawType, string> = { text: "Text", json: "JSON", xml: "XML" };
const RAW_TYPE_CT:    Record<RawType, string | null> = {
  text: null, // no content-type
  json: "application/json",
  xml:  "application/xml",
};

let rowId = 0;

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function detectHint(s: string): ContentHint {
  const t = s.trim();
  if (!t) return "text";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return "xml";
  return "text";
}

function isValidJson(s: string) { try { JSON.parse(s); return true; } catch { return false; } }
function formatJson(s: string) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }

function isValidXml(s: string) {
  try {
    const doc = new DOMParser().parseFromString(s, "application/xml");
    return !doc.querySelector("parsererror");
  } catch { return false; }
}

function formatXml(raw: string): string {
  try {
    const doc = new DOMParser().parseFromString(raw.trim(), "application/xml");
    if (doc.querySelector("parsererror")) return raw;
    const serial = new XMLSerializer().serializeToString(doc);
    let depth = 0;
    return serial
      .replace(/>\s*</g, ">\n<")
      .split("\n")
      .map(line => {
        const t = line.trim();
        if (!t) return "";
        if (t.startsWith("</")) depth = Math.max(0, depth - 1);
        const out = "  ".repeat(depth) + t;
        if (t.startsWith("<") && !t.startsWith("</") && !t.startsWith("<?") && !t.endsWith("/>") && !t.includes("</")) depth++;
        return out;
      })
      .filter(Boolean)
      .join("\n");
  } catch { return raw; }
}

export default function PublisherView({ connected, defaultAddress, activeProfile, resendPayload, sendTrigger, onLog, onSent, onSendError }: Props) {
  const [address,    setAddress]    = useState(defaultAddress);
  const [tab,        setTab]        = useState<TabKey>("body");
  const [mode,       setMode]       = useState<BodyMode>("raw");
  const [rawType,    setRawType]    = useState<RawType>("json");
  const [rawTypeOpen,setRawTypeOpen]= useState(false);
  const [text,       setText]       = useState("");
  const [file,       setFile]       = useState<File | null>(null);
  const [props,      setProps]      = useState<PropertyRow[]>([]);
  const [userVars,   setUserVars]   = useState<UserVariable[]>([]);
  const [repeat,     setRepeat]     = useState("1");
  const [delayMs,    setDelayMs]    = useState("0");
  const [sending,    setSending]    = useState(false);

  // Send progress / status
  const [progress,   setProgress]   = useState<{ current: number; total: number } | null>(null);
  const [lastSend,   setLastSend]   = useState<{
    ok: boolean;
    count?: number;
    bytes?: number;
    durationMs?: number;
    error?: string;
    ts: string;
  } | null>(null);

  // Request-Reply
  const [rrEnabled,  setRrEnabled]  = useState(false);
  const [rrAddress,  setRrAddress]  = useState("");
  const [rrTimeout,  setRrTimeout]  = useState("5000");
  const [rrWaiting,  setRrWaiting]  = useState(false);
  const [rrReply,    setRrReply]    = useState<string | null>(null);
  const [rrTimedOut, setRrTimedOut] = useState(false);

  // Templates
  const [templates,  setTemplates]  = useState<Template[]>([]);
  const [savingTpl,  setSavingTpl]  = useState(false);
  const [newTplName, setNewTplName] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    try { setTemplates(await invoke<Template[]>("get_templates")); } catch { /* ignore */ }
  }

  // Resend payload from history
  useEffect(() => {
    if (!resendPayload) return;
    setAddress(resendPayload.address);

    // File resend — reconstruct File object from base64
    if (resendPayload.fileName && resendPayload.fileDataB64) {
      try {
        const bin = atob(resendPayload.fileDataB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const reconstructed = new File([bytes], resendPayload.fileName);
        setFile(reconstructed);
        setMode("binary");
        setText("");
      } catch (e) {
        onLog("err", `Failed to restore file: ${e}`);
      }
    } else {
      setText(resendPayload.body);
      setMode("raw");
      setFile(null);
    }

    // Restore custom properties (excluding internal markers)
    const propRows: PropertyRow[] = [];
    if (resendPayload.properties) {
      for (const [k, v] of Object.entries(resendPayload.properties)) {
        if (k === "is_file" || k === "_AMQ_ROUTING_TYPE" || k === "file_name") continue;
        // Skip correlation-id from resendPayload.properties since we set it
        // explicitly below (avoids duplicate row when Reply provides it).
        if (k === "correlation-id" && resendPayload.correlationId) continue;
        propRows.push({ id: ++rowId, enabled: true, key: k, value: v, description: "" });
      }
    }
    // Reply flow: pre-fill correlation-id as a custom property so the upstream
    // request-reply pattern keeps its tracking id.
    if (resendPayload.correlationId) {
      propRows.unshift({
        id: ++rowId, enabled: true,
        key: "correlation-id", value: resendPayload.correlationId,
        description: "From received message (reply)",
      });
    }
    setProps(propRows);

    setTab("body");
  }, [resendPayload?.nonce]);

  // Cmd+Enter trigger from App
  useEffect(() => {
    if (!sendTrigger) return;
    doSend();
  }, [sendTrigger]);

  const addProp    = useCallback(() => { setProps(p => [...p, { id: ++rowId, enabled: true, key: "", value: "", description: "" }]); }, []);
  const removeProp = useCallback((id: number) => setProps(p => p.filter(r => r.id !== id)), []);
  const updateProp = useCallback((id: number, f: keyof PropertyRow, v: string | boolean) =>
    setProps(p => p.map(r => r.id === id ? { ...r, [f]: v } : r)), []);
  function collectProps() {
    return Object.fromEntries(
      props.filter(r => r.enabled !== false && r.key.trim()).map(r => [r.key.trim(), r.value])
    );
  }
  const enabledPropsCount = props.filter(r => r.enabled !== false && r.key.trim()).length;

  // User variables CRUD
  const addUserVar    = useCallback(() => { setUserVars(p => [...p, { id: ++rowId, enabled: true, key: "", value: "", description: "" }]); }, []);
  const removeUserVar = useCallback((id: number) => setUserVars(p => p.filter(r => r.id !== id)), []);
  const updateUserVar = useCallback((id: number, f: keyof UserVariable, v: string | boolean) =>
    setUserVars(p => p.map(r => r.id === id ? { ...r, [f]: v } : r)), []);
  const insertPresetVar = useCallback((token: string, description: string) => {
    const key = token.replace(/^\{\{|\}\}$/g, "");
    setUserVars(p => p.find(r => r.key === key) ? p : [...p, { id: ++rowId, enabled: true, key, value: token, description }]);
  }, []);
  const enabledUserVarsCount = userVars.filter(v => v.enabled && v.key.trim()).length;

  async function toBase64(f: File): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
  }

  // Content type validation — based on explicit rawType
  const jsonValid = rawType !== "json" || !text.trim() || isValidJson(text);
  const xmlValid  = rawType !== "xml"  || !text.trim() || isValidXml(text);
  const textOk    = jsonValid && xmlValid;

  function handleFormat() {
    if (rawType === "json") setText(formatJson(text));
    else if (rawType === "xml") setText(formatXml(text));
  }

  // Templates
  async function saveAsTemplate() {
    if (!newTplName.trim()) return;
    const tpl: Template = {
      name: newTplName.trim(),
      address: address.trim(),
      body: text,
      properties: collectProps(),
    };
    try {
      await invoke("save_template", { template: tpl });
      await loadTemplates();
      setNewTplName("");
      setSavingTpl(false);
      onLog("ok", `Template "${tpl.name}" saved`);
    } catch (e) { onLog("err", String(e)); }
  }

  async function deleteTemplate(name: string) {
    try {
      await invoke("delete_template", { name });
      await loadTemplates();
      onLog("info", `Template "${name}" deleted`);
    } catch (e) { onLog("err", String(e)); }
  }

  function loadTemplate(tpl: Template) {
    setAddress(tpl.address);
    setText(tpl.body);
    setMode("raw");
    // Auto-detect type from body
    const detected = detectHint(tpl.body);
    setRawType(detected);
    const rows = Object.entries(tpl.properties).map(([k, v]) => ({ id: ++rowId, enabled: true, key: k, value: v, description: "" }));
    setProps(rows);
    onLog("info", `Template "${tpl.name}" loaded`);
    setTab("body");
  }

  async function doSend() {
    if (!connected)       { onLog("err", "Not connected"); return; }
    if (!address.trim())  { onLog("err", "Queue address is required"); return; }
    if (mode === "raw" && !text.trim()) { onLog("err", "Message body is empty"); return; }
    if (mode === "raw" && !textOk)      { onLog("err", rawType === "json" ? "Invalid JSON" : "Invalid XML"); return; }
    if (mode === "binary" && !file)     { onLog("err", "No file selected"); return; }
    const n = Math.max(1, Number(repeat) || 1);
    const delay = Math.max(0, Number(delayMs) || 0);
    const customProps = collectProps();
    // Auto content-type from rawType
    if (mode === "raw" && RAW_TYPE_CT[rawType] && !customProps["content-type"]) {
      customProps["content-type"] = RAW_TYPE_CT[rawType]!;
    }
    const replyTo = rrEnabled && rrAddress.trim() ? rrAddress.trim() : null;
    const startedAt = Date.now();
    setSending(true);
    setProgress({ current: 0, total: n });
    setLastSend(null);
    setRrReply(null);
    setRrTimedOut(false);
    try {
      let totalBytes = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0 && delay > 0) await new Promise(r => setTimeout(r, delay));
        setProgress({ current: i + 1, total: n });
        const resolvedText =
          mode === "raw"  ? applyVariables(text.trim(), userVars) :
          mode === "none" ? "" :
          null;
        const result = await invoke<SendResult>("send_message", mode === "binary" && file
          ? { address: address.trim(), text: null, fileName: file.name, fileDataB64: await toBase64(file), customProps, replyTo, profile: activeProfile || null }
          : { address: address.trim(), text: resolvedText, fileName: null, fileDataB64: null, customProps, replyTo, profile: activeProfile || null }
        );
        const bytes =
          mode === "raw" && resolvedText ? new TextEncoder().encode(resolvedText).length :
          mode === "binary" ? (file?.size ?? 0) : 0;
        totalBytes += bytes;
        onLog("ok", `Sent → ${result.address}  |  ${result.message_id}  |  ${result.timestamp}`);
      }
      // Determine kind for stats: "json"/"xml"/"text" for raw, "binary" for files, "none" otherwise
      const sendKind = mode === "binary" ? "binary" : mode === "none" ? "none" : rawType;
      onSent(totalBytes, address.trim(), sendKind);
      const durationMs = Date.now() - startedAt;
      setLastSend({ ok: true, count: n, bytes: totalBytes, durationMs, ts: new Date().toLocaleTimeString() });
      setProgress(null);

      if (rrEnabled && replyTo) {
        setRrWaiting(true);
        setSending(false);
        setTab("reply");
        try {
          const timeoutMs = Math.max(500, Number(rrTimeout) || 5000);
          const reply = await invoke<string | null>("await_reply", { address: replyTo, timeoutMs });
          if (reply === null) {
            setRrTimedOut(true);
            onLog("info", `Request-Reply: timed out waiting on '${replyTo}'`);
          } else {
            setRrReply(reply);
            onLog("ok", `Request-Reply: received reply on '${replyTo}'`);
          }
        } catch (e) {
          onLog("err", `Request-Reply error: ${e}`);
        } finally {
          setRrWaiting(false);
        }
        return;
      }
    } catch (e) {
      const msg = String(e);
      onLog("err", `Send failed: ${msg}`);
      setLastSend({ ok: false, error: msg, ts: new Date().toLocaleTimeString() });
      setProgress(null);
      onSendError?.();
    }
    finally { setSending(false); }
  }

  const hasVars = mode === "raw" && /\{\{.+?\}\}/.test(text);
  const batchActive = Number(repeat) > 1 || Number(delayMs) > 0;

  const tabs: TabItem[] = [
    { id: "body",       label: "Body",       icon: <Type className="w-3.5 h-3.5" /> },
    { id: "properties", label: "Properties", icon: <Tag className="w-3.5 h-3.5" />, badge: enabledPropsCount },
    { id: "variables",  label: "Variables",  icon: <Braces className="w-3.5 h-3.5" />, badge: enabledUserVarsCount, dot: hasVars && enabledUserVarsCount === 0 },
    { id: "batch",      label: "Batch",      icon: <Repeat2 className="w-3.5 h-3.5" />, dot: batchActive },
    { id: "reply",      label: "Reply",      icon: <CornerDownLeft className="w-3.5 h-3.5" />, dot: rrEnabled },
    { id: "templates",  label: "Templates",  icon: <BookMarked className="w-3.5 h-3.5" />, badge: templates.length },
  ];

  const sendDisabled = !connected || sending || (mode === "raw" && !!text && !textOk);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* ─── TOP BAR: address + Send button (Postman style) ─── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-t-line bg-t-panel flex items-center gap-2">
        <span className="text-[10px] font-bold text-t-ink4 uppercase tracking-widest shrink-0">Target</span>
        <QueuePicker value={address} onChange={setAddress} connected={connected} showSave className="flex-1" />
        <button
          onClick={doSend}
          disabled={sendDisabled}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          <Send className="w-3.5 h-3.5" />
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {/* ─── TABS ─── */}
      <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabKey)} />

      {/* ─── TAB CONTENT (flex-1, fills all available space) ─── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

        {/* BODY TAB */}
        {tab === "body" && (
          <div className="flex-1 min-h-0 flex flex-col">

            {/* Body sub-toolbar — Postman-style: radio modes + raw subtype dropdown + actions */}
            <div className="shrink-0 px-3 py-1.5 flex items-center gap-4 border-b border-t-line bg-t-panel">

              {/* Radio: none / raw / binary */}
              {(["none", "raw", "binary"] as BodyMode[]).map(m => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer text-[12px] group">
                  <input
                    type="radio"
                    name="bodyMode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="w-3 h-3 accent-blue-600 cursor-pointer"
                  />
                  <span className={mode === m ? "text-t-ink" : "text-t-ink3 group-hover:text-t-ink2 transition-colors"}>
                    {m}
                  </span>
                </label>
              ))}

              {/* Raw type dropdown — visible only when raw is selected */}
              {mode === "raw" && (
                <div className="relative">
                  <button
                    onClick={() => setRawTypeOpen(o => !o)}
                    onBlur={() => setTimeout(() => setRawTypeOpen(false), 150)}
                    className="flex items-center gap-1 text-[12px] text-blue-500 hover:text-blue-400 font-medium transition-colors"
                  >
                    {RAW_TYPE_LABEL[rawType]}
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                  </button>
                  {rawTypeOpen && (
                    <div className="absolute left-0 top-full mt-1 z-50 w-32 bg-t-card border border-t-line rounded-md shadow-lg overflow-hidden">
                      {(["text", "json", "xml"] as RawType[]).map(t => (
                        <button key={t}
                          onMouseDown={(e) => { e.preventDefault(); setRawType(t); setRawTypeOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-t-hover transition-colors ${
                            rawType === t ? "text-blue-500 bg-blue-500/5 font-medium" : "text-t-ink2"
                          }`}>
                          {RAW_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Right side: validation + Beautify */}
              <div className="ml-auto flex items-center gap-3">
                {mode === "raw" && rawType === "json" && text.trim() && (
                  <span className={`text-[11px] font-medium ${jsonValid ? "text-green-500" : "text-red-500"}`}>
                    {jsonValid ? "✓ valid" : "✗ invalid"}
                  </span>
                )}
                {mode === "raw" && rawType === "xml" && text.trim() && (
                  <span className={`text-[11px] font-medium ${xmlValid ? "text-green-500" : "text-red-500"}`}>
                    {xmlValid ? "✓ valid" : "✗ invalid"}
                  </span>
                )}
                {hasVars && (
                  <span className="flex items-center gap-1 text-[11px] text-blue-500 font-medium">
                    <Braces className="w-3 h-3" /> vars
                  </span>
                )}
                {mode === "raw" && rawType !== "text" && (
                  <button onClick={handleFormat}
                    className="flex items-center gap-1 text-[11px] text-t-ink4 hover:text-blue-500 transition-colors font-medium">
                    <Wand2 className="w-3 h-3" /> Beautify
                  </button>
                )}
              </div>
            </div>

            {/* None mode — empty body indicator */}
            {mode === "none" && (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-t-ink5 p-8">
                <Type className="w-8 h-8 mb-3 opacity-40" />
                <p className="text-[13px]">This message has no body</p>
                <p className="text-[11px] mt-1">An empty payload will be sent to the queue</p>
              </div>
            )}

            {/* Raw editor — flush, full-width, Postman style */}
            {mode === "raw" && (
              <div className="flex-1 min-h-0 flex flex-col">
                <CodeEditor
                  value={text}
                  onChange={v => setText(v)}
                  language={rawType === "json" ? "json" : rawType === "xml" ? "xml" : "text"}
                  placeholder={`Type your ${RAW_TYPE_LABEL[rawType]} message…`}
                  minHeight="120px"
                  className={`flex-1 ${text && !textOk ? "ring-1 ring-red-500/30" : ""}`}
                />
              </div>
            )}

            {/* Binary file picker */}
            {mode === "binary" && (
              <div className="flex-1 min-h-0 p-3">
                <div onClick={() => fileRef.current?.click()}
                  className="h-full flex flex-col items-center justify-center gap-3 border-2 border-dashed border-t-line2 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-t-hover transition-all">
                  <FileUp className="w-8 h-8 text-t-ink5" />
                  {file ? (
                    <div className="text-center">
                      <p className="text-[13px] text-t-ink font-medium">{file.name}</p>
                      <p className="text-[11px] text-t-ink4 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                      <button onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="mt-2 text-[11px] text-t-ink5 hover:text-red-500 transition-colors">Clear</button>
                    </div>
                  ) : (
                    <p className="text-[13px] text-t-ink5">Click to choose a file</p>
                  )}
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
          </div>
        )}

        {/* PROPERTIES TAB */}
        {tab === "properties" && (
          <div className="flex-1 min-h-0 flex flex-col">

            {/* Sub-toolbar */}
            <div className="shrink-0 px-3 py-1 flex items-center gap-2 border-b border-t-line bg-t-panel">
              <span className="text-[11px] text-t-ink4">Custom AMQP message properties — sent as application-properties.</span>
              <button onClick={addProp}
                className="ml-auto px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Column headers */}
              <div className="sticky top-0 z-10 grid grid-cols-[28px_1fr_1fr_1fr_28px] items-center gap-2 px-3 py-1.5 border-b border-t-line bg-t-panel text-[10px] font-semibold uppercase tracking-wider text-t-ink4">
                <div></div>
                <div>Key</div>
                <div>Value</div>
                <div>Description</div>
                <div></div>
              </div>

              {/* Rows */}
              {props.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-t-ink5">
                  <Tag className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-[13px]">No properties added</p>
                  <button onClick={addProp} className="text-[11px] text-blue-500 hover:text-blue-400 mt-2 transition-colors">+ Add your first property</button>
                </div>
              ) : (
                props.map(row => (
                  <div key={row.id}
                    className="grid grid-cols-[28px_1fr_1fr_1fr_28px] items-center gap-2 px-3 py-1 border-b border-t-line/60 hover:bg-t-hover/40 group">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input type="checkbox" checked={row.enabled !== false}
                        onChange={e => updateProp(row.id, "enabled", e.target.checked)}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                    </label>
                    <input value={row.key} onChange={e => updateProp(row.id, "key", e.target.value)}
                      placeholder="key"
                      className="bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 font-mono py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <input value={row.value} onChange={e => updateProp(row.id, "value", e.target.value)}
                      placeholder="value"
                      className="bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <input value={row.description ?? ""} onChange={e => updateProp(row.id, "description", e.target.value)}
                      placeholder="description"
                      className="bg-transparent text-[12px] text-t-ink3 outline-none placeholder:text-t-ink5 py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <button onClick={() => removeProp(row.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-t-ink5 hover:text-red-500 transition-all rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* VARIABLES TAB */}
        {tab === "variables" && (
          <div className="flex-1 min-h-0 flex flex-col">

            {/* Sub-toolbar: caption + Presets dropdown + Add */}
            <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
              <span className="text-[11px] text-t-ink4">
                Use <code className="text-blue-500 font-mono">{`{{name}}`}</code> in body — replaced on each send.
              </span>

              {/* Presets dropdown */}
              <div className="relative ml-auto group">
                <button className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors flex items-center gap-1 border border-t-line">
                  <Braces className="w-3 h-3" /> Built-in presets
                </button>
                <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-t-card border border-t-line rounded-lg shadow-lg overflow-hidden hidden group-focus-within:block group-hover:block">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-t-ink5 font-semibold border-b border-t-line">
                    Click to add as user variable
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {VARIABLE_HINTS.map(v => (
                      <button key={v.token} onClick={() => insertPresetVar(v.token, v.description)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-t-hover transition-colors text-left">
                        <code className="text-[11px] text-blue-500 font-mono shrink-0">{v.token}</code>
                        <span className="text-[10px] text-t-ink4 truncate">{v.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button onClick={addUserVar}
                className="px-2 py-1 rounded text-[11px] font-medium text-t-ink4 hover:text-t-ink hover:bg-t-hover transition-colors flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            {/* Table-style variables list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Column headers */}
              <div className="sticky top-0 z-10 grid grid-cols-[28px_1fr_1fr_1fr_28px] items-center gap-2 px-3 py-1.5 border-b border-t-line bg-t-panel text-[10px] font-semibold uppercase tracking-wider text-t-ink4">
                <div></div>
                <div>Key</div>
                <div>Value</div>
                <div>Description</div>
                <div></div>
              </div>

              {/* Rows */}
              {userVars.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-t-ink5">
                  <Braces className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-[13px]">No variables defined</p>
                  <button onClick={addUserVar} className="text-[11px] text-blue-500 hover:text-blue-400 mt-2 transition-colors">+ Add your first variable</button>
                  <p className="text-[10px] text-t-ink5 mt-3">Or pick a built-in preset from the dropdown above</p>
                </div>
              ) : (
                userVars.map(v => (
                  <div key={v.id}
                    className="grid grid-cols-[28px_1fr_1fr_1fr_28px] items-center gap-2 px-3 py-1 border-b border-t-line/60 hover:bg-t-hover/40 group">
                    {/* Enabled checkbox */}
                    <label className="flex items-center justify-center cursor-pointer">
                      <input type="checkbox" checked={v.enabled}
                        onChange={e => updateUserVar(v.id, "enabled", e.target.checked)}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                    </label>
                    <input value={v.key} onChange={e => updateUserVar(v.id, "key", e.target.value)}
                      placeholder="key"
                      className="bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 font-mono py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <input value={v.value} onChange={e => updateUserVar(v.id, "value", e.target.value)}
                      placeholder="value"
                      className="bg-transparent text-[12px] text-t-ink outline-none placeholder:text-t-ink5 py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <input value={v.description} onChange={e => updateUserVar(v.id, "description", e.target.value)}
                      placeholder="description"
                      className="bg-transparent text-[12px] text-t-ink3 outline-none placeholder:text-t-ink5 py-1.5 px-1.5 rounded hover:bg-t-card focus:bg-t-field focus:ring-1 focus:ring-blue-500/30" />
                    <button onClick={() => removeUserVar(v.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-t-ink5 hover:text-red-500 transition-all rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* BATCH TAB */}
        {tab === "batch" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel">
              <span className="text-[11px] text-t-ink4">Send the same message multiple times with optional delay.</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-t-ink4 uppercase tracking-wider mb-1.5">Repeat count</label>
                <input type="number" min="1" value={repeat} onChange={e => setRepeat(e.target.value)}
                  className={`${INPUT} w-32`} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-t-ink4 uppercase tracking-wider mb-1.5">Delay between messages (ms)</label>
                <input type="number" min="0" value={delayMs} onChange={e => setDelayMs(e.target.value)}
                  className={`${INPUT} w-32`} />
              </div>
              {batchActive && (
                <div className="px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded-md">
                  <p className="text-xs text-blue-400">
                    Will send <span className="font-mono font-bold">{repeat}</span> messages
                    {Number(delayMs) > 0 && <> with <span className="font-mono">{delayMs}ms</span> delay between them</>}.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* REPLY TAB */}
        {tab === "reply" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
              <span className="text-[11px] text-t-ink4">Wait for a reply on a separate queue after sending.</span>
              <label className="ml-auto flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] text-t-ink3">Enabled</span>
                <div onClick={() => setRrEnabled(e => !e)}
                  className={`relative w-8 h-4 rounded-full transition-colors ${rrEnabled ? "bg-blue-600" : "bg-t-active"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-all ${rrEnabled ? "translate-x-4" : "translate-x-0"}`} />
                </div>
              </label>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-t-ink4 uppercase tracking-wider mb-1.5">Reply-to address</label>
                <input value={rrAddress} onChange={e => setRrAddress(e.target.value)} disabled={!rrEnabled}
                  placeholder="reply_queue or temp address…"
                  className={`${INPUT} w-full disabled:opacity-50`} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-t-ink4 uppercase tracking-wider mb-1.5">Timeout (ms)</label>
                <input type="number" min="500" value={rrTimeout} onChange={e => setRrTimeout(e.target.value)} disabled={!rrEnabled}
                  className={`${INPUT} w-32 disabled:opacity-50`} />
              </div>

              {rrWaiting && (
                <div className="flex items-center gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-md">
                  <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                  <span className="text-xs text-blue-400">Waiting for reply on <span className="font-mono">{rrAddress}</span>…</span>
                </div>
              )}
              {rrTimedOut && !rrWaiting && (
                <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-md">
                  <span className="text-xs text-amber-500">⏱ Timed out — no reply received within {rrTimeout}ms</span>
                </div>
              )}
              {rrReply !== null && !rrWaiting && (
                <div className="rounded-md overflow-hidden border border-green-500/25">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-green-500/5 border-b border-green-500/20">
                    <span className="text-xs text-green-500 font-medium">✓ Reply received</span>
                    <button onClick={() => navigator.clipboard.writeText(rrReply!)} className="text-[10px] text-t-ink4 hover:text-t-ink2 transition-colors">Copy</button>
                  </div>
                  <pre className="p-3 text-xs font-mono text-t-ink2 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                    {(() => { try { return JSON.stringify(JSON.parse(rrReply!), null, 2); } catch { return rrReply!; } })()}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TEMPLATES TAB */}
        {tab === "templates" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 px-3 py-1 border-b border-t-line bg-t-panel flex items-center gap-2">
              <span className="text-[11px] text-t-ink4">Saved message templates</span>
              <div className="ml-auto">
                {savingTpl ? (
                  <div className="flex gap-1.5">
                    <input autoFocus value={newTplName} onChange={e => setNewTplName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveAsTemplate(); if (e.key === "Escape") setSavingTpl(false); }}
                      placeholder="Template name…" className={`${INPUT} text-xs py-1 w-40`} />
                    <button onClick={saveAsTemplate} className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500">Save</button>
                    <button onClick={() => setSavingTpl(false)} className="px-2 py-1 text-t-ink4 text-xs hover:text-t-ink rounded hover:bg-t-hover">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setSavingTpl(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-t-ink3 hover:text-t-ink hover:bg-t-hover transition-colors">
                    <Save className="w-3 h-3" /> Save current
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2">
              {templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-t-ink5">
                  <BookMarked className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-[13px]">No templates saved yet</p>
                  <p className="text-[11px] mt-1">Click "Save current" above to save one</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {templates.map(tpl => (
                    <div key={tpl.name} className="flex items-center gap-2 px-3 py-2 hover:bg-t-hover rounded-md group transition-colors border border-transparent hover:border-t-line">
                      <button onClick={() => loadTemplate(tpl)} className="flex-1 text-left min-w-0">
                        <p className="text-[13px] font-medium text-t-ink truncate">{tpl.name}</p>
                        <p className="text-[10px] text-t-ink5 font-mono truncate">{tpl.address || "no address"}</p>
                      </button>
                      <button onClick={() => deleteTemplate(tpl.name)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-t-ink5 hover:text-red-500 transition-all rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── STATUS BAR ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-1.5 border-t border-t-line bg-t-panel flex items-center gap-2 text-[11px] font-mono">
        {sending && progress ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />
            <span className="text-blue-500">
              Sending {progress.current} / {progress.total}
              {progress.total > 1 && (
                <span className="text-blue-500/60 ml-1">
                  ({Math.round((progress.current / progress.total) * 100)}%)
                </span>
              )}
            </span>
            {progress.total > 1 && (
              <div className="ml-2 flex-1 max-w-[200px] h-1 bg-blue-500/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            )}
          </>
        ) : rrWaiting ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-amber-500 shrink-0" />
            <span className="text-amber-500">Waiting for reply on <span className="text-amber-400">{rrAddress}</span> …</span>
          </>
        ) : rrReply !== null ? (
          <>
            <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
            <span className="text-green-500">Reply received</span>
            <span className="text-t-ink5">·</span>
            <span className="text-t-ink4">{new TextEncoder().encode(rrReply).length} B</span>
          </>
        ) : rrTimedOut ? (
          <>
            <Clock className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="text-amber-500">Reply timed out after {rrTimeout}ms</span>
          </>
        ) : lastSend?.ok ? (
          <>
            <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
            <span className="text-green-500">
              Sent {lastSend.count} message{(lastSend.count ?? 0) > 1 ? "s" : ""}
            </span>
            {(lastSend.bytes ?? 0) > 0 && (
              <>
                <span className="text-t-ink5">·</span>
                <span className="text-t-ink3">{fmtBytes(lastSend.bytes!)}</span>
              </>
            )}
            {lastSend.durationMs !== undefined && (
              <>
                <span className="text-t-ink5">·</span>
                <span className="text-t-ink3">{fmtDuration(lastSend.durationMs)}</span>
              </>
            )}
            <span className="text-t-ink5">at {lastSend.ts}</span>
          </>
        ) : lastSend && !lastSend.ok ? (
          <>
            <XCircle className="w-3 h-3 text-red-500 shrink-0" />
            <span className="text-red-500 truncate" title={lastSend.error}>
              {lastSend.error}
            </span>
            <span className="text-t-ink5 shrink-0">at {lastSend.ts}</span>
          </>
        ) : (
          <>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-t-ink4" : "bg-amber-500"}`} />
            <span className="text-t-ink4">
              {connected ? "Ready to send" : "Not connected — Configure connection first"}
            </span>
          </>
        )}

        {/* Right side: dest + connection indicator */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {address && (
            <>
              <span className="text-t-ink5">→</span>
              <span className="text-t-ink3 truncate max-w-[200px]" title={address}>{address}</span>
            </>
          )}
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-t-ink5"}`} />
        </div>
      </div>
    </div>
  );
}
