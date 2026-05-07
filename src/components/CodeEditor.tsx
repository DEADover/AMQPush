import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import { useTheme } from "../hooks/useTheme";

export type EditorLanguage = "json" | "xml" | "text";

interface Props {
  value: string;
  onChange?: (val: string) => void;
  language?: EditorLanguage;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
  className?: string;
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
    background: "rgba(59,130,246,0.18) !important",
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
    background: "rgba(59,130,246,0.18)",
    outline: "none",
  },
  ".cm-placeholder": { color: "rgb(var(--t-ink5))" },
});

export default function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  readOnly,
  minHeight = "180px",
  className,
}: Props) {
  const { effective } = useTheme();

  const extensions = [appBaseTheme];
  if (language === "json") extensions.push(json());
  if (language === "xml") extensions.push(xml());

  return (
    <div
      className={`code-editor-wrap overflow-hidden transition-all bg-t-field ${className ?? ""}`}
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
