import { Send, Inbox, History, Settings2, BarChart2, Terminal, Radar, Network, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { View } from "../types";

interface Props {
  active: View;
  onChange: (v: View) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// Sidebar nav icons — use the canonical `w-3.5 h-3.5` (14px) sizing seen
// across all view top bars rather than the off-scale `w-[15px]` we used to
// have. Identical column width for both expanded and collapsed states.
const ITEMS: { id: View; icon: React.ReactNode; label: string; kbd?: string }[] = [
  { id: "connection", icon: <Settings2  className="w-3.5 h-3.5" />, label: "Connection", kbd: "⌘1" },
  { id: "publisher",  icon: <Send       className="w-3.5 h-3.5" />, label: "Send",       kbd: "⌘2" },
  { id: "subscriber", icon: <Inbox      className="w-3.5 h-3.5" />, label: "Receive",    kbd: "⌘3" },
  { id: "browser",    icon: <Radar      className="w-3.5 h-3.5" />, label: "Browser",    kbd: "⌘4" },
  { id: "inspector",  icon: <Network    className="w-3.5 h-3.5" />, label: "Clients",    kbd: "⌘5" },
  { id: "history",    icon: <History    className="w-3.5 h-3.5" />, label: "History",    kbd: "⌘6" },
  { id: "stats",      icon: <BarChart2  className="w-3.5 h-3.5" />, label: "Stats",      kbd: "⌘7" },
  { id: "console",    icon: <Terminal   className="w-3.5 h-3.5" />, label: "Logs",       kbd: "⌘8" },
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
              aria-label={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={`relative h-8 px-2 rounded-md flex items-center gap-2 transition-colors group whitespace-nowrap text-[12px] shrink-0 ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-t-ink3 hover:bg-t-hover hover:text-t-ink"
              }`}
            >
              {/* Icon column — fixed at 14px so collapsed and expanded layouts align. */}
              <span className="shrink-0 flex items-center justify-center w-3.5">{item.icon}</span>

              {/* Label — fades out on collapse */}
              <span className={`flex-1 text-left truncate ${TRANSITION} ${
                collapsed ? "opacity-0" : "opacity-100"
              }`}>
                {item.label}
              </span>

              {/* Keyboard shortcut — fades out on collapse.
                  Active uses `text-white/70` (muted-on-active) instead of a raw
                  blue-200 palette colour so the only colour used here is `white`. */}
              {item.kbd && (
                <span className={`text-[10px] font-mono shrink-0 ${TRANSITION} ${
                  collapsed ? "opacity-0" : (isActive ? "text-white/70" : "text-t-ink5")
                }`}>
                  {item.kbd}
                </span>
              )}

              {/* Tooltip — shown only when collapsed (otherwise label is visible inline) */}
              {collapsed && (
                <span className="absolute left-12 bg-t-card text-t-ink text-[12px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-t-line shadow-lg flex items-center gap-2">
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
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className="shrink-0 mt-1 mx-1.5 h-8 px-2 rounded-md flex items-center gap-2 text-t-ink4 hover:bg-t-hover hover:text-t-ink2 transition-colors whitespace-nowrap"
      >
        <span className="shrink-0 flex items-center justify-center w-3.5">
          {collapsed
            ? <PanelLeftOpen  className="w-3.5 h-3.5" />
            : <PanelLeftClose className="w-3.5 h-3.5" />}
        </span>
        <span className={`flex-1 text-left text-[12px] truncate ${TRANSITION} ${
          collapsed ? "opacity-0" : "opacity-100"
        }`}>
          Collapse
        </span>
      </button>
    </nav>
  );
}
