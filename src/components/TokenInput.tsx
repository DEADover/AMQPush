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
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 top-full mt-1 z-30 w-full max-w-md min-w-[220px] bg-t-bg border border-t-line rounded-md shadow-lg overflow-hidden"
          // Mousedown (not click) — fires before the input's onBlur defer,
          // but we still rely on the timeout above to close after click.
          onMouseDown={e => e.preventDefault()}
        >
          <div className="max-h-56 overflow-y-auto py-0.5">
            {filtered.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => handleSelect(s.name)}
                className={`w-full flex items-baseline gap-2 px-2.5 py-1 text-left text-[12px] transition-colors ${
                  i === activeIdx ? "bg-blue-500/15" : "hover:bg-t-hover/50"
                }`}
              >
                <span className={`font-mono truncate ${i === activeIdx ? "text-blue-500" : "text-t-ink2"}`}>
                  {s.name}
                </span>
                {s.group && (
                  <span className="text-[10px] text-t-ink5 shrink-0 ml-auto">{s.group}</span>
                )}
                {s.description && (
                  <span className="text-[10px] text-t-ink5 truncate hidden sm:inline">
                    {s.description}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="px-2 py-1 text-[10px] text-t-ink5 border-t border-t-line bg-t-panel/60 flex items-center gap-2">
            <kbd className="font-mono px-1 py-0.5 border border-t-line rounded">↑↓</kbd> navigate
            <kbd className="font-mono px-1 py-0.5 border border-t-line rounded">↵</kbd> insert
            <kbd className="font-mono px-1 py-0.5 border border-t-line rounded">Esc</kbd> close
          </div>
        </div>
      )}
    </div>
  );
}
