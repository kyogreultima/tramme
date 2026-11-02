// The photograph remains the fallback. A single textured plane brings its
// folds to life, with a local ripple where the visitor touches the cloth.
const VERTEX = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * .5 + .5;
    gl_Position = vec4(a_position, 0., 1.);
  }
`;

const FRAGMENT = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_cover;
  uniform vec2 u_pointer;
  uniform float u_aspect;
  uniform float u_time;
  uniform float u_strength;
  void main() {
    vec2 uv = v_uv;
    float t = u_time;
    // Wide, slow waves keep the textile's grain and sculptural folds intact.
    vec2 wind = vec2(
      sin(uv.y * 9. + uv.x * 3. + t * .65),
      cos(uv.x * 8. - uv.y * 4. - t * .55)
    );
    uv += wind * vec2(.014, .019);
    vec2 delta = (v_uv - u_pointer) * vec2(u_aspect, 1.);
    float radius = length(delta);
    float envelope = exp(-radius * 5.);
    float ripple = sin(radius * 26. - t * 4.5) * envelope * u_strength;
    uv += (delta / (radius + .08)) * ripple * .026;
    uv += vec2(sin(t * 1.1 + radius * 12.), cos(t + radius * 10.))
      * envelope * u_strength * .012;
    uv = (uv - .5) * u_cover * .94 + .5;
    vec3 cloth = texture2D(u_image, clamp(uv, .001, .999)).rgb;
    cloth *= 1. + ripple * .1;
    gl_FragColor = vec4(cloth, 1.);
  }
`;

export function setupHeroWave(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-wave]');
  const image = root.querySelector<HTMLImageElement>('img.texture');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (!canvas || !image) return () => {};
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let frame = 0;
  let visible = false;
  let disposed = false;
  let failed = false;
  let time = 0;
  let last = 0;
  let x = .5, y = .5, targetX = .5, targetY = .5;
  let strength = 0, targetStrength = 0;
  const uniforms: Record<string, WebGLUniformLocation | null> = {};

  const pause = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
  const release = () => {
    pause();
    root.removeAttribute('data-wave-ready');
    if (gl) {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }
    texture = buffer = program = null;
  };
  const shader = (type: number, source: string) => {
    const item = gl!.createShader(type)!;
    gl!.shaderSource(item, source);
    gl!.compileShader(item);
    if (!gl!.getShaderParameter(item, gl!.COMPILE_STATUS)) {
      gl!.deleteShader(item);
      throw new Error('Hero shader unavailable');
    }
    return item;
  };
  const resize = () => {
    if (!gl || !program) return;
    const { width, height } = root.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5, 1600 / Math.max(width, 1));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const aspect = width / Math.max(height, 1);
    const photoAspect = image.naturalWidth / image.naturalHeight;
    gl.uniform2f(uniforms.cover, Math.min(aspect / photoAspect, 1), Math.min(photoAspect / aspect, 1));
    gl.uniform1f(uniforms.aspect, aspect);
  };
  const initialize = () => {
    gl ??= canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    const vertex = shader(gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Hero program unavailable');
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    for (const name of ['cover', 'pointer', 'aspect', 'time', 'strength']) uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    resize();
  };
  const draw = (now: number) => {
    frame = 0;
    if (!gl || !program) return;
    const dt = last ? Math.min((now - last) / 1000, .05) : 1 / 60;
    last = now;
    time += dt;
    const ease = 1 - Math.exp(-dt * 5);
    x += (targetX - x) * ease;
    y += (targetY - y) * ease;
    strength += (targetStrength - strength) * ease;
    gl.uniform1f(uniforms.time, time);
    gl.uniform2f(uniforms.pointer, x, y);
    gl.uniform1f(uniforms.strength, strength);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    root.setAttribute('data-wave-ready', '');
    frame = requestAnimationFrame(draw);
  };
  const sync = () => {
    pause();
    if (disposed || failed) return;
    if (reduced.matches) { release(); return; }
    if (!visible || document.hidden || !image.complete || !image.naturalWidth) return;
    try {
      if (!program) initialize();
      frame = requestAnimationFrame(draw);
    } catch {
      failed = true;
      release();
    }
  };
  const move = (event: PointerEvent) => {
    const rect = root.getBoundingClientRect();
    targetX = (event.clientX - rect.left) / rect.width;
    targetY = 1 - (event.clientY - rect.top) / rect.height;
    targetStrength = 1;
  };
  const leave = () => { targetStrength = 0; };
  const lost = (event: Event) => { event.preventDefault(); release(); };
  const restored = () => { failed = false; sync(); };
  const visibility = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }) : null;
  visibility?.observe(root);
  if (!visibility) visible = true;
  const sizing = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  sizing?.observe(root);
  root.addEventListener('pointermove', move, { passive: true });
  root.addEventListener('pointerleave', leave);
  root.addEventListener('pointerup', leave);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  image.addEventListener('load', sync);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    disposed = true;
    release();
    visibility?.disconnect();
    sizing?.disconnect();
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', leave);
    root.removeEventListener('pointerup', leave);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    image.removeEventListener('load', sync);
    reduced.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
  };
}
