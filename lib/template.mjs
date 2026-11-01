// A tiny template engine (no dependencies) so page sections stay readable HTML.
//
//   {{ site.name }}        value, HTML-escaped
//   {{{ jsonLd }}}         value, inserted as-is (only for HTML/JSON we built ourselves)
//   {{> nav }}             include src/partials/nav.html
//   {{#if featured}} … {{else}} … {{/if}}
//   {{#each more}} … {{ item.title }} … {{/each}}     (also {{ index }})
//
// Typos fail loudly: printing a value that doesn't exist throws, so a broken
// template stops the build instead of publishing an empty hole in the page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class TemplateError extends Error {}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Look up "a.b.c" in an object. Returns undefined if any step is missing. */
export function lookup(path, scope) {
  let current = scope;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

export function createPartialLoader(dir) {
  return (name) => {
    if (!/^[\w-]+$/.test(name)) throw new TemplateError(`Bad partial name "${name}"`);
    return readFileSync(join(dir, `${name}.html`), 'utf8');
  };
}

const TAG = /\{\{\{\s*([^{}]+?)\s*\}\}\}|\{\{\s*([#/>]?)\s*([^{}]*?)\s*\}\}/g;
const STANDALONE = new Set(['include', 'open', 'close', 'else']);

function tokenize(source, name) {
  const tokens = [];
  let last = 0;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(source)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', value: source.slice(last, m.index) });
    const where = { name, line: source.slice(0, m.index).split('\n').length };
    if (m[1] !== undefined) {
      tokens.push({ type: 'raw', path: m[1], ...where });
    } else if (m[2] === '>') {
      tokens.push({ type: 'include', arg: m[3], ...where });
    } else if (m[2] === '#') {
      const [kind, ...rest] = m[3].split(/\s+/);
      tokens.push({ type: 'open', kind, path: rest.join(' '), ...where });
    } else if (m[2] === '/') {
      tokens.push({ type: 'close', kind: m[3], ...where });
    } else if (m[3] === 'else') {
      tokens.push({ type: 'else', ...where });
    } else {
      tokens.push({ type: 'var', path: m[3], ...where });
    }
    last = TAG.lastIndex;
  }
  if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) });

  // A block tag alone on its line shouldn't leave a blank line behind.
  tokens.forEach((tok, i) => {
    if (!STANDALONE.has(tok.type)) return;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const startsLine = prev === undefined || (prev.type === 'text' && /(^|\n)[ \t]*$/.test(prev.value));
    const endsLine = next === undefined || (next.type === 'text' && /^[ \t]*\r?\n/.test(next.value));
    if (startsLine && endsLine) {
      if (prev) prev.value = prev.value.replace(/[ \t]*$/, '');
      if (next) next.value = next.value.replace(/^[ \t]*\r?\n/, '');
    }
  });
  return tokens;
}

const fail = (tok, message) => new TemplateError(`${tok.name}:${tok.line} — ${message}`);

function parse(tokens, ctx) {
  const root = [];
  const stack = [{ nodes: root }];
  for (const tok of tokens) {
    const frame = stack[stack.length - 1];
    switch (tok.type) {
      case 'text':
        frame.nodes.push({ t: 'text', v: tok.value });
        break;
      case 'var':
      case 'raw':
        frame.nodes.push({ t: tok.type, path: tok.path, tok });
        break;
      case 'include': {
        if (ctx.depth > 10) throw fail(tok, 'partials nested too deeply (is one including itself?)');
        const inner = parse(tokenize(ctx.load(tok.arg), tok.arg), { ...ctx, depth: ctx.depth + 1 });
        frame.nodes.push(...inner);
        break;
      }
      case 'open': {
        if (tok.kind !== 'if' && tok.kind !== 'each') throw fail(tok, `unknown block "{{#${tok.kind}}}"`);
        const node = { t: tok.kind, path: tok.path, tok, nodes: [], elseNodes: null };
        frame.nodes.push(node);
        stack.push({ node, nodes: node.nodes });
        break;
      }
      case 'else':
        if (!frame.node || frame.node.t !== 'if') throw fail(tok, '{{else}} must be inside {{#if}}');
        frame.node.elseNodes = [];
        frame.nodes = frame.node.elseNodes;
        break;
      case 'close':
        if (!frame.node || frame.node.t !== tok.kind) throw fail(tok, `unexpected {{/${tok.kind}}}`);
        stack.pop();
        break;
    }
  }
  if (stack.length > 1) throw fail(stack[stack.length - 1].node.tok, `{{#${stack[stack.length - 1].node.t}}} is never closed`);
  return root;
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

function printable(node, scope) {
  const value = lookup(node.path, scope);
  if (value === undefined || value === null) throw fail(node.tok, `"${node.path}" is not defined`);
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw fail(node.tok, `"${node.path}" is not text or a number`);
  return String(value);
}

function evaluate(nodes, scope, out) {
  for (const node of nodes) {
    switch (node.t) {
      case 'text':
        out.push(node.v);
        break;
      case 'var':
        out.push(escapeHtml(printable(node, scope)));
        break;
      case 'raw':
        out.push(printable(node, scope));
        break;
      case 'if':
        evaluate(truthy(lookup(node.path, scope)) ? node.nodes : node.elseNodes ?? [], scope, out);
        break;
      case 'each': {
        const list = lookup(node.path, scope);
        if (!Array.isArray(list)) throw fail(node.tok, `"${node.path}" is not a list`);
        list.forEach((item, index) => evaluate(node.nodes, { ...scope, item, index }, out));
        break;
      }
    }
  }
}

export function render(source, data, { name = 'template', loadPartial } = {}) {
  const load = loadPartial ?? ((n) => { throw new TemplateError(`${name}: no partial loader for "${n}"`); });
  const ast = parse(tokenize(source, name), { load, depth: 0 });
  const out = [];
  evaluate(ast, data, out);
  return out.join('');
}
