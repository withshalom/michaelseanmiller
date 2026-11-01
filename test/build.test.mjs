// End-to-end: run the real build against the real src/ at different "now" dates.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const quiet = () => {};

function buildAt(when, root = ROOT) {
  const outDir = mkdtempSync(join(tmpdir(), 'site-'));
  build({ root, outDir, now: new Date(when), log: quiet });
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1])['@graph'];
  return { outDir, html, events: graph.filter((n) => n['@type'] === 'Event') };
}

/** A copy of the project whose shows.json is whatever the test needs (reusing real poster files). */
function projectWithShows(shows) {
  const root = mkdtempSync(join(tmpdir(), 'project-'));
  cpSync(join(ROOT, 'src'), join(root, 'src'), { recursive: true });
  cpSync(join(ROOT, 'CNAME'), join(root, 'CNAME'));
  writeFileSync(join(root, 'src/data/shows.json'), JSON.stringify(shows));
  return root;
}
const fake = (id, day) => ({
  id,
  title: `Show ${id}`,
  venue: 'Venue',
  city: 'Folsom, CA',
  start: `2026-12-${day}T18:00:00-08:00`,
  end: `2026-12-${day}T21:00:00-08:00`,
  poster: '2026-10-30-monster-bash.webp',
  posterAlt: 'Poster',
});

test('while a show is upcoming it is the featured poster, with calendar files and Event data', () => {
  const { outDir, html, events } = buildAt('2026-11-01T12:00:00-07:00');
  assert.match(html, /2026-11-14-shine-bright-gala\.webp/);
  assert.match(html, /casaeldorado\.ejoinme\.org/);
  assert.match(html, /Add to calendar/);
  assert.doesNotMatch(html, /is-video-only/);
  assert.doesNotMatch(html, /2026-10-30-monster-bash\.webp/, 'a finished show must not appear');
  assert.equal(events.length, 1);
  assert.ok(existsSync(join(outDir, 'calendar/2026-11-14-shine-bright-gala.ics')));
});

test('the show disappears after it ends and the video fills the stage', () => {
  const during = buildAt('2026-11-14T20:00:00-08:00');
  assert.match(during.html, /2026-11-14-shine-bright-gala\.webp/);
  const after = buildAt('2026-11-14T22:00:00-08:00');
  assert.doesNotMatch(after.html, /showcase-art"/);
  assert.match(after.html, /showcase-inner is-video-only/);
  assert.match(after.html, /youtube\.com\/embed\//, 'the video is still there');
  assert.equal(after.events.length, 0);
  assert.ok(!existsSync(join(after.outDir, 'calendar')));
});

test('the day of the old show still renders the original poster', () => {
  const { html } = buildAt('2026-10-30T12:00:00-07:00');
  assert.match(html, /2026-10-30-monster-bash\.webp/);
  assert.match(html, /docs\.google\.com\/forms/);
});

test('two upcoming shows: featured plus a single centred card; three: a two-column grid', () => {
  const two = buildAt('2026-11-01T12:00:00-07:00', projectWithShows([fake('a', '05'), fake('b', '12')]));
  assert.match(two.html, /upcoming-grid upcoming-grid--single/);
  assert.equal((two.html.match(/class="flyer-card"/g) ?? []).length, 1);

  const three = buildAt('2026-11-01T12:00:00-07:00', projectWithShows([fake('c', '19'), fake('a', '05'), fake('b', '12')]));
  assert.doesNotMatch(three.html, /upcoming-grid--single/);
  assert.equal((three.html.match(/class="flyer-card"/g) ?? []).length, 2);
  assert.equal(three.events.length, 3);
  // featured is the soonest one, the grid is ordered after it
  assert.ok(three.html.indexOf('Show a') < three.html.indexOf('Show b'));
});

test('the Halloween lessons flag disappears after its deadline', () => {
  assert.match(buildAt('2026-11-02T12:00:00-08:00').html, /class="charity-flag"/);
  assert.doesNotMatch(buildAt('2026-11-03T08:00:00-08:00').html, /class="charity-flag"/);
});

test('assets, custom domain and structured data come through', () => {
  const { outDir, html } = buildAt('2026-11-01T12:00:00-07:00');
  for (const file of ['CNAME', 'assets/css/styles.css', 'assets/css/marquee-tile.webp', 'assets/js/main.js', 'assets/photos/michael-hero.webp']) {
    assert.ok(existsSync(join(outDir, file)), `${file} missing from output`);
  }
  assert.equal(readFileSync(join(outDir, 'CNAME'), 'utf8').trim(), 'michaelseanmiller.com');
  assert.doesNotMatch(html, /base64/, 'no embedded images should remain');
  assert.doesNotMatch(html, /\{\{/, 'no unrendered template tags');
  assert.match(html, /&copy; 2026 Michael Sean Miller/);
  assert.match(html, /"name": "Michael Sean Miller — Live Music, DJ & Events"/);
});

test('a broken shows.json stops the build instead of publishing a broken site', () => {
  const root = projectWithShows([{ ...fake('a', '05'), start: '2026-12-05T18:00:00' }]);
  assert.throws(() => build({ root, outDir: mkdtempSync(join(tmpdir(), 'site-')), now: new Date(), log: quiet }), /needs a time zone offset/);
});

test('a show can override its screen-reader label, and a missing share image is flagged', () => {
  const root = projectWithShows([{ ...fake('a', '05'), ariaLabel: 'Custom label for a' }]);
  rmSync(join(root, 'src/static/og-image.jpg'), { force: true });
  const lines = [];
  const outDir = mkdtempSync(join(tmpdir(), 'site-'));
  build({ root, outDir, now: new Date('2026-11-01T12:00:00-07:00'), log: (l) => lines.push(l) });
  assert.match(readFileSync(join(outDir, 'index.html'), 'utf8'), /aria-label="Custom label for a"/);
  assert.match(lines.join('\n'), /og-image\.jpg is missing/);
});

test('the built page uses relative paths, so it also works opened straight from a folder', () => {
  const { html } = buildAt('2026-11-01T12:00:00-07:00');
  assert.doesNotMatch(html, /(?:src|href)="\/(?:assets|calendar)\//);
  assert.match(html, /href="assets\/css\/styles\.css"/);
  assert.match(html, /href="calendar\/2026-11-14-shine-bright-gala\.ics"/);
});
