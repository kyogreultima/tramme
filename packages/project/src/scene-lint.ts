// Static scene checks before a seekable page is accepted by the CLI. Parsing
// JavaScript avoids false matches in strings and comments; no code is run.
import { parse } from '@babel/parser';

export interface SceneLintIssue { path: string; line: number; message: string }
export const MAX_SCENE_SOURCE = 1024 * 1024;
type Ast = { type: string; loc?: { start: { line: number } }; [key: string]: any };

function lintScript(path: string, source: string): SceneLintIssue[] {
  let root: Ast;
  try { root = parse(source, { sourceType: 'unambiguous', allowReturnOutsideFunction: true }) as Ast; }
  catch (error) { return [{ path, line: Number((error as { loc?: { line?: number } }).loc?.line ?? 1), message: `invalid scene script: ${(error as Error).message}` }]; }
  const issues: SceneLintIssue[] = [], found = new Set<string>();
  const names = (pattern: Ast | null | undefined, into: Set<string>) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') into.add(pattern.name);
    else if (pattern.type === 'RestElement' || pattern.type === 'AssignmentPattern') names(pattern.argument ?? pattern.left, into);
    else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) names(p.value ?? p.argument, into);
    else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) names(p, into);
  };
  const declarations = (body: Ast[]): Set<string> => {
    const out = new Set<string>();
    for (const item of body) {
      const node = item.declaration ?? item;
      if (node.type === 'VariableDeclaration') for (const d of node.declarations) names(d.id, out);
      if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names(node.id, out);
      if (node.type === 'ImportDeclaration') for (const s of node.specifiers) names(s.local, out);
    }
    return out;
  };
  const flag = (node: Ast, name: string) => {
    const line = node.loc?.start.line ?? 1, key = `${line}:${name}`;
    if (!found.has(key)) { found.add(key); issues.push({ path, line, message: `${name} is not seekable; use the scene time passed to window.__hf.seek(t)` }); }
  };
  const visit = (node: Ast, scopes: Set<string>[], parent?: Ast) => {
    let active = scopes;
    if (node.type === 'Program' || node.type === 'BlockStatement') active = [...scopes, declarations(node.body ?? [])];
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      const bound = new Set<string>();
      names(node.id, bound);
      for (const p of node.params ?? []) names(p, bound);
      active = [...active, bound];
    }
    if (node.type === 'CatchClause') { const bound = new Set<string>(); names(node.param, bound); active = [...active, bound]; }
    const local = (name: string) => active.some((scope) => scope.has(name));
    const access = (value: Ast): string[] | null => {
      if (value.type === 'Identifier') {
        if (local(value.name)) return null;
        return ['globalThis', 'window', 'self'].includes(value.name) ? [] : [value.name];
      }
      if (value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression') {
        const base = access(value.object);
        const prop = value.computed ? value.property.type === 'StringLiteral' ? value.property.value : null : value.property.name;
        return base !== null && typeof prop === 'string' ? [...base, prop] : null;
      }
      return null;
    };
    const parts = access(node), name = parts?.join('.');
    const propertyName = parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === node && !parent.computed;
    const objectKey = parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassMethod') && parent.key === node && !parent.computed && !parent.shorthand;
    if (!propertyName && !objectKey && (name === 'Date.now' || name === 'Math.random' || name === 'fetch' || name === 'requestAnimationFrame')) flag(node, name);
    if (node.type === 'NewExpression' && access(node.callee)?.join('.') === 'Date') flag(node, 'new Date');
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init) {
      const base = access(node.init)?.join('.');
      for (const prop of node.id.properties) {
        const key = prop.key?.name ?? prop.key?.value;
        if ((base === '' && ['fetch', 'requestAnimationFrame', 'Date', 'Math'].includes(key)) || (base === 'Date' && key === 'now') || (base === 'Math' && key === 'random')) flag(prop, `${base ? `${base}.` : ''}${key}`);
      }
    }
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && node.computed && !['StringLiteral', 'NumericLiteral'].includes(node.property.type)) {
      const base = access(node.object)?.join('.');
      if (base === '' || base === 'Date' || base === 'Math') flag(node, 'dynamic global access');
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(child)) {
        for (const item of child) if (item && typeof item === 'object' && typeof item.type === 'string') visit(item, active, node);
      } else if (child && typeof child === 'object' && typeof child.type === 'string') visit(child, active, node);
    }
  };
  visit(root, []);
  return issues;
}

/** Scan local scripts and inline HTML scripts of a scene folder without running them. */
export function lintSceneFiles(files: Map<string, Uint8Array>): SceneLintIssue[] {
  const issues: SceneLintIssue[] = [], decoder = new TextDecoder();
  for (const [path, bytes] of files) {
    if (!/^scenes\/[a-z0-9][a-z0-9-]{0,63}\//.test(path)) continue;
    if (!/\.(?:html|js|mjs)$/i.test(path)) continue;
    if (bytes.byteLength > MAX_SCENE_SOURCE) { issues.push({ path, line: 1, message: 'scene script exceeds 1 MB' }); continue; }
    if (/\.(?:js|mjs)$/i.test(path)) issues.push(...lintScript(path, decoder.decode(bytes)));
    if (/\.html$/i.test(path)) {
      const html = decoder.decode(bytes);
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/json|importmap)/i.test(match[1])) continue;
        const line = html.slice(0, match.index).split('\n').length;
        for (const issue of lintScript(path, match[2])) issues.push({ ...issue, line: issue.line + line - 1 });
      }
    }
  }
  return issues;
}
