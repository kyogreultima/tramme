// Small controls shared by the panels: menus, popovers, scrubbable numbers,
// colour pickers with tokens, segmented controls, resizers.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { isColor, parseColor, toCss, type Token } from '@tramme/core';
import { Icon, type IconName } from './icons.tsx';
import { t } from '../i18n/index.ts';

// ── context menu ─────────────────────────────────────────────
export interface MenuEntry {
  label: string;
  icon?: IconName;
  /** a line of detail under the label */
  detail?: string;
  /** the shortcut, shown at the right in mono */
  hint?: string;
  /** a check on the chosen entry */
  check?: boolean;
  /** the entry removes something: it reads in the danger colour */
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}
export type MenuItem = MenuEntry | { section: string } | 'sep';

const menuState = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);

export function openMenu(e: { clientX: number; clientY: number } | DOMRect, items: MenuItem[]) {
  const x = 'clientX' in e ? e.clientX : e.left;
  const y = 'clientY' in e ? e.clientY : e.bottom + 4;
  menuState.value = { x, y, items };
}

/** the browser's menu kept out of a work area (the timeline, the curves), except where one types (copy, paste) */
export function noBrowserMenu(e: MouseEvent) {
  const el = e.target as HTMLElement;
  if (!(el instanceof HTMLInputElement && el.type !== 'range') && !(el instanceof HTMLTextAreaElement)) e.preventDefault();
}

/**
 * A menu that also opens on a finger's long press, the same one as the right
 * click: Safari iOS never sends contextmenu. Touch only (mouse and pen have
 * the right click); ~500 ms held still, cancelled when the finger moves over
 * ~6 px or lifts. Returns the cleanup, for the drags that start on the same
 * press and must not survive the menu.
 */
export function longPress(e: { pointerType: string; clientX: number; clientY: number }, fire: (pos: { clientX: number; clientY: number }) => void): () => void {
  if (e.pointerType !== 'touch') return () => {};
  const x0 = e.clientX, y0 = e.clientY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const move = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) stop(); };
  const stop = () => {
    clearTimeout(timer);
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', stop, true);
    removeEventListener('pointercancel', stop, true);
  };
  timer = setTimeout(() => { stop(); fire({ clientX: x0, clientY: y0 }); }, 500);
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', stop, true);
  addEventListener('pointercancel', stop, true);
  return stop;
}

/** one entry of a menu, whatever menu shows it (the context menu, a list of choices) */
export function MenuButton({ it, onPick, active, iconed }: { it: MenuEntry; onPick: () => void; active?: boolean; iconed?: boolean }) {
  const check = it.icon === 'check' || it.check;
  return (
    <button class={`menu-item${active ? ' active' : ''}${it.danger ? ' danger' : ''}`} disabled={it.disabled} role="menuitem" onClick={onPick}>
      {it.icon && it.icon !== 'check' ? <Icon name={it.icon} /> : iconed && <span class="menu-icon-space" />}
      <span class="menu-text"><span>{it.label}</span>{it.detail && <span class="menu-detail">{it.detail}</span>}</span>
      {it.hint && <span class="menu-hint">{it.hint}</span>}
      {check && <Icon name="check" class="check" />}
    </button>
  );
}

/** the keys a menu answers: the arrows walk it, Escape closes; focus starts on the first entry */
function menuKeys(items: MenuItem[]) {
  const walk = (from: number, step: number) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.menu .menu-item:not([disabled])')];
    // only the menu(s) holding these items
    const mine = buttons.filter((b) => items.some((it) => it !== 'sep' && !('section' in it) && it.label === b.querySelector('.menu-text > span')?.textContent));
    const i = mine.findIndex((b) => b === document.activeElement);
    const next = mine[(mine.length + (i === -1 ? 0 : i + step)) % mine.length];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };
  return (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); walk(0, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); walk(0, -1); }
  };
}

export function MenuHost() {
  const m = menuState.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!m || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(m.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(m.y, innerHeight - r.height - 8)) });
    // the keyboard starts on the first entry
    setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('.menu-item:not([disabled])')?.focus());
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) menuState.value = null; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { menuState.value = null; }
      else menuKeys(m.items)(e);
    };
    setTimeout(() => { addEventListener('pointerdown', close); addEventListener('keydown', key); });
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', key); };
  }, [m]);
  if (!m) return null;
  // when some items have an icon, the others keep its place: labels stay aligned
  const iconed = m.items.some((it) => it !== 'sep' && !('section' in it) && it.icon && it.icon !== 'check');
  return (
    <div class="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {m.items.map((it, i) => it === 'sep' ? <hr key={i} /> : 'section' in it ? <div class="menu-label" key={i}>{it.section}</div> : (
        <MenuButton key={i} it={it} iconed={iconed} onPick={() => { menuState.value = null; it.onClick(); }} />
      ))}
    </div>
  );
}

