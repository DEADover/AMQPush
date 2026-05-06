import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Send, Inbox, CheckCircle2, XCircle, Loader2, SquarePen, X, Layers } from "lucide-react";
import { SavedQueue } from "../../types";

interface Props {
  connected: boolean;
  onLog: (kind: "info" | "ok" | "err", text: string) => void;
  onPublishTo: (address: string) => void;
  onSubscribeTo: (address: string) => void;
}

const INPUT = "bg-t-field border border-t-line2 rounded-md px-3 py-2 text-sm text-t-ink outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5";

type QueueStatus = "idle" | "checking" | "ok" | "err";

function QueueCard({ queue, connected, onDelete, onVerify, onPublish, onSubscribe, onEdit, status }: {
  queue: SavedQueue; connected: boolean; status: QueueStatus;
  onDelete: (n: string) => void; onVerify: (n: string) => void;
  onPublish: (n: string) => void; onSubscribe: (n: string) => void;
  onEdit: (q: SavedQueue) => void;
}) {
  return (
    <div className="border border-t-line rounded-lg p-4 hover:border-t-line2 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {status === "checking" && <Loader2      className="w-4 h-4 text-t-ink4 animate-spin" />}
          {status === "ok"       && <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {status === "err"      && <XCircle      className="w-4 h-4 text-red-500" />}
          {status === "idle"     && <div className="w-4 h-4 rounded-full border border-t-line2 bg-t-hover" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm text-t-ink font-mono truncate">{queue.name}</span>
            {queue.label && <span className="text-xs text-t-ink4 truncate">{queue.label}</span>}
          </div>
          {queue.notes && <p className="text-xs text-t-ink5 mt-1 line-clamp-2">{queue.notes}</p>}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onEdit(queue)}       className="p-1.5 text-t-ink5 hover:text-t-ink2 transition-colors rounded" title="Edit"><SquarePen className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(queue.name)} className="p-1.5 text-t-ink5 hover:text-red-500 transition-colors rounded"  title="Remove"><Trash2    className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-t-line/60">
        {connected && (
          <button onClick={() => onVerify(queue.name)} disabled={status === "checking"}
            className="text-xs text-t-ink4 hover:text-t-ink2 transition-colors disabled:opacity-40">
            {status === "checking" ? "Checking…" : "Test connection"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => onPublish(queue.name)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-t-hover border border-t-line text-t-ink2 hover:border-t-line2 hover:text-t-ink transition-colors">
            <Send className="w-3 h-3" /> Publish
          </button>
          <button onClick={() => onSubscribe(queue.name)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-t-hover border border-t-line text-t-ink2 hover:border-t-line2 hover:text-t-ink transition-colors">
            <Inbox className="w-3 h-3" /> Subscribe
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormState { name: string; label: string; notes: string; }
const EMPTY: FormState = { name: "", label: "", notes: "" };

export default function QueuesView({ connected, onLog, onPublishTo, onSubscribeTo }: Props) {
  const [queues,      setQueues]      = useState<SavedQueue[]>([]);
  const [statuses,    setStatuses]    = useState<Record<string, QueueStatus>>({});
  const [formOpen,    setFormOpen]    = useState(false);
  const [form,        setForm]        = useState<FormState>(EMPTY);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);

  const load = useCallback(async () => {
    try { setQueues(await invoke<SavedQueue[]>("get_saved_queues")); }
    catch (e) { onLog("err", String(e)); }
  }, []);

  useEffect(() => { load(); }, []);

  function openAdd()              { setForm(EMPTY); setEditingName(null); setFormOpen(true); }
  function openEdit(q: SavedQueue){ setForm({ name: q.name, label: q.label, notes: q.notes }); setEditingName(q.name); setFormOpen(true); }
  function closeForm()            { setFormOpen(false); setForm(EMPTY); setEditingName(null); }

  async function submitForm() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingName && editingName !== form.name.trim()) await invoke("delete_queue", { name: editingName });
      await invoke("save_queue", { queue: { name: form.name.trim(), label: form.label.trim(), notes: form.notes.trim() } });
      await load(); closeForm();
      onLog("ok", `Queue '${form.name.trim()}' saved`);
    } catch (e) { onLog("err", String(e)); }
    setSaving(false);
  }

  async function deleteQueue(name: string) {
    try { await invoke("delete_queue", { name }); setQueues(p => p.filter(q => q.name !== name)); onLog("info", `Queue '${name}' removed`); }
    catch (e) { onLog("err", String(e)); }
  }

  async function verifyQueue(name: string) {
    setStatuses(s => ({ ...s, [name]: "checking" }));
    try { await invoke("verify_queue", { address: name }); setStatuses(s => ({ ...s, [name]: "ok" })); onLog("ok", `Queue '${name}' is reachable`); }
    catch (e) { setStatuses(s => ({ ...s, [name]: "err" })); onLog("err", `Queue '${name}': ${e}`); }
    setTimeout(() => setStatuses(s => ({ ...s, [name]: "idle" })), 4000);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3.5 border-b border-t-line flex items-center gap-3">
        <span className="text-xs font-medium text-t-ink4 uppercase tracking-wider">Saved Queues</span>
        <button onClick={openAdd}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Queue
        </button>
      </div>

      {formOpen && (
        <div className="px-5 py-4 border-b border-t-line bg-t-card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-t-ink4 uppercase tracking-wider">{editingName ? "Edit Queue" : "New Queue"}</span>
            <button onClick={closeForm} className="text-t-ink5 hover:text-t-ink3 transition-colors"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] text-t-ink4 uppercase tracking-wider mb-1">Address / Name <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. orders.queue" className={`${INPUT} w-full font-mono`} autoFocus disabled={!!editingName} />
              {editingName && <p className="text-[11px] text-t-ink5 mt-1">Queue name cannot be changed after creation.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-t-ink4 uppercase tracking-wider mb-1">Display Label</label>
                <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Order Events" className={`${INPUT} w-full`} />
              </div>
              <div>
                <label className="block text-[11px] text-t-ink4 uppercase tracking-wider mb-1">Notes</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional description" className={`${INPUT} w-full`} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={closeForm} className="text-sm text-t-ink4 hover:text-t-ink2 transition-colors px-3 py-1.5">Cancel</button>
            <button onClick={submitForm} disabled={!form.name.trim() || saving}
              className="flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {editingName ? "Save changes" : "Add to list"}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {queues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-t-ink5">
            <Layers className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No saved queues</p>
            <p className="text-xs mt-1">Add queues here or bookmark them from Publisher / Subscriber</p>
          </div>
        ) : queues.map(q => (
          <QueueCard key={q.name} queue={q} connected={connected} status={statuses[q.name] ?? "idle"}
            onDelete={deleteQueue} onVerify={verifyQueue} onPublish={onPublishTo} onSubscribe={onSubscribeTo} onEdit={openEdit} />
        ))}
      </div>

      {queues.length > 0 && (
        <div className="px-5 py-2.5 border-t border-t-line shrink-0">
          <span className="text-xs text-t-ink5">{queues.length} queue{queues.length !== 1 ? "s" : ""} saved</span>
        </div>
      )}
    </div>
  );
}
