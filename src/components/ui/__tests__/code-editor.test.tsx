import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";

import { CodeEditor } from "@/components/ui/code-editor";

// Stage 3 - Themes. CodeEditor is the ONE @uiw/react-codemirror wrapper the app
// goes through: theme="none", basicSetup={{ lineNumbers: false }}. It renders a
// CodeMirror editor seeded with `value`; a doc change fires onChange(newText).
// This module does not exist yet, so the import fails RED.

function liveView(): EditorView {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

describe("CodeEditor", () => {
  // behavior: renders a CodeMirror textbox seeded with the passed value.
  it("should render a textbox seeded with the value", async () => {
    render(
      <CodeEditor
        value="hello"
        onChange={() => {}}
        extensions={[json()]}
        ariaLabel="test editor"
      />,
    );

    const textbox = await screen.findByRole("textbox");
    expect(textbox).toBeInTheDocument();
    expect(textbox.textContent).toContain("hello");
  });

  // side-effect-contract: a doc change dispatched into the live editor fires
  // onChange with the NEW full document text.
  it("should fire onChange with the new text if the document changes", async () => {
    const onChange = vi.fn();
    render(
      <CodeEditor
        value="hello"
        onChange={onChange}
        extensions={[json()]}
        ariaLabel="test editor"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    // Ignore any onChange emitted while seeding the initial value.
    onChange.mockClear();

    const view = liveView();
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "!" },
      });
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toBe("hello!");
  });
});
