import assert from 'node:assert/strict';
import test from 'node:test';
import { render } from '../lib/template.mjs';

const partials = { greeting: 'Hello {{ name }}!\n' };
const loadPartial = (n) => partials[n];

test('escapes {{ }} but not {{{ }}}', () => {
  const out = render('{{ a }} | {{{ a }}}', { a: '<b>"x" & \'y\'</b>' });
  assert.equal(out, '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt; | <b>"x" & \'y\'</b>');
});

test('reads nested values', () => {
  assert.equal(render('{{ site.links.ig }}', { site: { links: { ig: 'https://x' } } }), 'https://x');
});

test('#if / else follow truthiness, and empty lists are false', () => {
  const tpl = '{{#if x}}yes{{else}}no{{/if}}';
  assert.equal(render(tpl, { x: 1 }), 'yes');
  assert.equal(render(tpl, { x: 0 }), 'no');
  assert.equal(render(tpl, { x: [] }), 'no');
  assert.equal(render(tpl, { x: null }), 'no');
  assert.equal(render(tpl, {}), 'no'); // a missing name is simply false inside #if
});

test('#each loops with item and index', () => {
  const out = render('{{#each list}}{{ index }}={{ item.n }};{{/each}}', { list: [{ n: 'a' }, { n: 'b' }] });
  assert.equal(out, '0=a;1=b;');
});

test('{{> partial }} includes another file and shares data', () => {
  assert.equal(render('[{{> greeting }}]', { name: 'Michael' }, { loadPartial }), '[Hello Michael!\n]');
});

test('block tags alone on a line leave no blank lines behind', () => {
  const tpl = 'a\n{{#if x}}\nb\n{{/if}}\nc\n';
  assert.equal(render(tpl, { x: true }), 'a\nb\nc\n');
  assert.equal(render(tpl, { x: false }), 'a\nc\n');
});

test('printing something undefined fails loudly with the template name and line', () => {
  assert.throws(() => render('one\ntwo {{ nope }}', {}, { name: 'page.html' }), /page\.html:2 — "nope" is not defined/);
});

test('refuses to print objects, and #each needs a list', () => {
  assert.throws(() => render('{{ a }}', { a: { b: 1 } }), /not text or a number/);
  assert.throws(() => render('{{#each a}}{{/each}}', { a: 'text' }), /not a list/);
});

test('unclosed and stray blocks are reported', () => {
  assert.throws(() => render('{{#if x}}oops', { x: 1 }), /never closed/);
  assert.throws(() => render('oops{{/if}}', {}), /unexpected/);
  assert.throws(() => render('{{else}}', {}), /inside \{\{#if\}\}/);
});

test('partial names cannot escape the partials folder', async () => {
  const { createPartialLoader } = await import('../lib/template.mjs');
  assert.throws(() => createPartialLoader('/tmp')('../etc/passwd'), /Bad partial name/);
});
