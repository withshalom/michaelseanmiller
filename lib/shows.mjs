// Everything about shows: validating src/data/shows.json, deciding which are
// still upcoming, and producing calendar links, .ics files and Event structured data.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageSize } from './images.mjs';

export class ShowsError extends Error {}

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const SHOW_ID = /^[a-z0-9][a-z0-9-]*$/;
const POSTER_FILE = /^[\w.-]+\.(webp|png|jpe?g)$/i;
const DEFAULT_LENGTH_MS = 3 * 60 * 60 * 1000;
const MAX_POSTER_BYTES = 400 * 1024;
const MAX_POSTER_WIDTH = 1200;

/** Dates must carry a UTC offset, otherwise GitHub's servers (UTC) would guess wrong. */
export function parseDate(value, where) {
  if (typeof value !== 'string' || !OFFSET.test(value)) {
    throw new ShowsError(
      `${where}: "${value}" needs a time zone offset, like 2026-11-14T19:30:00-08:00 (-08:00 in winter, -07:00 in summer)`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ShowsError(`${where}: "${value}" is not a real date`);
  return date;
}

export function prepareShows(raw, { postersDir }) {
  if (!Array.isArray(raw)) throw new ShowsError('shows.json must be a list: [ { … }, { … } ]');
  const seen = new Set();
  const warnings = [];

  const shows = raw.map((entry, i) => {
    const where = `shows.json entry #${i + 1}${entry?.id ? ` (${entry.id})` : ''}`;
    for (const key of ['id', 'title', 'venue', 'start', 'poster', 'posterAlt']) {
      if (typeof entry?.[key] !== 'string' || !entry[key].trim()) throw new ShowsError(`${where}: "${key}" is required`);
    }
    if (!SHOW_ID.test(entry.id)) throw new ShowsError(`${where}: "id" may only use lowercase letters, numbers and dashes`);
    if (seen.has(entry.id)) throw new ShowsError(`${where}: another show already uses id "${entry.id}"`);
    seen.add(entry.id);

    const startDate = parseDate(entry.start, `${where} "start"`);
    const endDate = entry.end ? parseDate(entry.end, `${where} "end"`) : new Date(startDate.getTime() + DEFAULT_LENGTH_MS);
    if (endDate <= startDate) throw new ShowsError(`${where}: "end" must be after "start"`);
    const hideDate = entry.hideAfter ? parseDate(entry.hideAfter, `${where} "hideAfter"`) : endDate;

    if (entry.cta !== undefined) {
      if (!entry.cta?.label || !/^https?:\/\//.test(entry.cta?.url ?? '')) {
        throw new ShowsError(`${where}: "cta" needs a "label" and a full "url" starting with https://`);
      }
    }

    if (!POSTER_FILE.test(entry.poster)) {
      throw new ShowsError(
        `${where}: "poster" must be a file name (no folders or spaces) ending in .webp, .png or .jpg — got "${entry.poster}"`,
      );
    }
    const posterPath = join(postersDir, entry.poster);
    if (!existsSync(posterPath)) throw new ShowsError(`${where}: poster file not found — add src/assets/posters/${entry.poster}`);
    const bytes = readFileSync(posterPath);
    const { width, height } = imageSize(bytes, `${where} poster`);

    if (bytes.length > MAX_POSTER_BYTES) {
      warnings.push(`${entry.id}: poster is ${(bytes.length / 1024).toFixed(0)} KB — shrink it (aim for under ${MAX_POSTER_BYTES / 1024} KB) so phones load fast`);
    }
    if (width > MAX_POSTER_WIDTH) {
      warnings.push(`${entry.id}: poster is ${width}px wide — export it around 760px wide, it never displays larger than that`);
    }
    if (!entry.city && !entry.address) {
      warnings.push(`${entry.id}: add a "city" (or "address") so Google can show this as an event`);
    }

    return { ...entry, startDate, endDate, hideDate, width, height, posterUrl: `assets/posters/${entry.poster}` };
  });

  return { shows, warnings };
}

/** Shows that haven't finished yet, soonest first. */
export function upcoming(shows, now) {
  return shows.filter((s) => s.hideDate > now).sort((a, b) => a.startDate - b.startDate);
}

const plain = (s) => s.replace(/\u202f/g, ' '); // newer ICU puts a narrow no-break space before AM/PM

export function whenLabels(show, timeZone) {
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(show.startDate);
  const timeLabel = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(show.startDate);
  return { dateLabel: plain(dateLabel), timeLabel: plain(timeLabel) };
}

// ── calendar ────────────────────────────────────────────────────────────────

const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const where = (show) => [show.venue, show.address, show.city].filter(Boolean).join(', ');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const details = (show, site) =>
  [show.description, show.cta ? `${capitalize(show.cta.label)}: ${show.cta.url}` : '', `More: ${site.url}/`].filter(Boolean).join('\n\n');

export function googleCalendarUrl(show, site) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: show.title,
    dates: `${utc(show.startDate)}/${utc(show.endDate)}`,
    details: details(show, site),
    location: where(show),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** iCalendar lines may not exceed 75 bytes; longer ones continue on a line starting with a space. */
function fold(line) {
  const lines = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > 75) {
      lines.push(current);
      current = ` ${ch}`;
      bytes = 1 + size;
    } else {
      current += ch;
      bytes += size;
    }
  }
  lines.push(current);
  return lines;
}

export function toIcs(show, site, now) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${site.name}//Website//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${show.id}@${new URL(site.url).hostname}`,
    // Day precision: builds on the same day produce identical files, so publishing
    // again without changes doesn't add a new commit to the web branch.
    `DTSTAMP:${utc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))}`,
    `DTSTART:${utc(show.startDate)}`,
    `DTEND:${utc(show.endDate)}`,
    `SUMMARY:${icsText(show.title)}`,
    `LOCATION:${icsText(where(show))}`,
    `DESCRIPTION:${icsText(details(show, site))}`,
    `URL:${show.cta?.url ?? `${site.url}/`}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

// ── structured data (Google event rich results) ─────────────────────────────

export function eventJsonLd(show, site) {
  const [locality, region] = (show.city ?? '').split(',').map((s) => s.trim());
  const hasAddress = show.address || locality;
  return {
    '@type': 'Event',
    name: show.title,
    startDate: show.start,
    endDate: show.end ?? show.endDate.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: show.venue,
      address: hasAddress
        ? {
            '@type': 'PostalAddress',
            streetAddress: show.address,
            addressLocality: locality,
            addressRegion: region,
            addressCountry: 'US',
          }
        : undefined,
    },
    image: [`${site.url}/${show.posterUrl}`],
    description: show.description,
    url: `${site.url}/`,
    performer: { '@id': `${site.url}/#michael` },
  };
}
