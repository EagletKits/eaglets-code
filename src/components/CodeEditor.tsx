import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, keymap, type DecorationSet } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: '#ffffff' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: '#f1f7ff', color: '#8a97ad', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#f4f8ff' },
  '.cm-activeLineGutter': { backgroundColor: '#e5efff' },
  '&.cm-focused': { outline: 'none' },
  '.cm-error-line': { backgroundColor: '#fff1e6', boxShadow: 'inset 3px 0 0 #e8590c' },
});

/** The line a run failed on. Cleared as soon as the code is edited. */
const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = tr.docChanged ? Decoration.none : deco;
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const n = e.value;
      if (n === null || n < 1 || n > tr.state.doc.lines) next = Decoration.none;
      else {
        const line = tr.state.doc.line(n);
        const ranges: Range<Decoration>[] = [Decoration.line({ class: 'cm-error-line', attributes: { 'data-error-line': String(n) } }).range(line.from)];
        next = Decoration.set(ranges);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Highlight this line (1-based) and scroll to it, e.g. where a run failed. */
  errorLine?: number | null;
}

/** A plain Python editor. The text is the source of truth while it is open. */
export function CodeEditor({ value, onChange, errorLine = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const external = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          python(),
          indentUnit.of('    '),
          keymap.of([indentWithTab]),
          theme,
          errorLineField,
          EditorView.contentAttributes.of({ 'aria-label': 'Python code editor', spellcheck: 'false', autocapitalize: 'off' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !external.current) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Created once; outside changes arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    external.current = true;
    try {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    } finally {
      external.current = false;
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const effects: StateEffect<unknown>[] = [setErrorLine.of(errorLine)];
    if (errorLine !== null && errorLine >= 1 && errorLine <= v.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(v.state.doc.line(errorLine).from, { y: 'center' }));
    }
    v.dispatch({ effects });
  }, [errorLine]);

  return <div ref={host} className="code-host" data-testid="code-editor" />;
}
