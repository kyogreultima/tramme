// The message box, shared by the assistant panel of the atelier and the
// direction bar of the studio: words, files joined, and the / menu of the
// vocabulary's tools (run at once from their form) and workflows (sent with
// the message). What the message is about rides with it (the studio adds the
// scene and the point of the picture a note is pinned on).

import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { aiRoute } from '../ai/index.ts';
import { running, runCommand, send, stop, type Anchor } from '../ai/conversation.ts';
import { fieldsOf, inputOf, listCommands, matchCommands, parseCommand, ranked, ready, type Command, type Field } from '../ai/commands.ts';
import { refreshLibrary } from '../library.ts';
import { attachFiles, attaching, draft, pending, removePending } from '../attachments.ts';
import { commandUsed, prefs } from '../settings.ts';
import { S, toast } from '../state.ts';
import { FileChip } from './chat.tsx';
import { Select, Toggle } from './controls.tsx';
import { Icon } from './icons.tsx';
import { t, tr } from '../i18n/index.ts';

/** what the file picker of a message accepts */
export const ATTACHABLE = 'image/*,audio/*,video/*,.pdf,application/pdf,.md,.markdown,.json,.svg,.glb,.gltf,model/gltf-binary,model/gltf+json';

/** files dropped or picked: joined to the next message */
export const join = (list: FileList | File[] | null | undefined) => { const f = Array.from(list ?? []); if (f.length) attachFiles(f); };

/**
 * The / menu of a box (the message box, the home's direction box): the
 * commands matching what is typed after a / at its start, tools first then
 * workflows (the order the keys move in). `keyDown` says whether the key was
 * the menu's; `typed` reopens it after the user typed.
 */
export function useCommandMenu(text: string, commands: Command[], onPick: (c: Command) => void) {
  const [hi, setHi] = useState(0);
  const [off, setOff] = useState(false);
  const typing = /^\/([\w.-]*)$/.exec(text);
  const found = typing && !off ? ranked(matchCommands(commands, typing[1], tr), prefs.value.recentCommands, typing[1]).slice(0, 30) : [];
  const matches = [...found.filter((c) => c.kind === 'tool'), ...found.filter((c) => c.kind === 'prompt')];
  const open = matches.length > 0, at = Math.min(hi, matches.length - 1);
  const pick = (c: Command) => { setHi(0); commandUsed(c.name); onPick(c); };
  const keyDown = (e: KeyboardEvent) => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pick(matches[at]);
    else if (e.key === 'Escape') setOff(true);
    else return false;
    e.preventDefault();
    return true;
  };
  const typed = () => { setOff(false); setHi(0); };
  const view = open ? <CommandMenu list={matches} hi={at} onHover={setHi} onPick={pick} /> : null;
  return { open, view, keyDown, typed };
}