// ── lasso selection ──────────────────────────────────────────
export interface Band { l: number; r: number; t: number; b: number }

/**
 * The rectangle of a drag between two points, in viewport coordinates, and
 * the ids (a data- attribute) of the elements it touches — the lasso's
 * intersection, shared by the timeline's tracks and the curve editor.
 */
export function bandOf(el: Element, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, query: string, attr: string): { band: Band; ids: string[] } {
  const band: Band = { l: Math.min(from.clientX, to.clientX), r: Math.max(from.clientX, to.clientX), t: Math.min(from.clientY, to.clientY), b: Math.max(from.clientY, to.clientY) };
  const ids = [...el.querySelectorAll<HTMLElement>(query)].filter((n) => {
    const b = n.getBoundingClientRect();
    return b.right >= band.l && b.left <= band.r && b.bottom >= band.t && b.top <= band.b;
  }).map((n) => n.getAttribute(attr)!);
  return { band, ids };
}

// ── popover ──────────────────────────────────────────────────
export function Popover({ anchor, onClose, children, class: cls = '', align = 'left' }: { anchor: HTMLElement; onClose: () => void; children: ComponentChildren; class?: string; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; top?: number; bottom?: number; max: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect(), r = ref.current!.getBoundingClientRect();
    let x = align === 'right' ? a.right - r.width : a.left;
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    // below the anchor when it fits, otherwise above; neither: the side with more room, scrolled inside
    const below = innerHeight - a.bottom - 14, above = a.top - 14;
    const down = r.height <= below || (r.height > above && below >= above);
    setPos(down ? { x, top: a.bottom + 6, max: below } : { x, bottom: innerHeight - a.top + 6, max: above });
  }, [anchor]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', close); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  // at the page's level: a panel with CSS containment would otherwise place it from its own corner
  const place = pos ? { left: pos.x, top: pos.top, bottom: pos.bottom, maxHeight: pos.max } : { left: -9999, top: -9999 };
  return createPortal(<div ref={ref} class={`popover ${cls}`} style={place}>{children}</div>, document.body);
}

// ── numbers ──────────────────────────────────────────────────
const fmtNum = (v: number, step: number) => {
  const d = step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
  return String(+v.toFixed(d));
};
/** '12', '1,5', '100+20', '50*2': simple arithmetic only */
export function parseNumber(s: string): number | null {
  const t = s.replace(/,/g, '.').replace(/\s+/g, '');
  if (!/^[-+*/().\d]+$/.test(t)) return null;
  try { const v = Function(`"use strict";return (${t});`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}

/** start a horizontal scrub: calls onMove with the accumulated value, onEnd once */
export function scrub(e: PointerEvent, start: number, step: number, onMove: (v: number) => void, onEnd: (v: number | null) => void, clamp?: (v: number) => number) {
  const x0 = e.clientX;
  let moved = false, v = start;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) document.body.style.cursor = 'ew-resize';
    moved = true;
    // Shift: 10x faster, Alt: 10x finer; values snap to the step in use
    const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
    const snapTo = step * (ev.altKey ? 0.1 : 1);
    v = Math.round((start + dx * step * k) / snapTo) * snapTo;
    if (clamp) v = clamp(v);
    onMove(v);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    onEnd(moved ? v : null);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

export interface NumberProps {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  axis?: string;
  /** live value during a scrub */
  onDraft?: (v: number) => void;
  onCommit: (v: number) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function NumberField({ value, step = 1, min, max, unit, axis, onDraft, onCommit, onCancel, disabled }: NumberProps) {
  const [text, setText] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const startScrub = (e: PointerEvent) => {
    if (disabled || e.button !== 0 || document.activeElement === input.current) return;
    e.preventDefault();
    scrub(e, value, step, (v) => onDraft?.(v), (v) => {
      if (v === null) { input.current?.focus(); input.current?.select(); onCancel?.(); }
      else onCommit(v);
    }, clamp);
  };
  const commitText = () => {
    if (text === null) return;
    const v = parseNumber(text);
    setText(null);
    if (v !== null && v !== value) onCommit(clamp(v));
  };
  return (
    <div class="field num">
      {axis && <span class="axis" onPointerDown={startScrub}>{axis}</span>}
      <input
        ref={input} disabled={disabled}
        value={text ?? fmtNum(value, step)}
        onPointerDown={startScrub}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commitText(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            setText(null); onCommit(clamp(value + k));
          }
        }}
      />
      {unit && <span class="unit">{unit}</span>}
    </div>
  );
}

export function TextInput({ value, onCommit, placeholder, mono, area, code }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; area?: boolean; code?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const done = () => { if (text !== null && text !== value) onCommit(text); setText(null); };
  if (area || code) {
    return (
      <div class={`field area${code ? ' code' : ''}`}>
        <textarea value={text ?? value} placeholder={placeholder} spellcheck={false} rows={code ? Math.min(12, Math.max(3, (text ?? value).split('\n').length + 1)) : 2}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onBlur={done}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 'Enter' && !code && !e.shiftKey)) { e.preventDefault(); done(); (e.target as HTMLElement).blur(); }
            if (e.key === 'Escape') { setText(null); (e.target as HTMLElement).blur(); }
            if (e.key === 'Tab' && code) { e.preventDefault(); const el = e.target as HTMLTextAreaElement; const s = el.selectionStart; el.setRangeText('  ', s, el.selectionEnd, 'end'); setText(el.value); }
          }} />
      </div>
    );
  }
  return (
    <div class="field">
      <input value={text ?? value} placeholder={placeholder} spellcheck={false} class={mono ? 'mono' : ''}
        onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={done}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); } }} />
    </div>
  );
}

