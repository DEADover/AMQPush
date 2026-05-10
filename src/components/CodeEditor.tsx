import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { useMemo } from "react";
import { useTheme } from "../hooks/useTheme";

export type EditorLanguage = "json" | "xml" | "text";

/**
 * A `{{token}}` template placeholder the editor should suggest. `name` is the
 * bare identifier (e.g. `"uuid"` or `"random_int(1,100)"`); the editor wraps
 * it in `{{…}}` on insertion.
 */
export interface VariableSuggestion {
  /** Bare identifier — no `{{` `}}` wrapping. */
  name: string;
  /** Tooltip / detail text shown next to the suggestion. */
  description?: string;
  /** Optional sub-label (e.g. "user variable" vs "built-in"). */
  group?: string;
}

interface Props {
  value: string;
  onChange?: (val: string) => void;
  language?: EditorLanguage;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
  className?: string;
  /** When set, typing `{{` opens an autocomplete popup with these tokens. */
  variables?: VariableSuggestion[];
}

// Theme using CSS variables — Postman-style flush look with subtle gutter
const appBaseTheme = EditorView.baseTheme({
  "&": { fontSize: "13px", height: "100%" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    lineHeight: "1.55",
    overflow: "auto",
  },
  ".cm-content": { padding: "8px 0", minHeight: "inherit", caretColor: "rgb(var(--t-ink))" },
  "&.cm-focused": { outline: "none" },
  ".cm-focused .cm-cursor": { borderLeftColor: "rgb(var(--t-ink))", borderLeftWidth: "1.5px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    background: "rgb(var(--t-selection) / 0.18) !important",
  },
  ".cm-gutters": {
    background: "rgb(var(--t-bg))",
    color: "rgb(var(--t-ink5))",
    border: "none",
    borderRight: "1px solid rgb(var(--t-line))",
    fontSize: "12px",
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 12px",
    minWidth: "28px",
    textAlign: "right",
    color: "rgb(var(--t-ink5))",
  },
  ".cm-activeLineGutter": {
    background: "rgb(var(--t-hover))",
    color: "rgb(var(--t-ink3))",
  },
  ".cm-activeLine": { background: "rgb(var(--t-hover) / 0.5)" },
  ".cm-matchingBracket": {
    background: "rgb(var(--t-selection) / 0.18)",
    outline: "none",
  },
  ".cm-placeholder": { color: "rgb(var(--t-ink5))" },
  // Autocomplete popup — match the rest of the app's `bg-t-card border-t-line` look.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "rgb(var(--t-card))",
    border: "1px solid rgb(var(--t-line))",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    color: "rgb(var(--t-ink))",
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontSize: "12px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "240px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "3px 8px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "rgb(var(--t-selection) / 0.18)",
    color: "rgb(var(--t-ink))",
  },
  ".cm-completionLabel": { color: "rgb(var(--t-ink2))" },
  ".cm-completionDetail": {
    color: "rgb(var(--t-ink5))",
    fontStyle: "normal",
    marginLeft: "8px",
  },
  ".cm-completionInfo": {
    background: "rgb(var(--t-panel))",
    border: "1px solid rgb(var(--t-line))",
    color: "rgb(var(--t-ink2))",
    padding: "6px 8px",
    fontSize: "11px",
    maxWidth: "320px",
  },
});

/**
 * Build a CodeMirror completion source that fires when the cursor is inside a
 * partial `{{…}}` token. Inserts `<name>}}` at the cursor so the final token
 * is `{{<name>}}` — including the closing braces saves a couple of keystrokes
 * and is what users intuitively expect.
 */
function variableCompletionSource(vars: VariableSuggestion[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // Match the current `{{…` partial — letters, digits, underscores, hyphens
    // and parens (so `{{random_int(1,1` still triggers).
    const word = ctx.matchBefore(/\{\{[\w\-(),\s]*$/);
    if (!word) return null;
    // If the user explicitly opens completion (Ctrl+Space) without anything
    // matching, ctx.explicit is true — only abort when there's nothing typed
    // and they didn't ask explicitly, otherwise we'd suppress the popup.
    if (word.from === word.to && !ctx.explicit) return null;

    return {
      from: word.from + 2, // start completing right after the `{{`
      validFor: /^[\w\-(),\s]*$/,
      options: vars.map(v => ({
        label: v.name,
        detail: v.group,
        info: v.description,
        type: v.group === "user variable" ? "variable" : "constant",
        // The `closeBrackets` extension auto-inserts a matching `}` right
        // after each `{` typed, so when the user starts a placeholder by
        // pressing `{{` the buffer is already `{{<cursor>}}`. We detect that
        // here and skip re-inserting the closing braces — otherwise the
        // result would be `{{name}}}}`.
        apply: (view, _c, from, to) => {
          const trailing = view.state.doc.sliceString(to, to + 2);
          const alreadyClosed = trailing === "}}";
          const insert = alreadyClosed ? v.name : v.name + "}}";
          view.dispatch({
            changes: { from, to, insert },
            // Place the cursor past the closing `}}` in either path.
            selection: { anchor: from + v.name.length + 2 },
          });
        },
      })),
    };
  };
}

export default function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  readOnly,
  minHeight = "180px",
  className,
  variables,
}: Props) {
  const { effective } = useTheme();

  const extensions = useMemo(() => {
    const exts = [appBaseTheme];
    if (language === "json") exts.push(json());
    if (language === "xml")  exts.push(xml());
    if (variables && variables.length > 0) {
      // Override the default sources with ours so the variable list always
      // wins over generic word-completion. Users still get the normal
      // close-brackets / indent behaviour from basicSetup.
      exts.push(autocompletion({ override: [variableCompletionSource(variables)] }));
    }
    return exts;
  }, [language, variables]);

  return (
    <div
      className={`code-editor-wrap overflow-hidden transition-all bg-t-field focus-within:ring-1 focus-within:ring-blue-500/30 ${className ?? ""}`}
      style={{ minHeight }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={effective === "dark" ? "dark" : "light"}
        placeholder={placeholder}
        readOnly={readOnly}
        height="100%"
        style={{ height: "100%", minHeight }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: !readOnly,
          autocompletion: !readOnly,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          highlightSelectionMatches: false,
          tabSize: 2,
        }}
      />
    </div>
  );
}
