import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";

// The ONE CodeMirror wrapper the app goes through, so the chrome stays
// consistent: `theme="none"` (colors come from the themed extension set) and
// `lineNumbers: false` are pinned here and cannot drift per call site. Callers
// vary only the extension set, value/onChange, and the aria label.
export function CodeEditor({
  value,
  onChange,
  extensions,
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  extensions: Extension[];
  ariaLabel?: string;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
      theme="none"
      extensions={extensions}
      basicSetup={{ lineNumbers: false }}
      height="100%"
      className="h-full text-xs"
    />
  );
}
