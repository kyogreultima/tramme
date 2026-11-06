import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export async function serveScene(sceneDir) {
  const root = path.resolve(sceneDir);
  const vendorRoot = path.resolve('.cache/roadmaps/hyperframes-0.9.13/node_modules');
  const server = http.createServer((request, response) => {
    const pathname = new URL(`http://localhost${request.url}`).pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (pathname === '/preview') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><html><body style="margin:0"></body></html>'); return; }
    const vendor = pathname === '/vendor/gsap.min.js' ? 'gsap/dist/gsap.min.js'
      : pathname === '/vendor/three.module.js' ? 'three/build/three.module.js'
      : pathname === '/vendor/three.core.js' ? 'three/build/three.core.js' : null;
    const file = vendor ? path.join(vendorRoot, vendor) : path.resolve(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
    if ((!vendor && !file.startsWith(`${root}${path.sep}`)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const type = file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
