import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Bookmark, BookmarkCheck, X } from "lucide-react";
import { SavedQueue } from "../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  showSave?: boolean;
  className?: string;
  onQueuesChange?: () => void;
}

export default function QueuePicker({
  value, onChange, disabled, placeholder = "queue or address",
  showSave = true, className = "", onQueuesChange,
}: Props) {
  const [queues,     setQueues]     = useState<SavedQueue[]>([]);
  const [open,       setOpen]       = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const list = await invoke<SavedQueue[]>("get_saved_queues");
      setQueues(list);
      setSavedNames(new Set(list.map(q => q.name)));
    } catch {}
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filtered = value.trim()
    ? queues.filter(q => q.name.toLowerCase().includes(value.toLowerCase()) || q.label.toLowerCase().includes(value.toLowerCase()))
    : queues;

  async function toggleSave() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      if (savedNames.has(value.trim())) {
        await invoke("delete_queue", { name: value.trim() });
      } else {
        await invoke("save_queue", { queue: { name: value.trim(), label: "", notes: "" } });
      }
      await load();
      onQueuesChange?.();
    } catch {}
    setSaving(false);
  }

  const isSaved = savedNames.has(value.trim());

  return (
    <div ref={containerRef} className={`relative flex items-center gap-1 ${className}`}>
      <div className="relative flex-1">
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-t-field border border-t-line2 rounded-md pl-3 pr-8 py-2 text-sm text-t-ink font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-t-ink5 disabled:opacity-50"
        />
        {!disabled && queues.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen(o => !o)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-t-ink4 hover:text-t-ink2 transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {showSave && value.trim() && !disabled && (
        <button
          type="button"
          onClick={toggleSave}
          disabled={saving}
          title={isSaved ? "Remove from saved queues" : "Save to queue list"}
          className={`shrink-0 p-2 rounded-md border transition-all ${
            isSaved
              ? "bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500"
              : "bg-t-field border-t-line2 text-t-ink4 hover:text-t-ink hover:border-t-line2"
          }`}
        >
          {isSaved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        </button>
      )}

      {open && !disabled && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-t-card border border-t-line rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            {filtered.map(q => (
              <button
                key={q.name}
                type="button"
                onClick={() => { onChange(q.name); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-t-hover transition-colors ${value === q.name ? "bg-t-hover" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-sm text-t-ink font-mono truncate">{q.name}</span>
                  {q.label && <span className="block text-xs text-t-ink4 truncate">{q.label}</span>}
                </div>
                {value === q.name && <X className="w-3 h-3 text-t-ink5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
