// The desktop app's installers, as each release on GitHub carries them
// (.github/workflows/desktop.yml, gathered by scripts/desktop-release.ts): one
// stable name per file, so the site links to the latest release's files
// without knowing its version (apps/site/src/lib/download.ts).

export type Os = 'windows' | 'mac' | 'linux';

export interface Installer {
  os: Os;
  /** its name on the release */
  file: string;
  /** where `tauri build` writes it, under src-tauri/target, and how its name ends */
  built: string;
  suffix: string;
  /** what it is, and what it runs on, as the download page says it */
  kind: string;
  runs: string;
}

/** each system's first installer is the one its download button offers */
export const INSTALLERS: Installer[] = [
  { os: 'windows', file: 'tramme-windows-x64-setup.exe', built: 'release/bundle/nsis', suffix: '-setup.exe', kind: 'Installer', runs: 'Windows 10 and 11, 64-bit' },
  { os: 'mac', file: 'tramme-macos-universal.dmg', built: 'universal-apple-darwin/release/bundle/dmg', suffix: '.dmg', kind: 'Disk image', runs: 'Apple silicon and Intel' },
  { os: 'linux', file: 'tramme-linux-x86_64.AppImage', built: 'release/bundle/appimage', suffix: '.AppImage', kind: 'AppImage', runs: 'Most distributions, x86-64' },
  { os: 'linux', file: 'tramme-linux-amd64.deb', built: 'release/bundle/deb', suffix: '.deb', kind: 'Debian package', runs: 'Debian, Ubuntu and their kin, x86-64' },
];

/** the systems, in the order they are offered, by their names */
export const SYSTEMS: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/**
 * The systems whose app is built with every release but not offered, on the site
 * or in the app's own notice of a new version. macOS: an app that Apple has not
 * signed and notarized cannot be installed, and Tramme's is not yet. When it is,
 * take 'mac' out of this list: the download page, the buttons, the menus and the
 * FAQ follow (a test checks what they say).
 */
export const WITHHELD: readonly Os[] = ['mac'];

/** the systems that are offered, in order */
export const OFFERED_SYSTEMS: Os[] = (Object.keys(SYSTEMS) as Os[]).filter((os) => !WITHHELD.includes(os));
/** the installers that are offered */
export const OFFERED_INSTALLERS: Installer[] = INSTALLERS.filter((i) => !WITHHELD.includes(i.os));

/** the systems that are offered, in a line: "Windows and Linux" */
export function systemsLine(locale: 'en' | 'fr'): string {
  const names = OFFERED_SYSTEMS.map((os) => SYSTEMS[os]);
  const and = locale === 'fr' ? 'et' : 'and';
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}
