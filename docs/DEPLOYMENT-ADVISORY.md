# Deployment Advisory: michaelseanmiller.com

*Written 2026-11-23 by Claude for WithShalom Design. This is advice for a future build session, not a record of work done. Nothing here has been implemented.*

## 1. Where things stand today

| Item | Current state |
|---|---|
| Repository | `withshalom/michaelseanmiller`, public, branch `main` |
| Files | `index.html`, `CNAME`, `README.md`, `docs/headshot.jpg` (README only) |
| Hosting | GitHub Pages serving the repo root on `michaelseanmiller.com` |
| Build step | None. Updates are made by uploading a new `index.html` through GitHub's web page ("Add files via upload") |
| Page weight | 733 KB. About 92% of it (677 KB) is five base64-embedded WebP images |
| Editing model | One generated file with images, CSS, JSON-LD and copy mixed together |

The single-file approach was chosen deliberately: it was the one setup that could be deployed reliably by upload, and it has worked. This document is about what to do when it starts to cost more than it saves.

## 2. Pain points seen in practice

These come from the real update cycles on this site (July to November 2026), not from theory.

1. **Every update re-does the same manual steps.** Swap the featured poster, re-encode images to WebP, retune the marquee tile sizes, rewrite the JSON-LD Event, change nav and footer links, prune the past event.
2. **Dates are typed by hand.** Flags like "This Saturday", "Today", "In 2 Days" and "Tomorrow" were edited as text for each show and go stale the moment the date passes. A design note for automatic labels was written in August and not yet built.
3. **Past content lingers.** The Halloween lessons deadline sat on the page after November 2 until someone noticed.
4. **Images dominate the file.** Each new poster adds 150 to 250 KB to a file that every visitor must download in full, including the images far down the page.
5. **Missing site files.** `og-image.jpg` is referenced by the Open Graph tags, Twitter card and JSON-LD but is not in the repository, so social link previews likely show no image. There is also no `robots.txt`, `sitemap.xml` or 404 page.
6. **The hero sits low in the page order**, below the video, featured section, booking and marquee. A known quirk that has never been addressed.
7. **No safety net.** Uploads go straight to `main` and straight to the live site. There is no preview, no automated check, and rollback means finding an old file.

## 3. Constraint to confirm first

The site has been held to "one monolithic HTML file, no multi-file deployments." Before choosing a path below, confirm *why*:

- If the reason is **how files get onto the host** (dragging one file into GitHub's web page), that is a workflow problem. GitHub Pages can serve any number of files and folders, and the web uploader accepts multiple files and folders at once. Options B and C below remove the need to upload anything by hand.
- If the reason is **how Michael or a client might receive and move the site** (emailing one file, opening it from a USB stick), keep single-file output. Option A does this.

## 4. Options, from smallest change to largest

### Option A: Keep one deployed file, but build it from clean sources (recommended first step)

Keep publishing a single `index.html`, but stop editing that generated file directly.

```
michaelseanmiller/
  src/
    index.template.html     page structure and CSS, no embedded images
    events.json             upcoming shows, with real dates
    promos.json             featured promos (holiday, lessons) with start and end dates
    images/                 original poster and photo files
  tools/
    build.py                inlines images as WebP, fills the template, writes the file below
  index.html                generated output; this is what Pages serves
```

What it fixes: pain points 1, 3, 4 (partly), 6 and the structured-data upkeep. A promo with an `end` date drops out automatically at build time. JSON-LD is generated from `events.json`, so the visible text and the search-engine data cannot disagree. Images are re-encoded to a fixed size and quality budget by the script instead of by hand.

Cost: roughly a day of setup. Deployment stays exactly as it is today. The output is still one file.

### Option B: Multi-file static site with automatic deploys

Serve real image files from an `assets/` folder and let GitHub build and publish on every push.

- Images load as separate cacheable files, lazy-loaded below the fold, with `srcset` so phones get smaller versions. The HTML falls from about 733 KB to roughly 55 KB (measured in an earlier session on this site).
- A GitHub Actions workflow runs the Option A build, then publishes with the official Pages deploy action. Pushing to `main` is the only step.
- Add `og-image.jpg`, `robots.txt`, `sitemap.xml` and a `404.html`, which a multi-file layout makes natural.
- Pull requests can be built and checked before they reach the live site.

What it fixes: pain points 4, 5 and 7. Cost: one to two days, and it requires dropping the single-file rule for the *deployed* output.

### Option C: Static site generator with a content-driven workflow

Move to a generator such as Astro or Eleventy. Content lives in simple data files, and the build produces the pages.

- Events, promos, services and testimonials are data. Adding a show means adding five lines to `events.json`.
- Automatic labels ("Today", "Tomorrow", "In 3 Days", "Next Week") run in the browser from each event's date in Pacific Time, following the August design note (`event-countdown-labels-design-note.md`, kept outside this repo). No hand edits.
- Per-page SEO, a generated social image per event, and generated sitemap and structured data.
- Room to grow: a separate wedding page, a gallery, a lessons page, a press page.

What it fixes: everything above, and adds room to grow. Cost: several days, a Node toolchain, and a learning curve. This is only worth it if the site is expected to grow beyond a one-page brochure.

### Not recommended for this site (yet)

A hosted CMS or database-backed site. The update cadence (a few times a month, by one person) does not justify the running cost, the logins, or the extra thing to break.

## 5. Recommended path

1. **Now (an hour): fix the gaps that cost visibility.** Add `og-image.jpg` to the repository, plus `robots.txt` and `sitemap.xml`. These work with the current single file and need no rebuild.
2. **Next build session: Option A.** It removes most of the recurring manual work without changing how the site is published, and it is the safest bridge if the single-file rule has to stay.
3. **When the single-file rule can be relaxed: Option B.** Add the GitHub Actions deploy and real image files. This is the biggest speed and reliability gain per hour spent.
4. **Only if the site grows: Option C.**

## 6. Suggested next-session checklist

- [ ] Confirm the reason for the single-file rule (Section 3)
- [ ] Add `og-image.jpg`, `robots.txt`, `sitemap.xml` to the repo root
- [ ] Decide the data shape for `events.json` and `promos.json` (fields: title, start, end, image, link, label style)
- [ ] Write `tools/build.py`, with an image size and quality budget per slot (marquee, featured poster, lessons, headshot)
- [ ] Implement automatic date labels per `event-countdown-labels-design-note.md`, which is not in this repo and should be re-supplied (Pacific Time; "Next Week" means the next Monday to Sunday week and more than 7 days out)
- [ ] Move the hero higher in the page order, or decide to leave it
- [ ] Add a pre-publish check: page loads, JSON-LD parses, no expired dates visible, total size under a set budget
- [ ] Decide on Option B's Actions deploy if multi-file is allowed
- [ ] Optionally put Cloudflare in front of Pages for caching and analytics, if the domain's DNS is or can be managed there

## 7. Things to keep

Whatever path is chosen, preserve what is working:

- The black-and-gold theme and typography
- Aspect-ratio-based layout (video and art side by side on any landscape screen)
- The tap-to-enlarge lightbox on posters, which makes QR codes scannable on phones
- Tiling marquee, so it fills any screen width
- Experimental directions kept as separate forks, with the production file left clean
- All event date logic in Pacific Time
