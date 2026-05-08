import { Send, Inbox, History, Settings2, BarChart2, Terminal, Radar, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { View } from "../types";

interface Props {
  active: View;
  onChange: (v: View) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ITEMS: { id: View; icon: React.ReactNode; label: string; kbd?: string }[] = [
  { id: "connection", icon: <Settings2  className="w-[15px] h-[15px]" />, label: "Connection", kbd: "⌘1" },
  { id: "publisher",  icon: <Send       className="w-[15px] h-[15px]" />, label: "Send",       kbd: "⌘2" },
  { id: "subscriber", icon: <Inbox      className="w-[15px] h-[15px]" />, label: "Receive",    kbd: "⌘3" },
  { id: "browser",    icon: <Radar      className="w-[15px] h-[15px]" />, label: "Browser",    kbd: "⌘4" },
  { id: "history",    icon: <History    className="w-[15px] h-[15px]" />, label: "History",    kbd: "⌘5" },
  { id: "stats",      icon: <BarChart2  className="w-[15px] h-[15px]" />, label: "Stats",      kbd: "⌘6" },
  { id: "console",    icon: <Terminal   className="w-[15px] h-[15px]" />, label: "Logs",       kbd: "⌘7" },
];

const TRANSITION = "transition-[width,opacity] duration-200 ease-out";

export default function Sidebar({ active, onChange, collapsed, onToggleCollapsed }: Props) {
  return (
    <nav className={`shrink-0 flex flex-col bg-t-panel border-r border-t-line py-2 overflow-hidden ${TRANSITION} ${
      collapsed ? "w-12" : "w-44"
    }`}>
      <div className="flex-1 flex flex-col gap-0.5 px-1.5">
        {ITEMS.map(item => {
          const isActive = active === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              title={collapsed ? `${item.label}${item.kbd ? `  ${item.kbd}` : ""}` : undefined}
              className={`relative h-8 px-2 rounded-md flex items-center gap-2 transition-colors group whitespace-nowrap text-[12px] shrink-0 ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-t-ink3 hover:bg-t-hover hover:text-t-ink"
              }`}
            >
              {/* Icon — always visible, fixed size column */}
              <span className="shrink-0 flex items-center justify-center w-[15px]">{item.icon}</span>

              {/* Label — fades out on collapse */}
              <span className={`flex-1 text-left truncate ${TRANSITION} ${
                collapsed ? "opacity-0" : "opacity-100"
              }`}>
                {item.label}
              </span>

              {/* Keyboard shortcut — fades out on collapse */}
              {item.kbd && (
                <span className={`text-[10px] font-mono shrink-0 ${TRANSITION} ${
                  collapsed ? "opacity-0" : (isActive ? "text-blue-200" : "text-t-ink5")
                }`}>
                  {item.kbd}
                </span>
              )}

              {/* Tooltip — shown only when collapsed (otherwise label is visible inline) */}
              {collapsed && (
                <span className="absolute left-12 bg-t-card text-t-ink text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-t-line shadow-lg flex items-center gap-2">
                  {item.label}
                  {item.kbd && <span className="text-t-ink5">{item.kbd}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle — same layout pattern */}
      <button
        onClick={onToggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="shrink-0 mt-1 mx-1.5 h-8 px-2 rounded-md flex items-center gap-2 text-t-ink4 hover:bg-t-hover hover:text-t-ink2 transition-colors whitespace-nowrap"
      >
        <span className="shrink-0 flex items-center justify-center w-[15px]">
          {collapsed
            ? <PanelLeftOpen  className="w-[15px] h-[15px]" />
            : <PanelLeftClose className="w-[15px] h-[15px]" />}
        </span>
        <span className={`flex-1 text-left text-[11px] truncate ${TRANSITION} ${
          collapsed ? "opacity-0" : "opacity-100"
        }`}>
          Collapse
        </span>
      </button>
    </nav>
  );
}
