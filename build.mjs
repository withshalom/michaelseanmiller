#!/usr/bin/env node
// Builds the website into dist/.  Usage:
//   node build.mjs            build once (this is what GitHub Actions runs)
//   node build.mjs --serve    build, serve at http://localhost:8080 and rebuild on every save
//
// No dependencies — just Node 20+. Walkthrough: docs/UPDATING.md

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { imageSize } from './lib/images.mjs';
import { eventJsonLd, googleCalendarUrl, parseDate, prepareShows, toIcs, upcoming, whenLabels } from './lib/shows.mjs';
import { createPartialLoader, lookup, render } from './lib/template.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** "Now" for the build. Set SITE_NOW=2026-11-01T12:00:00-08:00 to preview the site on another day. */
export function resolveNow(env = process.env) {
  if (!env.SITE_NOW) return new Date();
  const date = new Date(env.SITE_NOW);
  if (Number.isNaN(date.getTime())) throw new Error(`SITE_NOW="${env.SITE_NOW}" is not a valid date`);
  return date;
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file.replace(`${ROOT}${sep}`, '')} is not valid JSON — ${error.message}`);
  }
};

/** Replace {{ site.x }} placeholders inside every string of a JSON structure. */
function fill(value, data) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
      const found = lookup(path, data);
      if (found === undefined || found === null) throw new Error(`structured-data.json: "${path}" is not defined`);
      return String(found);
    });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, data));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, data)]));
  return value;
}

export function build({ root = ROOT, outDir = join(root, 'dist'), now = resolveNow(), log = console.log } = {}) {
  const src = join(root, 'src');
  const site = readJson(join(src, 'data/site.json'));
  const { shows, warnings } = prepareShows(readJson(join(src, 'data/shows.json')), { postersDir: join(src, 'assets/posters') });
  const live = upcoming(shows, now);

  // Lessons promo: size the image from the file, hide the deadline flag once it passes.
  const lessonsImage = join(src, 'assets', site.lessons.image);
  if (!existsSync(lessonsImage)) throw new Error(`site.json lessons.image not found: src/assets/${site.lessons.image}`);
  const { width, height } = imageSize(readFileSync(lessonsImage), 'lessons image');
  const flagVisible = Boolean(site.lessons.flag) && (!site.lessons.flagEnds || parseDate(site.lessons.flagEnds, 'site.json lessons.flagEnds') > now);
  const lessons = { ...site.lessons, width, height, flagVisible };

  const present = (show) => ({
    id: show.id,
    title: show.title,
    venue: show.venue,
    posterUrl: show.posterUrl,
    posterAlt: show.posterAlt,
    width: show.width,
    height: show.height,
    ...whenLabels(show, site.timezone),
    linkUrl: show.cta?.url ?? show.posterUrl,
    ariaLabel: show.ariaLabel ?? `${show.title} at ${show.venue}. Opens the ${show.cta?.label ?? 'full-size flyer'} in a new tab`,
    googleUrl: googleCalendarUrl(show, site),
    icsUrl: `calendar/${show.id}.ics`,
  });

  const graph = fill(readJson(join(src, 'data/structured-data.json')), { site });
  graph['@graph'].push(...live.map((show) => eventJsonLd(show, site)));

  const data = {
    site: { ...site, lessons },
    year: new Intl.DateTimeFormat('en-US', { timeZone: site.timezone, year: 'numeric' }).format(now),
    showcaseClass: live.length ? '' : ' is-video-only',
    featured: live[0] ? present(live[0]) : null,
    more: live.slice(1).map(present),
    moreClass: live.length === 2 ? ' upcoming-grid--single' : '',
    jsonLd: JSON.stringify(graph, null, 2).replace(/</g, '\\u003c'),
  };

  const html = render(readFileSync(join(src, 'page.html'), 'utf8'), data, {
    name: 'page.html',
    loadPartial: createPartialLoader(join(src, 'partials')),
  });

  // Write everything to a fresh dist/.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);

  if (live.length) {
    mkdirSync(join(outDir, 'calendar'), { recursive: true });
    for (const show of live) writeFileSync(join(outDir, 'calendar', `${show.id}.ics`), toIcs(show, site, now));
  }

  const copy = (from, to) => existsSync(from) && cpSync(from, to, { recursive: true, filter: (p) => !basename(p).startsWith('.') });
  copy(join(src, 'assets'), join(outDir, 'assets')); // images, CSS, JS
  copy(join(src, 'static'), outDir); // files that belong at the site root (og-image.jpg, favicon, …)
  copy(join(root, 'CNAME'), join(outDir, 'CNAME')); // custom domain

  const shareImage = site.seo.shareImage.replace(/^\//, '');
  if (!existsSync(join(outDir, shareImage))) {
    warnings.push(`${shareImage} is missing — links shared on social media will have no preview image. Put a 1200×630 image at src/static/${shareImage}`);
  }

  const summary = {
    outDir,
    upcoming: live.map((s) => s.id),
    hidden: shows.filter((s) => !live.includes(s)).map((s) => s.id),
    warnings,
  };
  log(`Built ${outDir.replace(`${root}${sep}`, '')}/  ·  ${live.length} upcoming show(s)${live.length ? `: ${summary.upcoming.join(', ')}` : ''}  ·  ${summary.hidden.length} past/hidden`);
  warnings.forEach((w) => log(`  ⚠ ${w}`));
  return summary;
}

// ── local preview server ────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ics': 'text/calendar; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serve(outDir, port) {
  createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = join(outDir, normalize(pathname));
    if (file.startsWith(outDir) && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`Preview: http://localhost:${port}  (rebuilds when you save; Ctrl+C to stop)`));
}

function main() {
  const watching = process.argv.includes('--serve');
  const attempt = () => {
    try {
      build();
    } catch (error) {
      console.error(`\n✖ Build failed: ${error.message}\n`);
      if (!watching) process.exit(1);
    }
  };
  attempt();
  if (!watching) return;

  serve(join(ROOT, 'dist'), Number(process.env.PORT) || 8080);
  let timer;
  watch(join(ROOT, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(attempt, 150);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
