// Editor entry. Two pages: / lists the projects (home), /p/<id> edits one.
// Opening a project loads its manifest, document and conversation from
// storage, starts the preview and mounts the editor. In personal mode the
// storage is this browser's, served by the service worker (mode.ts): it is
// started first.

import { exportQueue } from './export-queue.ts';
import { startMeasuring, trackPage } from './analytics.ts';
import { render } from 'preact';
// first: the browser's offer to install the app comes early
import './install.ts';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { DOCUMENT } from '@tramme/project';
import { upgradeDoc, type TrammeDoc } from '@tramme/core';
import { api } from './api.ts';
import { preview } from './preview.ts';
import { comp, commit, hooks, load, S, select, setTime, undo } from './state.ts';
import { measureRhythm } from './critic/rhythm.ts';
import { aiRoute, chat, chatId, loadChats, runTool, watchCompanion } from './ai/index.ts';
import { running, send, stop } from './ai/conversation.ts';
import { App } from './ui/App.tsx';
import { Home } from './ui/Home.tsx';
import { normalize, route, SPA_PATHS, startRouter } from './router.ts';
import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { AuthPage, type AuthMode } from './ui/AuthPage.tsx';
import { SpacePage } from './ui/Space.tsx';
import { Quick } from './ui/Quick.tsx';
import { messageFor, refreshAccount, verifyEmail } from './accounts.ts';
import { toast } from './state.ts';
import { fileProject, sameFileProject } from './files.ts';
import './theme/tokens.css';
import './theme/base.css';
import './theme/components.css';
import './screens/home.css';
import './screens/settings.css';
import './screens/account.css';
import './screens/conversation.css';
import './screens/studio.css';
import './screens/atelier.css';
import './screens/quick.css';
import './theme/frost.css';
import './theme/liquid-glass.css';
import { offerTours } from './tours/index.ts';
import { startProject } from './start.ts';
import { t } from './i18n/index.ts';
import { boot } from './mode.ts';
import { initDesktop } from './desktop.ts';
import { carryBodies, followBars, startBackButton } from './device.ts';
import { watchUpdates } from './version.ts';
import { copiesFor, startInstalled } from './installed.ts';
import { lift } from './nav.ts';

const root = document.getElementById('app')!;

function fail(title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  root.innerHTML = `<div class="empty" style="height:100vh"><b>${esc(title)}</b><div class="mono">${esc(message)}</div><a class="btn" href="/">${esc(t('app.backToProjects'))}</a></div>`;
  lift();
}

/** the home screen's picture of the project, refreshed at most every 20 s after a save */
let lastThumb = -Infinity;
let lastThumbProject = '';
async function thumbnail(force = false) {
  const project = fileProject();
  const key = `${project.id}\0${project.docUrl}`;
  if (lastThumbProject !== key) { lastThumb = -Infinity; lastThumbProject = key; }
  if (!force && performance.now() - lastThumb < 20_000) return;
  lastThumb = performance.now();
  try {
    // where the user stands, or the middle of the main composition (the first frames are often empty)
    const c = S.doc.peek().compositions[S.doc.peek().root];
    const blob = await preview.thumbnail(S.time.peek() > 0 && S.compId.peek() === S.doc.peek().root ? S.time.peek() : c.duration / 2);
    if (!blob || !sameFileProject(project)) return;
    await api.write(project.id, 'thumbnail.webp', blob, { type: 'image/webp' });
    if (!sameFileProject(project)) return;
    if (S.project.peek().thumbnail !== 'thumbnail.webp') {
      const updated = await api.update(project.id, { thumbnail: 'thumbnail.webp' });
      if (sameFileProject(project)) S.project.value = updated;
    }
  } catch (e) { console.warn('[tramme] thumbnail:', (e as Error).message); }
}