type SelectOption = string | [string, string] | SegOpt;
const optValue = (o: SelectOption): string => Array.isArray(o) ? o[0] : typeof o === 'string' ? o : o.value;
const optLabel = (o: SelectOption): string => Array.isArray(o) ? o[1] : typeof o === 'string' ? o : typeof o.label === 'string' ? o.label : optValue(o);

/**
 * A list of choices: a field and its chevron, which opens a menu — the same
 * one everywhere. The keyboard works (arrows, Enter, Escape, first letter) and
 * a check sits on the chosen option. On a touchscreen the native select stays:
 * its list is the platform's, and it feels right there.
 */
export function Select({ value, options, onChange, title }: { value: string; options: SelectOption[]; onChange: (v: string) => void; title?: string }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const entries = options.map((o) => ({ value: optValue(o), label: optLabel(o) }));
  const current = entries.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item')[Math.max(0, active)]?.focus();
  }, [open, active]);
  if (coarse) {
    return (
      <div class="field">
        <select value={value} title={title} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
          {entries.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  const close = (focus = true) => { setOpen(null); setActive(-1); if (focus) open?.focus(); };
  const pick = (v: string) => { close(); onChange(v); };
  const walk = (step: number) => setActive((a) => {
    const n = entries.length;
    return (n + Math.max(0, a) + step) % n;
  });
  return (
    <>
      <button class="field select" type="button" title={title ?? current?.label} role="combobox" aria-haspopup="listbox" aria-expanded={!!open}
        onClick={(e) => { const el = e.currentTarget as HTMLElement; setOpen(open === el ? null : el); setActive(entries.findIndex((o) => o.value === value)); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const el = e.currentTarget as HTMLElement;
            setActive(entries.findIndex((o) => o.value === value));
            setOpen(el);
          }
        }}>
        <span class="sel-text">{current?.label ?? ''}</span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <Popover anchor={open} onClose={() => close(false)} class="as-menu">
          <div role="listbox" ref={listRef}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); walk(1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); walk(-1); }
              else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(entries[active].value); }
              else if (e.key === 'Escape') { e.stopPropagation(); close(); }
              else if (e.key.length === 1 && /\S/.test(e.key)) {
                const i = entries.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
                if (i >= 0) setActive(i);
              }
            }}>
            {entries.map((o, i) => (
              <button key={o.value} class={`menu-item${i === active ? ' active' : ''}`} role="option" aria-selected={o.value === value} tabindex={i === active ? 0 : -1}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}>
                <span class="menu-text"><span>{o.label}</span></span>
                {o.value === value && <Icon name="check" class="check" />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** one option of a segmented control */
export interface SegOpt { value: string; label?: ComponentChildren; icon?: IconName; tour?: string; count?: number }

export function Seg({ value, options, onChange, size, role, ariaLabel }: { value: string; options: (SegOpt | [string, string])[]; onChange: (v: string) => void; size?: 'sm' | 'md' | 'lg'; role?: 'tablist' | 'radiogroup'; ariaLabel?: string }) {
  return (
    <div class={`seg${size && size !== 'md' ? ` ${size}` : ''}`} role={role ?? 'radiogroup'} aria-label={ariaLabel}>
      {options.map((o, i) => {
        const opt: SegOpt = Array.isArray(o) ? { value: o[0], label: o[1] } : o;
        const on = opt.value === value;
        return (
          <button key={opt.value} type="button" class={on ? 'on' : ''} data-tour={opt.tour}
            role={role === 'tablist' ? 'tab' : 'radio'} aria-selected={role === 'tablist' ? on : undefined} aria-checked={role === 'tablist' ? undefined : on}
            title={typeof opt.label === 'string' ? opt.label : undefined}
            onClick={() => onChange(opt.value)}>
            {/* the label in its own element: a narrow bar keeps the icons alone (screens/*.css) */}
            {opt.icon && <Icon name={opt.icon} />}{opt.label ? <span class="seg-label">{opt.label}</span> : null}{opt.count !== undefined && opt.count > 0 && <span class="count">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const Toggle = ({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) =>
  <button class={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} title={title} onClick={() => onChange(!on)} />;

// ── colours ──────────────────────────────────────────────────
export function resolveColor(v: string, tokens: Record<string, Token>): string {
  if (v?.startsWith('@')) { const t = tokens[v.slice(1)]; return typeof t?.value === 'string' ? resolveColor(t.value, tokens) : '#000000'; }
  return isColor(v) ? v : '#000000';
}
const toHex6 = (css: string) => { try { const [r, g, b] = parseColor(css); return toCss([r, g, b, 1]); } catch { return '#000000'; } };

export function Swatch({ color, onClick, title }: { color: string; onClick?: (e: MouseEvent) => void; title?: string }) {
  return <button class="swatch" title={title} onClick={(e) => onClick?.(e as unknown as MouseEvent)}><i style={{ background: color }} /></button>;
}

/** a colour value: hex, rgba or '@token' */
export function ColorField({ value, tokens, onCommit, onDraft, onPick }: { value: string; tokens: Record<string, Token>; onCommit: (v: string) => void; onDraft?: (v: string) => void; onPick?: () => void }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const resolved = resolveColor(value, tokens);
  const isToken = value?.startsWith('@');
  return (
    <>
      <Swatch color={resolved} onClick={(e) => setOpen(open ? null : (e.currentTarget as HTMLElement))} title={t('common.pickAColor')} />
      <TextInput value={value ?? ''} mono onCommit={(v) => { const t = v.trim(); if (t.startsWith('@') ? tokens[t.slice(1)] : isColor(t)) onCommit(t); }} />
      {onPick && <button class="icon-btn sm" style={{ flex: 'none' }} title={t('common.pickInViewport')} onClick={onPick}><Icon name="target" /></button>}
      {open && (
        <Popover anchor={open} onClose={() => setOpen(null)} class="color-pop">
          <div class="row">
            <input type="color" value={toHex6(resolved)} onInput={(e) => onDraft?.((e.target as HTMLInputElement).value.toUpperCase())} onChange={(e) => onCommit((e.target as HTMLInputElement).value.toUpperCase())} />
            <TextInput value={isToken ? resolved : value} mono onCommit={(v) => isColor(v.trim()) && onCommit(v.trim())} />
          </div>
          {Object.entries(tokens).some(([, t]) => t.type === 'color') && <>
            <div class="faint" style={{ fontSize: '10.5px' }}>{t('common.colorTokens')}</div>
            <div class="tokens">
              {Object.entries(tokens).filter(([, t]) => t.type === 'color').map(([name]) => (
                <button key={name} title={`@${name}`} class={value === `@${name}` ? 'on' : ''} style={{ background: resolveColor(`@${name}`, tokens) }} onClick={() => { onCommit(`@${name}`); setOpen(null); }} />
              ))}
            </div>
          </>}
        </Popover>
      )}
    </>
  );
}

// ── resizable panes ──────────────────────────────────────────
const stored = (key: string, d: number) => { try { const v = Number(localStorage.getItem('tramme.' + key)); return v > 0 ? v : d; } catch { return d; } };

/** a size in px persisted per viewer, and the handle that changes it */
export function useSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => stored(key, initial));
  const handle = (axis: 'x' | 'y', sign: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.classList.add('dragging');
      const p0 = axis === 'x' ? e.clientX : e.clientY, s0 = size;
      let s = s0;
      const move = (ev: PointerEvent) => { s = Math.min(max, Math.max(min, s0 + sign * ((axis === 'x' ? ev.clientX : ev.clientY) - p0))); setSize(s); };
      const up = () => {
        el.classList.remove('dragging');
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        try { localStorage.setItem('tramme.' + key, String(s)); } catch { /* private mode */ }
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    },
  });
  return [size, handle] as const;
}

/** a dialog over the page; Escape or a click outside closes it */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div class="modal-head"><span>{title}</span><button class="icon-btn sm" title={t('common.close')} onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
