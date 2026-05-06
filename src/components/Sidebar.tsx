import { Send, Inbox, History, Layers, Settings2 } from "lucide-react";
import { View } from "../types";

interface Props {
  active: View;
  onChange: (v: View) => void;
  msgCount?: number;
}

const ITEMS: { id: View; icon: React.ReactNode; label: string }[] = [
  { id: "publisher",  icon: <Send    className="w-4 h-4" />, label: "Send"    },
  { id: "subscriber", icon: <Inbox   className="w-4 h-4" />, label: "Receive" },
  { id: "history",    icon: <History className="w-4 h-4" />, label: "History" },
  { id: "queues",     icon: <Layers  className="w-4 h-4" />, label: "Queues"  },
];

export default function Sidebar({ active, onChange, msgCount }: Props) {
  return (
    <nav className="w-14 shrink-0 flex flex-col items-center bg-t-panel border-r border-t-line py-3 gap-1">
      {ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          title={item.label}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all group ${
            active === item.id
              ? "bg-blue-600 text-white"
              : "text-t-ink4 hover:bg-t-hover hover:text-t-ink"
          }`}
        >
          {item.icon}

          {item.id === "subscriber" && msgCount !== undefined && msgCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 text-[10px] font-bold bg-green-500 text-black rounded-full flex items-center justify-center">
              {msgCount > 99 ? "99+" : msgCount}
            </span>
          )}

          <span className="absolute left-12 bg-t-card text-t-ink text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-t-line shadow-lg">
            {item.label}
          </span>
        </button>
      ))}

      <div className="flex-1" />

      <button
        onClick={() => onChange("connection")}
        title="Connection"
        className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all group ${
          active === "connection"
            ? "bg-blue-600 text-white"
            : "text-t-ink4 hover:bg-t-hover hover:text-t-ink"
        }`}
      >
        <Settings2 className="w-4 h-4" />
        <span className="absolute left-12 bg-t-card text-t-ink text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-t-line shadow-lg">
          Connection
        </span>
      </button>
    </nav>
  );
}
