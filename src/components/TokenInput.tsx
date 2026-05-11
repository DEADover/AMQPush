import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { VariableSuggestion, variableCompletionSource } from "./CodeEditor";
import { cmAutocompleteTheme } from "./autocompleteShared";

/**
 * Single-line CodeMirror posing as a vanilla `<input>` with `{{token}}`
 * autocomplete. We tried a hand-rolled popup first, then matched its
 * styling against CodeMirror's — but the popups kept drifting on width,
 * font fall-back, italic overhang, etc. Now we just *use* CodeMirror so
 * the autocomplete IS the body editor's autocomplete — same DOM, same
 * theme, same sort, same width.
 *
 * Single-line config: no line numbers, no fold gutter, no active-line
 * highlight, fixed height to match an `<input>`. A transaction filter
 * strips line breaks from inserts (paste of multi-line text, Enter key)
 * so the value behaves like an `<input>` value would.
 */
interface Props {
  value: string;
  onChange: (next: string) => void;
  suggestions?: VariableSuggestion[];
  placeholder?: string;
  /** Wrapper className — supplies the input's border / padding / focus
   *  ring so the embedded CodeMirror looks like a regular text input. */
  className?: string;
}

export default function TokenInput({
  value, onChange, suggestions, placeholder, className,
}: Props) {

  // Compose CodeMirror extensions: autocomplete (when suggestions given),
  // the shared popup theme, a single-line guard, and styling that makes
  // the editor look like an inline `<input>` — fully transparent so the
  // wrapper's background (the table row) shows through, no own bg / border,
  // placeholder colour and font matching the form's plain inputs.
  const extensions = useMemo(() => {
    const exts = [
      EditorView.theme({
        "&": {
          fontSize: "12px",
          height: "auto",
          backgroundColor: "transparent",
        },
        ".cm-editor": { backgroundColor: "transparent" },
        ".cm-scroller": {
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          // Match a plain <input>'s default line-height so the row height
          // matches the key / description inputs in the same grid row. The
          // body editor uses 1.55 (taller, more readable in multi-line
          // blocks), but here we want the editor to vanish into the row.
          lineHeight: "1.2",
          overflowY: "hidden",
          backgroundColor: "transparent",
        },
        ".cm-content": {
          padding: "0",
          caretColor: "rgb(var(--t-ink))",
          color: "rgb(var(--t-ink))",
          backgroundColor: "transparent",
        },
        ".cm-line": { padding: "0", backgroundColor: "transparent" },
        ".cm-activeLine": { backgroundColor: "transparent" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          background: "rgb(var(--t-selection) / 0.18) !important",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-focused .cm-cursor": {
          borderLeftColor: "rgb(var(--t-ink))",
          borderLeftWidth: "1.5px",
        },
        ".cm-placeholder": {
          color: "rgb(var(--t-ink5))",
          fontStyle: "normal",
        },
      }),
      // Strip newlines from any incoming change. Pasting "foo\nbar" lands
      // as "foobar"; pressing Enter does nothing. Without this Enter would
      // grow the editor vertically.
      EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged) return tr;
        const newDoc = tr.newDoc.toString();
        if (!/[\n\r]/.test(newDoc)) return tr;
        return [{
          changes: { from: 0, to: tr.startState.doc.length, insert: newDoc.replace(/[\n\r]/g, "") },
          selection: tr.newSelection,
        }];
      }),
    ];
    if (suggestions && suggestions.length > 0) {
      exts.push(autocompletion({ override: [variableCompletionSource(suggestions)] }));
      exts.push(cmAutocompleteTheme);
    }
    return exts;
  }, [suggestions]);

  return (
    <div className={`token-input-wrap ${className ?? ""}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        // Skip the library's bundled "light"/"dark" theme — it paints a
        // solid editor background that looks alien inside a table row.
        // Our inline EditorView.theme above handles all colours via the
        // `--t-*` CSS variables, which already track the active theme.
        theme="none"
        placeholder={placeholder}
        height="auto"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false, // we add our own (with the variable source) above
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          tabSize: 2,
        }}
      />
    </div>
  );
}
