import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { imageSize } from '../lib/images.mjs';
import { eventJsonLd, googleCalendarUrl, parseDate, prepareShows, toIcs, upcoming, whenLabels } from '../lib/shows.mjs';

const site = { name: 'Michael Sean Miller', url: 'https://example.com', timezone: 'America/Los_Angeles' };

// A minimal but valid PNG header (800 x 1000) — enough for the build to read its size.
function tinyPng(width = 800, height = 1000) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function workspace(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'posters-'));
  writeFileSync(join(dir, 'a.png'), tinyPng());
  for (const [name, buf] of Object.entries(extra)) writeFileSync(join(dir, name), buf);
  return dir;
}

const show = (over = {}) => ({
  id: 'gala',
  title: 'Gala, with a comma; and semicolon',
  venue: 'Club',
  city: 'El Dorado Hills, CA',
  start: '2026-11-14T17:30:00-08:00',
  end: '2026-11-14T21:30:00-08:00',
  poster: 'a.png',
  posterAlt: 'Poster',
  ...over,
});

test('imageSize reads PNG, JPEG and the real WebP posters in this repo', () => {
  assert.deepEqual(imageSize(tinyPng(640, 480)), { width: 640, height: 480, type: 'png' });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(imageSize(jpeg), { width: 600, height: 400, type: 'jpeg' });

  const poster = readFileSync(fileURLToPath(new URL('../src/assets/posters/2026-10-30-monster-bash.webp', import.meta.url)));
  assert.deepEqual(imageSize(poster), { width: 760, height: 1013, type: 'webp' });

  assert.throws(() => imageSize(Buffer.from('not an image at all, just text bytes here')), /unsupported image format/);
});

test('dates must carry a UTC offset', () => {
  assert.throws(() => parseDate('2026-11-14T17:30:00', 'x'), /needs a time zone offset/);
  assert.throws(() => parseDate('2026-13-45T17:30:00-08:00', 'x'), /not a real date/);
  assert.equal(parseDate('2026-11-14T17:30:00-08:00', 'x').toISOString(), '2026-11-15T01:30:00.000Z');
});

test('upcoming hides finished shows, sorts soonest first, and honours hideAfter', () => {
  const dir = workspace();
  const { shows } = prepareShows(
    [
      show({ id: 'later', start: '2026-12-01T18:00:00-08:00', end: '2026-12-01T21:00:00-08:00' }),
      show({ id: 'sooner', start: '2026-11-14T17:30:00-08:00', end: '2026-11-14T21:30:00-08:00' }),
      show({ id: 'done', start: '2026-10-30T19:30:00-07:00', end: '2026-10-30T22:30:00-07:00' }),
      show({ id: 'extended', start: '2026-10-30T19:30:00-07:00', end: '2026-10-30T22:30:00-07:00', hideAfter: '2026-11-03T00:00:00-08:00' }),
    ],
    { postersDir: dir },
  );
  const now = new Date('2026-11-01T12:00:00-07:00');
  assert.deepEqual(upcoming(shows, now).map((s) => s.id), ['extended', 'sooner', 'later']);
  assert.deepEqual(upcoming(shows, new Date('2026-11-20T12:00:00-08:00')).map((s) => s.id), ['later']);
  // A show stays up until its end time, not just its start.
  assert.ok(upcoming(shows, new Date('2026-11-14T20:00:00-08:00')).some((s) => s.id === 'sooner'));
});

test('a show with no end time lasts three hours', () => {
  const { shows } = prepareShows([show({ end: undefined })], { postersDir: workspace() });
  assert.equal(shows[0].endDate - shows[0].startDate, 3 * 60 * 60 * 1000);
});

test('bad entries fail with a message that says what to fix', () => {
  const postersDir = workspace();
  const fails = (entry, pattern) => assert.throws(() => prepareShows([entry], { postersDir }), pattern);
  fails(show({ title: '' }), /"title" is required/);
  fails(show({ id: 'Has Spaces' }), /"id" may only use/);
  fails(show({ poster: 'missing.png' }), /poster file not found — add src\/assets\/posters\/missing\.png/);
  fails(show({ poster: 'has spaces.png' }), /no folders or spaces/);
  fails(show({ start: '2026-11-14T17:30:00' }), /needs a time zone offset/);
  fails(show({ end: '2026-11-14T10:00:00-08:00' }), /"end" must be after "start"/);
  fails(show({ cta: { label: 'x', url: 'javascript:alert(1)' } }), /full "url" starting with https/);
  assert.throws(() => prepareShows([show(), show()], { postersDir }), /already uses id/);
  assert.throws(() => prepareShows({}, { postersDir }), /must be a list/);
});

test('oversized posters and missing locations produce warnings, not failures', () => {
  const dir = workspace({ 'big.png': Buffer.concat([tinyPng(2000, 2500), Buffer.alloc(500 * 1024)]) });
  const { warnings } = prepareShows([show({ id: 'big', poster: 'big.png', city: undefined })], { postersDir: dir });
  assert.equal(warnings.length, 3);
  assert.match(warnings.join('\n'), /KB/);
  assert.match(warnings.join('\n'), /2000px wide/);
  assert.match(warnings.join('\n'), /"city"/);
});

test('date and time labels use the show time zone', () => {
  const { shows } = prepareShows([show()], { postersDir: workspace() });
  assert.deepEqual(whenLabels(shows[0], site.timezone), { dateLabel: 'Sat, Nov 14', timeLabel: '5:30 PM' });
});

test('ics file: CRLF, UTC times, escaped text, lines folded to 75 bytes', () => {
  const { shows } = prepareShows([show({ cta: { label: 'ticket page', url: `https://example.org/${'x'.repeat(120)}` } })], { postersDir: workspace() });
  const ics = toIcs(shows[0], site, new Date('2026-11-01T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line break must be CRLF');
  assert.match(ics, /DTSTAMP:20261101T000000Z\r\n/, 'DTSTAMP has day precision so same-day builds are identical');
  assert.match(ics, /DTSTART:20261115T013000Z\r\n/);
  assert.match(ics, /DTEND:20261115T053000Z\r\n/);
  assert.match(ics, /SUMMARY:Gala\\, with a comma\\; and semicolon\r\n/);
  assert.match(ics, /LOCATION:Club\\, El Dorado Hills\\, CA\r\n/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  assert.match(ics.replace(/\r\n /g, ''), /Ticket page: https:\/\/example\.org\/x{120}/); // unfolds back to the full URL
});

test('google calendar link carries title, UTC dates and location', () => {
  const { shows } = prepareShows([show()], { postersDir: workspace() });
  const url = new URL(googleCalendarUrl(shows[0], site));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('dates'), '20261115T013000Z/20261115T053000Z');
  assert.equal(url.searchParams.get('text'), 'Gala, with a comma; and semicolon');
  assert.equal(url.searchParams.get('location'), 'Club, El Dorado Hills, CA');
});

test('Event structured data has what Google needs', () => {
  const { shows } = prepareShows([show()], { postersDir: workspace() });
  const event = eventJsonLd(shows[0], site);
  assert.equal(event['@type'], 'Event');
  assert.equal(event.startDate, '2026-11-14T17:30:00-08:00');
  assert.equal(event.location.address.addressLocality, 'El Dorado Hills');
  assert.equal(event.location.address.addressRegion, 'CA');
  assert.deepEqual(event.image, ['https://example.com/assets/posters/a.png']);
});
