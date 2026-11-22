// Headless Chrome with the GPU (ANGLE on D3D11 under Windows), sRGB forced,
// LCD text off: renders are identical from one machine to the next.

import fs from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));

/**
 * Offline: every request but the local render server's fails (a proxy that is not there: Chrome sends only loopback past a proxy, and
 * WebRTC kept off UDP). The renderer of the exports in the cloud sets TRAMME_OFFLINE: a project's code runs on the
 * render page at full speed, as a host application runs its plugins, and reaches nothing beyond the project.
 */
export const OFFLINE_ARGS = ['--proxy-server=http://127.0.0.1:9', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

/** The renderer image runs as root; Chromium refuses to start there with its sandbox enabled. */
export function chromeArgs(root = process.getuid?.() === 0, offline = process.env.TRAMME_OFFLINE === '1'): string[] {
  return [
    ...(root ? ['--no-sandbox'] : []),
    ...(offline ? OFFLINE_ARGS : []),
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--disable-lcd-text',
    '--window-size=1920,1080',
  ];
}

export async function launch({ quiet = true } = {}): Promise<{ browser: Browser; page: Page }> {
  if (!CHROME) throw new Error('Chrome not found (set CHROME_PATH to point to it)');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 0,
    args: chromeArgs(),
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (!quiet || m.type() === 'error' || m.type() === 'warn') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[page error]', (e as Error).message));
  return { browser, page };
}

export interface DocInfo {
  title: string; comp: string; width: number; height: number; fps: number; duration: number; frames: number;
  markers: { id: string; t: number; kind?: string; label?: string }[];
}

/** the project's code drawn in its sandbox rather than on the render page (tramme render --isolate) */
let isolation = false;
export function isolateProjects(on: boolean) { isolation = on; }

/** open the runtime page on a document and wait until it is ready */
export async function openDoc(page: Page, port: number, docUrlPath: string, comp?: string): Promise<DocInfo> {
  const q = new URLSearchParams({ doc: docUrlPath });
  if (comp) q.set('comp', comp);
  if (isolation) q.set('isolate', '1');
  await page.goto(`http://127.0.0.1:${port}/__tramme/?${q}`);
  await page.evaluate(() => (window as any).TRAMME.ready);
  return page.evaluate(() => (window as any).TRAMME.info());
}