async function openProject(id: string) {
  const info = await api.info(id);
  const doc = await api.readText(id, DOCUMENT);
  if (!doc) throw new Error(t('app.projectIdHasNo', { id }));
  load(upgradeDoc(JSON.parse(doc.text)) as TrammeDoc, info.manifest, api.fileUrl(id, DOCUMENT), doc.etag);
  document.title = `${info.manifest.name} · Tramme`;
  render(<App />, root);
  lift();
  loadChats(info.files).catch((e) => console.warn('[tramme] conversations :', (e as Error).message)).finally(startProject);
  await preview.start();
  // the editor's tour, the first time a project opens
  setTimeout(() => offerTours('editor'), 700);
  hooks.afterSave = () => { thumbnail(); };
  hooks.copies = copiesFor;
  if (!info.manifest.thumbnail) setTimeout(() => thumbnail(true), 1500);
  // a handle for measurements and automated checks (tramme bench, bench/run.ts); runTool runs a tool of the / menu, its events returned;
  // send, running, chat and stop drive a turn of the assistant as the message box does; rhythm measures the composition on screen as the critic does
  const rhythm = () => measureRhythm(comp.peek().duration, (t) => preview.thumbnail(t, 480));
  (window as any).__tramme = { S, preview, select, setTime, undo, commit, runTool, exportQueue, send, running, chat, chatId, stop, aiRoute, rhythm };
}

const query = new URLSearchParams(location.search);
const AUTH_PAGES = new Set(['/login', '/signup', '/forgot']);

/** the page being shown: the home page or a page of the account, changed by the router without a load */
function Pages() {
  const { path, search } = route.value;
  const q = new URLSearchParams(search);
  const isHome = !AUTH_PAGES.has(path) && path !== '/space' && !(path === '/' && q.get('reset'));
  // a page of the home page's has taken what the address carried (the words of the site): it goes back to being just "/"
  useEffect(() => { if (isHome && search) history.replaceState(null, '', '/'); }, [isHome, search]);
  if (AUTH_PAGES.has(path)) return <AuthPage key={path} mode={path.slice(1) as AuthMode} prompt={q.get('prompt') ?? undefined} />;
  if (path === '/space') return <SpacePage />;
  // the link of the mail of a forgotten password
  if (path === '/' && q.get('reset')) return <AuthPage key="reset" mode="reset" token={q.get('reset') ?? ''} />;
  return <Home />;
}

/** what the links of the mails and the sign-in with a provider leave in the address of the home page */
async function answerNotices(q: URLSearchParams) {
  const verify = q.get('verify'), failed = q.get('auth_error');
  if (failed) toast(messageFor(failed), 'error');
  if (verify) {
    const r = await verifyEmail(verify);
    toast(r.ok ? t('account.verify.done') : t('account.verify.failed'), r.ok ? 'info' : 'error');
    if (r.ok) void refreshAccount();
  }
}

const m = location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]{2,63})\/?$/);
// on the phone, a request's body goes to the app through the IPC: set before the first request
carryBodies();
boot().then(() => {
  // the quick bubble's own window: the bubble alone, none of the app around it
  if (location.pathname === '/quick') {
    document.documentElement.dataset.quick = '';
    render(<Quick />, root);
    lift();
    return;
  }
  // audience measurement: an option of the settings, off until turned on (analytics.ts)
  void startMeasuring();
  // the native app: a .tramme handed by the system imports like a dropped one
  initDesktop();
  startBackButton();
  followBars();
  // the plugins installed on this device, read once from where they are kept
  startInstalled();
  // the local companion, found whenever it starts, on the home page and in the editor
  watchCompanion();
  // a newer version of the app, looked for on its own every twelve hours
  watchUpdates();
  if (m) {
    trackPage(location.pathname);
    openProject(m[1]).catch((e) => {
      S.loadError.value = (e as Error).message;
      fail(t('app.couldNotOpenThe'), (e as Error).message);
    });
  } else {
    // anything else is the home page; its pages and the account's change without a load from here on
    if (!SPA_PATHS.has(normalize(location.pathname))) history.replaceState(null, '', '/');
    startRouter();
    // each page of the home and the account, as the router changes them
    effect(() => trackPage(route.value.path));
    render(<Pages />, root);
    lift();
    void answerNotices(query);
  }
}, (e) => fail(t('personal.cannotStart'), (e as Error).message));