/** the commands matching what follows the /, tools first then workflows (the order the keys move in) */
function CommandMenu({ list, hi, onHover, onPick }: { list: Command[]; hi: number; onHover: (i: number) => void; onPick: (c: Command) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.querySelector('.command-row.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const row = (c: Command, i: number) => (
    <button key={c.name} role="option" aria-selected={i === hi} class={`command-row${i === hi ? ' on' : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onPick(c); }} onMouseEnter={() => onHover(i)}>
      <span class="command-icon"><Icon name={c.kind === 'tool' ? 'wand' : 'chat'} /></span>
      <span class="command-text">
        <span class="command-line"><span class="command-title">{tr(c.title)}</span><span class="command-name">/{c.name}</span></span>
        <span class="command-desc">{tr(c.description)}</span>
      </span>
      {c.from !== 'tramme' && <span class="command-from" title={c.from}>{c.from}</span>}
    </button>
  );
  const tools = list.filter((c) => c.kind === 'tool').length;
  return (
    <div class="command-menu">
      <div class="command-list" role="listbox" ref={ref}>
        {tools > 0 && <div class="command-section">{t('assistant.tools')}</div>}
        {list.slice(0, tools).map((c, i) => row(c, i))}
        {tools < list.length && <div class="command-section">{t('assistant.workflows')}</div>}
        {list.slice(tools).map((c, i) => row(c, tools + i))}
      </div>
      <div class="command-keys"><span><kbd>↑</kbd><kbd>↓</kbd> {t('assistant.keysMove')}</span><span><kbd>↵</kbd> {t('assistant.keysPick')}</span><span><kbd>Esc</kbd> {t('assistant.keysClose')}</span></div>
    </div>
  );
}

/** a field of a tool's form */
function CommandField({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  const shown = value ?? f.default;
  let control;
  if (f.kind === 'boolean') control = <Toggle on={!!shown} onChange={onChange} />;
  else if (f.options) control = <Select value={shown === undefined ? '' : String(shown)} options={[...(f.required ? [] : [['', '—'] as [string, string]]), ...f.options.map(([v, l]) => [v, f.kind === 'enum' || f.kind === 'kit' ? tr(l) : l] as [string, string])]} onChange={(v) => onChange(v || undefined)} />;
  else {
    const num = f.kind === 'number' || f.kind === 'integer';
    control = (
      <div class={`field${num ? ' num' : ''}`}>
        <input value={shown === undefined ? '' : String(shown)} inputMode={num ? 'decimal' : undefined} spellcheck={false} placeholder={f.required ? undefined : t('assistant.auto')}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
      </div>
    );
  }
  return <label class="command-field" title={f.description ? tr(f.description) : undefined}><span class="lbl">{tr(f.label)}{f.required ? ' *' : ''}</span>{control}</label>;
}

/** the command written in the message box: its form (tools) or what it does (workflows) */
function CommandCard({ cmd, fields, values, onChange, onRun, canRun, busy }: { cmd: Command; fields: Field[]; values: Record<string, unknown>; onChange: (k: string, v: unknown) => void; onRun: () => void; canRun: boolean; busy: boolean }) {
  return (
    <div class="command-card">
      <div class="command-head"><Icon name={cmd.kind === 'tool' ? 'wand' : 'chat'} /><b>{tr(cmd.title)}</b><span class="faint">{tr(cmd.description)}</span></div>
      {fields.length > 0 && <div class="command-fields">{fields.map((f) => <CommandField key={f.key} f={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />)}</div>}
      <div class="command-actions">
        <span class="faint">{cmd.kind === 'tool' ? t('assistant.commandHint') : t('assistant.workflowHint')}</span>
        {cmd.kind === 'tool' && <button class="btn sm primary" disabled={!canRun || busy} onClick={onRun}><Icon name="check" />{t('assistant.run')}</button>}
      </div>
    </div>
  );
}

export interface ComposerProps {
  placeholder: string;
  /** what a message is sent about besides the time and selection (the studio: the scene, the pinned point) */
  anchor?: () => Anchor | undefined;
  /** buttons after the attach button (the studio's pin) */
  tools?: ComponentChildren;
  /** what the message is about, at the bar's middle */
  context?: ComponentChildren;
  /** after a message left, or a tool ran */
  onSent?: () => void;
  /** the box, for those who focus it from outside */
  area?: RefObject<HTMLTextAreaElement>;
  /** the tour's name for the box */
  tour?: string;
}

export function Composer({ placeholder, anchor, tools, context, onSent, area: given, tour }: ComposerProps) {
  const [text, setText] = useState('');
  const own = useRef<HTMLTextAreaElement>(null);
  const area = given ?? own;
  const files = useRef<HTMLInputElement>(null);
  const busy = running.value, available = aiRoute.value !== null;
  useEffect(() => { const el = area.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(180, el.scrollHeight)}px`; } }, [text]);
  // words prepared for the user (a project made from sources: the analysis; a direction to complete)
  const prepared = draft.value;
  useEffect(() => { if (prepared) { setText(prepared); draft.value = ''; requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); } }, [prepared]);
  // the / menu: the tools and workflows of the vocabulary (the editor's and the project's plugins)
  const reg = S.registry.value;
  const commands = useMemo(() => listCommands(reg), [reg]);
  const [form, setForm] = useState<{ name: string; values: Record<string, unknown> }>({ name: '', values: {} });
  const pick = (c: Command) => { setText(`/${c.name} `); setForm({ name: c.name, values: {} }); area.current?.focus(); };
  const commandMenu = useCommandMenu(text, commands, pick), menu = commandMenu.open;
  // the library's plugins, fresh for its pickers whenever the menu opens
  useEffect(() => { if (menu) refreshLibrary(); }, [menu]);
  const parsed = menu ? null : parseCommand(text, commands);
  const cmd = parsed?.cmd ?? null;
  const values = cmd && form.name === cmd.name ? form.values : {};
  const fields = cmd?.kind === 'tool' ? fieldsOf(cmd.input, S.doc.value, S.compId.value, reg, S.selection.value) : [];
  const input = inputOf(fields, values);
  const direct = cmd?.kind === 'tool' && !parsed!.rest && ready(fields, input);
  const run = () => { if (!cmd || !direct || busy) return; setText(''); commandUsed(cmd.name); runCommand(cmd, input); onSent?.(); };
  const submit = () => {
    const v = text.trim();
    if (!v && !pending.peek().length) return;
    if (direct) { run(); return; }
    if (cmd?.kind === 'tool' && !parsed!.rest) { toast(t('assistant.fillRequired')); return; }
    if (/^\/[\w.-]+$/.test(v) && !cmd) { toast(t('assistant.noCommand')); return; }
    if (!available) return;
    setText('');
    // a command typed whole and sent counts as used, as one picked from the menu
    if (cmd) commandUsed(cmd.name);
    send(v, { command: cmd ? { cmd, input } : undefined, anchor: anchor?.() });
    onSent?.();
  };
  const keyDown = (e: KeyboardEvent) => {
    if (commandMenu.keyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  return (
    <div class="composer-wrap">
      {commandMenu.view}
      <div class="composer" data-tour={tour}>
        {cmd && <CommandCard cmd={cmd} fields={fields} values={values} busy={busy} canRun={direct} onRun={run}
          onChange={(k, v) => setForm({ name: cmd.name, values: { ...values, [k]: v } })} />}
        {(pending.value.length > 0 || attaching.value > 0) && (
          <div class="pending-files">
            {pending.value.map((a) => <FileChip key={a.path} a={a} onRemove={() => removePending(a.path)} />)}
            {attaching.value > 0 && <span class="file-chip"><Icon name="spinner" /><span class="file-name">{t('assistant.uploading')}</span></span>}
          </div>
        )}
        <textarea ref={area} rows={1} value={text}
          onPaste={(e) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); join(imgs); } }}
          placeholder={available ? placeholder : t('assistant.unavailableSlash')}
          role="combobox" aria-expanded={menu} aria-autocomplete="list"
          onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); commandMenu.typed(); }}
          onKeyDown={keyDown} />
        <div class="bar">
          <button class="icon-btn sm" title={t('assistant.attachImagesSoundsOr')} disabled={!available} onClick={() => files.current?.click()}><Icon name="attach" /></button>
          <input ref={files} type="file" multiple hidden accept={ATTACHABLE} onChange={(e) => { join((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
          {tools}
          <div class="grow">{context}</div>
          {busy
            ? <button class="send stop" title={t('assistant.stop')} onClick={stop}><Icon name="stop" /></button>
            : <button class="send" title={t('assistant.sendEnter')} disabled={(!text.trim() && !pending.value.length) || attaching.value > 0 || (!available && !direct)} onClick={submit}><Icon name="send" /></button>}
        </div>
      </div>
    </div>
  );
}
