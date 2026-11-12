// The visitor's system, from what the browser says of itself (Platform.astro
// puts it in data-os before the first paint). Self-contained: the page embeds
// this function's source as it is, so it must not use anything outside itself.

/** 'windows', 'mac', 'linux' or 'android'; '' for a system the app is not built for (an iPhone, an iPad, a Chromebook) or one that cannot be told */
export function osOf(ua: string, platform: string, touchPoints: number): string {
  // before Linux: an Android phone says it is Linux too
  if (/android/i.test(ua)) return 'android';
  // an iPad says it is a Mac, but has a touch screen
  if (/iphone|ipad|ipod|cros/i.test(ua) || (/mac/i.test(platform) && touchPoints > 1)) return '';
  return /win/i.test(platform) ? 'windows' : /mac/i.test(platform) ? 'mac' : /linux|x11/i.test(platform) ? 'linux' : '';
}
