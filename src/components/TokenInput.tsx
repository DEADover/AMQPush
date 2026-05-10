import {
  useEffect, useRef, useState, useMemo, useCallback,
  ChangeEvent, KeyboardEvent, InputHTMLAttributes,
} from "react";
import { VariableSuggestion } from "./CodeEditor";

/**
 * Plain `<input>` with `{{token}}` autocomplete — same idea as the
 * CodeMirror-driven completion in CodeEditor, but for places where a
 * full-blown editor would be overkill (Property values, Reply-to, etc.).
 *
 * Triggers on `{{` immediately before the cursor. While open, the dropdown
 * shows filtered suggestions; Up/Down navigate, Enter / Tab insert,
 * Esc closes. Clicking a row also inserts.
 *
 * Insertion replaces the partial `{{<typed>` with `{{name}}` (closing braces
 * included) and places the cursor right after the closing `}}` so the user
 * can keep typing.
 */

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (next: string) => void;
  /** Token catalogue. Same shape as CodeMirror's. Empty / undefined disables
   *  autocomplete and the input behaves like a vanilla `<input>`. */
  suggestions?: VariableSuggestion[];
}

export default function TokenInput({
  value, onChange, suggestions, className, onKeyDown, ...rest
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [partial, setPartial] = useState("");
  /** Where the `{{` started in the input value — used to compute the slice
   *  to replace on insert. -1 when no active token. */
  const [tokenStart, setTokenStart] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);

  /** Inspect the text up to the cursor and decide whether autocomplete should
   *  be open. Returns the start index of the active `{{…` (the position of
   *  the first `{`) and the partial token text after `{{`, or null when no
   *  active token. */
  const detectToken = useCallback((text: string, caret: number) => {
    if (!suggestions || suggestions.length === 0) return null;
    const before = text.slice(0, caret);
    // Find the last unclosed `{{` — anything after it without a `}}` is an
    // active partial. Whitespace inside is allowed (some users type
    // `{{ name }}`); we trim before matching.
    const open2 = before.lastIndexOf("{{");
    if (open2 < 0) return null;
    const between = before.slice(open2 + 2);
    if (between.includes("}}")) return null; // already closed before caret
    // Reject if the partial spans a line break or contains `{` again —
    // user is probably done typing or in JSON nesting.
    if (/[\n\r{}]/.test(between)) return null;
    return { start: open2, partial: between.trim() };
  }, [suggestions]);

  /** Suggestions filtered against the current partial text — case-insensitive
   *  prefix match first, substring match second so typing "id" still finds
   *  `correlation_id`. */
  const filtered = useMemo(() => {
    if (!suggestions) return [];
    const q = partial.toLowerCase();
    if (!q) return suggestions.slice(0, 50);
    const prefix: VariableSuggestion[] = [];
    const sub: VariableSuggestion[] = [];
    for (const s of suggestions) {
      const n = s.name.toLowerCase();
      if (n.startsWith(q)) prefix.push(s);
      else if (n.includes(q)) sub.push(s);
    }
    return [...prefix, ...sub].slice(0, 50);
  }, [suggestions, partial]);

  // Keep activeIdx in range when filter changes
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered.length, activeIdx]);

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    const tok = detectToken(next, caret);
    if (tok) {
      setOpen(true);
      setPartial(tok.partial);
      setTokenStart(tok.start);
      setActiveIdx(0);
    } else if (open) {
      setOpen(false);
    }
  }

  function handleSelect(name: string) {
    const el = inputRef.current;
    if (!el || tokenStart < 0) return;
    const caret = el.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(caret);
    const insert = `{{${name}}}`;
    const next = before + insert + after;
    onChange(next);
    setOpen(false);
    // Restore focus + place cursor right after the closing `}}`
    requestAnimationFrame(() => {
      const pos = (before + insert).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelect(filtered[activeIdx].name);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    }
    onKeyDown?.(e);
  }

  // Re-check token state on caret moves (arrow keys, click) without typing
  function handleCaretChange() {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const tok = detectToken(value, caret);
    if (tok) {
      setOpen(true);
      setPartial(tok.partial);
      setTokenStart(tok.start);
    } else if (open) {
      setOpen(false);
    }
  }

  return (
    <div className="relative inline-block w-full">
      <input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleCaretChange}
        onClick={handleCaretChange}
        onBlur={() => {
          // Defer close so a click on a suggestion has time to register.
          setTimeout(() => setOpen(false), 120);
        }}
        className={className}
        {...rest}
      />
      {open && filtered.length > 0 && (() => {
        // CodeMirror renders one letter per "type" (e.g. `c` for constant /
        // built-in, `v` for variable). Mirror that — built-in tokens get a
        // dim italic `c`, user-supplied ones get `v`. Anything else falls
        // back to a blank space so columns stay aligned.
        function typeIcon(group?: string): string {
          if (!group) return " ";
          if (group === "user variable") return "v";
          return "c"; // built-in / faker / etc.
        }
        const active = filtered[activeIdx];
        return (
          // Outer wrapper carries the popup AND the side info panel so they
          // visually pair like CodeMirror's `cm-tooltip-autocomplete` +
          // `cm-completionInfo`. flex-row with gap so the side panel sits
          // immediately to the right of the list.
          <div
            className="absolute left-0 top-full mt-1 z-30 flex items-start gap-2 font-mono text-[12px]"
            onMouseDown={e => e.preventDefault()}
          >
            {/* Main popup — bg-t-card, border-t-line, 6 px radius, soft
                shadow; identical to CodeMirror's tooltip rules. */}
            <div className="min-w-[220px] max-w-md bg-t-card border border-t-line rounded-md text-t-ink shadow-[0_4px_12px_rgba(0,0,0,0.15)] overflow-hidden">
              <ul className="max-h-60 overflow-y-auto m-0 p-0 list-none">
                {filtered.map((s, i) => (
                  <li
                    key={s.name}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => handleSelect(s.name)}
                    aria-selected={i === activeIdx}
                    className={`flex items-baseline gap-2 px-2 py-[3px] cursor-pointer ${
                      i === activeIdx ? "bg-t-selection/[0.18]" : ""
                    }`}
                  >
                    <span className="text-t-ink5 italic w-3 shrink-0">{typeIcon(s.group)}</span>
                    <span className={i === activeIdx ? "text-t-ink" : "text-t-ink2"}>
                      {s.name}
                    </span>
                    {s.group && (
                      <span className="text-t-ink5 italic">{s.group}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Side info panel — only when the active item has a
                description. Matches CodeMirror's `cm-completionInfo`:
                bg-t-panel, border-t-line, 11 px, narrow max-width. */}
            {active?.description && (
              <div className="bg-t-panel border border-t-line rounded-md px-2 py-1.5 text-[11px] text-t-ink2 max-w-[320px] shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
                {active.description}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
