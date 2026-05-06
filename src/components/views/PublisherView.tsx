import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Send, Plus, X, FileUp, Type, Braces, Repeat2, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { PropertyRow, SendResult } from "../../types";
import QueuePicker from "../QueuePicker";

interface Props {
  connected: boolean;
  defaultAddress: string;
  resendPayload?: { address: string; body: string; nonce: number } | null;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onSent: () => void;
}

const INPUT = "bg-t-field border border-t-line2 rounded-md px-3 py-2 text-sm text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

type BodyMode = "text" | "json" | "file";
let rowId = 0;

function formatJson(s: string) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }
function isValidJson(s: string) { try { JSON.parse(s); return true; } catch { return false; } }

export default function PublisherView({ connected, defaultAddress, resendPayload, onLog, onSent }: Props) {
  const [address,   setAddress]   = useState(defaultAddress);
  const [mode,      setMode]      = useState<BodyMode>("text");
  const [text,      setText]      = useState("");
  const [file,      setFile]      = useState<File | null>(null);
  const [props,     setProps]     = useState<PropertyRow[]>([]);
  const [propsOpen, setPropsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [repeat,    setRepeat]    = useState("1");
  const [delayMs,   setDelayMs]   = useState("0");
  const [sending,   setSending]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!resendPayload) return;
    setAddress(resendPayload.address);
    setText(resendPayload.body);
    setMode("text");
    setFile(null);
  }, [resendPayload?.nonce]);

  const addProp    = useCallback(() => { setProps(p => [...p, { id: ++rowId, key: "", value: "" }]); setPropsOpen(true); }, []);
  const removeProp = useCallback((id: number) => setProps(p => p.filter(r => r.id !== id)), []);
  const updateProp = useCallback((id: number, f: "key" | "value", v: string) => setProps(p => p.map(r => r.id === id ? { ...r, [f]: v } : r)), []);
  function collectProps() { return Object.fromEntries(props.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value])); }
  async function toBase64(f: File): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
  }

  async function doSend() {
    if (!connected)      { onLog("err", "Not connected"); return; }
    if (!address.trim()) { onLog("err", "Queue address is required"); return; }
    if ((mode === "text" || mode === "json") && !text.trim()) { onLog("err", "Message body is empty"); return; }
    if (mode === "json" && !isValidJson(text))  { onLog("err", "Invalid JSON"); return; }
    if (mode === "file" && !file)               { onLog("err", "No file selected"); return; }
    const n = Math.max(1, Number(repeat) || 1);
    const delay = Math.max(0, Number(delayMs) || 0);
    const customProps = collectProps();
    setSending(true);
    try {
      for (let i = 0; i < n; i++) {
        if (i > 0 && delay > 0) await new Promise(r => setTimeout(r, delay));
        const result = await invoke<SendResult>("send_message", mode === "file" && file
          ? { address: address.trim(), text: null, fileName: file.name, fileDataB64: await toBase64(file), customProps }
          : { address: address.trim(), text: text.trim(), fileName: null, fileDataB64: null, customProps }
        );
        onLog("ok", `Sent → ${result.address}  |  ${result.message_id}  |  ${result.timestamp}`);
      }
      onSent();
    } catch (e) { onLog("err", `Send failed: ${e}`); }
    finally { setSending(false); }
  }

  const jsonOk = mode === "json" ? isValidJson(text) : true;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Address bar */}
      <div className="px-5 py-3 border-b border-t-line flex items-center gap-3">
        <span className="text-xs font-medium text-t-ink4 uppercase tracking-wider shrink-0">Target</span>
        <QueuePicker value={address} onChange={setAddress} showSave className="flex-1" />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 min-h-0">

        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-t-ink4 uppercase tracking-wider">Body</span>
          <div className="flex bg-t-card border border-t-line rounded-lg p-0.5 gap-0.5 ml-auto">
            {(["text", "json", "file"] as BodyMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mode === m ? "bg-t-panel text-t-ink shadow-sm" : "text-t-ink4 hover:text-t-ink2"
                }`}
              >
                {m === "text" ? <Type className="w-3 h-3" /> : m === "json" ? <Braces className="w-3 h-3" /> : <FileUp className="w-3 h-3" />}
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Text / JSON */}
        {(mode === "text" || mode === "json") && (
          <div className="flex flex-col gap-2 flex-1 min-h-[160px]">
            {mode === "json" && (
              <div className="flex items-center gap-2">
                <span className={`text-xs ${jsonOk ? "text-green-500" : "text-red-500"}`}>
                  {text ? (jsonOk ? "✓ valid JSON" : "✗ invalid JSON") : ""}
                </span>
                <button onClick={() => setText(formatJson(text))}
                  className="ml-auto flex items-center gap-1 text-xs text-t-ink4 hover:text-t-ink2 transition-colors">
                  <Wand2 className="w-3 h-3" /> Format
                </button>
              </div>
            )}
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={mode === "json" ? '{\n  "key": "value"\n}' : "Type your message…"}
              className={`flex-1 resize-none bg-t-field border rounded-lg px-3 py-3 text-sm text-t-ink outline-none focus:ring-1 transition-all font-mono leading-relaxed min-h-[180px] placeholder:text-t-ink5 ${
                mode === "json" && text && !jsonOk
                  ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20"
                  : "border-t-line2 focus:border-blue-500 focus:ring-blue-500/30"
              }`}
            />
          </div>
        )}

        {/* File picker */}
        {mode === "file" && (
          <div>
            <div onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 h-40 border-2 border-dashed border-t-line2 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-t-hover transition-all">
              <FileUp className="w-8 h-8 text-t-ink5" />
              {file ? (
                <div className="text-center">
                  <p className="text-sm text-t-ink font-medium">{file.name}</p>
                  <p className="text-xs text-t-ink4 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <p className="text-sm text-t-ink5">Click to choose a file</p>
              )}
            </div>
            <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            {file && <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="mt-2 text-xs text-t-ink5 hover:text-red-500 transition-colors">Clear file</button>}
          </div>
        )}

        {/* Custom Properties */}
        <div className="border border-t-line rounded-lg overflow-hidden">
          <button onClick={() => setPropsOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-t-ink3 hover:bg-t-hover transition-colors">
            {propsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="uppercase tracking-wider">Custom Properties</span>
            {props.length > 0 && <span className="ml-auto bg-t-hover text-t-ink4 text-[10px] px-1.5 py-0.5 rounded">{props.length}</span>}
            <button onClick={e => { e.stopPropagation(); addProp(); }} className="ml-auto flex items-center gap-1 text-t-ink4 hover:text-t-ink2 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </button>
          {propsOpen && (
            <div className="px-4 pb-3 space-y-1.5 border-t border-t-line pt-2">
              {props.length === 0 && <p className="text-xs text-t-ink5 py-2 text-center">No custom properties</p>}
              {props.map(row => (
                <div key={row.id} className="flex gap-2">
                  <input value={row.key}   onChange={e => updateProp(row.id, "key",   e.target.value)} placeholder="key"   className={`${INPUT} flex-1 text-xs py-1.5`} />
                  <input value={row.value} onChange={e => updateProp(row.id, "value", e.target.value)} placeholder="value" className={`${INPUT} flex-1 text-xs py-1.5`} />
                  <button onClick={() => removeProp(row.id)} className="p-1.5 text-t-ink5 hover:text-red-500 transition-colors rounded"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Batch */}
        <div className="border border-t-line rounded-lg overflow-hidden">
          <button onClick={() => setBatchOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-t-ink3 hover:bg-t-hover transition-colors">
            {batchOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Repeat2 className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider">Batch Send</span>
            <span className="ml-auto text-t-ink5 text-[11px] font-normal">{repeat}× {Number(delayMs) > 0 ? `/ ${delayMs}ms` : ""}</span>
          </button>
          {batchOpen && (
            <div className="flex items-center gap-6 px-4 pb-3 border-t border-t-line pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-t-ink4 whitespace-nowrap">Repeat</span>
                <input type="number" min="1" value={repeat} onChange={e => setRepeat(e.target.value)} className={`${INPUT} w-20 text-center text-xs py-1.5`} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-t-ink4 whitespace-nowrap">Delay (ms)</span>
                <input type="number" min="0" value={delayMs} onChange={e => setDelayMs(e.target.value)} className={`${INPUT} w-24 text-center text-xs py-1.5`} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Send button */}
      <div className="px-5 py-4 border-t border-t-line shrink-0">
        <button
          onClick={doSend}
          disabled={!connected || sending || (mode === "json" && !!text && !jsonOk)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {sending ? "Sending…" : "Send Message"}
        </button>
      </div>
    </div>
  );
}
