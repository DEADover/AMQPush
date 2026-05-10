import { EditorView } from "@codemirror/view";
import { ReactNode } from "react";

/**
 * Single source of truth for the `{{token}}` autocomplete popup visuals.
 *
 * Two consumers — CodeMirror in `CodeEditor.tsx` (via `cmAutocompleteTheme`)
 * and the plain-input wrapper in `TokenInput.tsx` (via `AutocompletePopup`)
 * — render the same dropdown for the same data, so they share constants
 * here. Tweak any value below and both popups update in lockstep.
 *
 * The constants are kept as plain CSS strings (rather than inline objects
 * per consumer) so the CodeMirror theme can use them directly.
 */

const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
const FONT_SIZE   = "12px";
const RADIUS      = "6px";
const SHADOW      = "0 4px 12px rgba(0,0,0,0.15)";
const ROW_PADDING = "3px 8px";
const MAX_HEIGHT  = "240px";
const MIN_WIDTH   = "180px";
const INFO_WIDTH  = "320px";
const INFO_FONT   = "11px";

/* ────────────────────────────────────────────────────────────────────────── */
/*  CodeMirror theme — drop into the editor's extension array                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const cmAutocompleteTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background:   "rgb(var(--t-card))",
    border:       "1px solid rgb(var(--t-line))",
    borderRadius: RADIUS,
    boxShadow:    SHADOW,
    color:        "rgb(var(--t-ink))",
    fontFamily:   FONT_FAMILY,
    fontSize:     FONT_SIZE,
    minWidth:     MIN_WIDTH,
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight:  MAX_HEIGHT,
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: ROW_PADDING,
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "rgb(var(--t-selection) / 0.18)",
    color:      "rgb(var(--t-ink))",
  },
  ".cm-completionLabel": { color: "rgb(var(--t-ink2))" },
  ".cm-completionDetail": {
    color:     "rgb(var(--t-ink5))",
    fontStyle: "italic",
    marginLeft: "8px",
  },
  ".cm-completionInfo": {
    background: "rgb(var(--t-panel))",
    border:     "1px solid rgb(var(--t-line))",
    borderRadius: RADIUS,
    color:      "rgb(var(--t-ink2))",
    padding:    "6px 8px",
    fontSize:   INFO_FONT,
    maxWidth:   INFO_WIDTH,
    boxShadow:  SHADOW,
  },
});

/* ────────────────────────────────────────────────────────────────────────── */
/*  React popup — for plain inputs (TokenInput) etc.                          */
/* ────────────────────────────────────────────────────────────────────────── */

export interface AutocompleteItem {
  name: string;
  description?: string;
  group?: string;
}

interface PopupProps {
  /** Filtered list to render. */
  items: AutocompleteItem[];
  /** Index of the active row (highlighted + drives the side info panel). */
  activeIdx: number;
  /** Picked via Enter / click. */
  onPick: (item: AutocompleteItem) => void;
  /** Hover handler — caller updates `activeIdx`. */
  onHover: (idx: number) => void;
  /** Optional className override for the outer wrapper (positioning). */
  className?: string;
}

/** Map an `AutocompleteItem.group` to CodeMirror's one-letter type icon
 *  ("c" for constant, "v" for variable). The icon column gives the popup
 *  the same dense look the editor's autocomplete has. */
function typeIcon(group?: string): ReactNode {
  if (group === "user variable") return "v";
  return "c";
}

export function AutocompletePopup({ items, activeIdx, onPick, onHover, className }: PopupProps) {
  if (items.length === 0) return null;
  const active = items[activeIdx];

  // Inline-style block uses the constants directly so neither stylesheet
  // overrides nor Tailwind's purge can desync the popup from CodeMirror.
  return (
    <div
      className={`absolute left-0 top-full mt-1 z-30 flex items-start gap-2 ${className ?? ""}`}
      style={{ fontFamily: FONT_FAMILY, fontSize: FONT_SIZE }}
      onMouseDown={e => e.preventDefault()}
    >
      <div
        style={{
          background:   "rgb(var(--t-card))",
          border:       "1px solid rgb(var(--t-line))",
          borderRadius: RADIUS,
          boxShadow:    SHADOW,
          minWidth:     MIN_WIDTH,
          width:        "max-content",
          color:        "rgb(var(--t-ink))",
          overflow:     "hidden",
        }}
      >
        <ul className="m-0 p-0 list-none" style={{ maxHeight: MAX_HEIGHT, overflowY: "auto" }}>
          {items.map((it, i) => (
            // DOM mirrors CodeMirror's `cm-tooltip-autocomplete > ul > li`:
            // a block-level row with inline-flow children separated by
            // margins (no flex) and `white-space: nowrap`. CodeMirror's CSS
            // also sets `overflow: hidden / text-overflow: ellipsis`, but
            // that interacts badly with `width: max-content` on the popup
            // — `overflow: hidden` makes the row report its constrained
            // width instead of its intrinsic max-content, so the popup
            // stays narrow and triggers the ellipsis it tried to avoid.
            // Skipping both lets the row publish its real width upward,
            // which lets the popup widen to fit the longest row exactly.
            <li
              key={it.name}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(it)}
              aria-selected={i === activeIdx}
              className="cursor-pointer"
              style={{
                padding:    ROW_PADDING,
                background: i === activeIdx ? "rgb(var(--t-selection) / 0.18)" : "transparent",
                color:      i === activeIdx ? "rgb(var(--t-ink))" : "rgb(var(--t-ink2))",
                whiteSpace: "nowrap",
              }}
            >
              <span
                className="italic"
                style={{ color: "rgb(var(--t-ink5))", marginRight: "6px" }}
              >
                {typeIcon(it.group)}
              </span>
              <span>{it.name}</span>
              {it.group && (
                <span className="italic" style={{ color: "rgb(var(--t-ink5))", marginLeft: "8px" }}>
                  {it.group}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Side info panel — same look as CodeMirror's `cm-completionInfo`. */}
      {active?.description && (
        <div
          style={{
            background:   "rgb(var(--t-panel))",
            border:       "1px solid rgb(var(--t-line))",
            borderRadius: RADIUS,
            color:        "rgb(var(--t-ink2))",
            padding:      "6px 8px",
            fontSize:     INFO_FONT,
            maxWidth:     INFO_WIDTH,
            boxShadow:    SHADOW,
          }}
        >
          {active.description}
        </div>
      )}
    </div>
  );
}
