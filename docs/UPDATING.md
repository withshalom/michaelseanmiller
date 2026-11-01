# Updating Michael's website

Everything you need to run this site: add a show, preview it, publish it, and how the pieces fit together.

## The three branches

| Branch | What it holds | Do you edit it? |
| --- | --- | --- |
| `main` | The README people see on GitHub. Until you switch the site over, it still holds the original one-file `index.html` that is currently live. | No |
| `michael` | The **source**: page sections, data, styles, images, build script, tests. | **Yes. All changes go here.** |
| `web` | The **finished website**, exactly what visitors get. Built from `michael` by a GitHub Action. | Never by hand |

You change `michael`, push, and a GitHub Action tests the code, builds the site and updates `web`.

## Add a show (the everyday job)

1. **Poster.** Export it about 760 px wide as `.webp` (`.jpg` and `.png` also work), under about 400 KB. Put it in `src/assets/posters/` and name it `YYYY-MM-DD-short-name.webp`.
2. **Entry.** Add one block to the list in `src/data/shows.json`:

   ```json
   {
     "id": "2026-12-05-winery-night",
     "title": "Winery Night with Michael Sean",
     "venue": "Example Winery",
     "city": "Placerville, CA",
     "start": "2026-12-05T18:00:00-08:00",
     "end": "2026-12-05T21:00:00-08:00",
     "poster": "2026-12-05-winery-night.webp",
     "posterAlt": "What the poster says, for people who can't see it: name, date, time, place.",
     "cta": { "label": "ticket page", "url": "https://example.com/tickets" },
     "description": "One or two sentences for the calendar entry."
   }
   ```

   - `start` / `end` need the time zone at the end: `-08:00` from early November to mid-March, `-07:00` the rest of the year. Without `end`, a show lasts three hours.
   - `cta` is the page the poster links to (tickets, a form, Calendly). Leave it out and the poster opens full size.
   - Optional: `address`, `ariaLabel` (the screen-reader label for the poster link), and `hideAfter` (keep a show up past its end time).
3. **Preview, then publish** (next two sections).

What happens by itself: the soonest upcoming show becomes the featured poster, later shows appear under "More upcoming shows", every show gets Google and Apple/Outlook calendar links plus Event data for Google search, and a show disappears once it ends. If no show is upcoming, the video fills the stage.

Old shows can stay in `shows.json` as a record. They are hidden automatically.

## Preview

```bash
npm run dev     # http://localhost:8080 , rebuilds every time you save
```

Needs Node 20 or newer and nothing else, with no install step. Or run `npm run build` once and open `dist/index.html`.

To see the site on another day, for example to check a show disappears: `SITE_NOW=2026-11-15T09:00:00-08:00 npm run build`.

## Publish

```bash
git add -A
git commit -m "Add Winery Night"
git push origin michael
```

Open the **Actions** tab on GitHub. A green check means the site was rebuilt and `web` is updated. A red X means the build refused something. Open the run and read the message; it names the file and what to fix (see Troubleshooting).

## One-time setup

1. **Point the live site at `web`:** Settings → Pages → Build and deployment → Source **Deploy from a branch** → Branch **`web`**, folder **`/ (root)`** → Save. The custom domain stays; the `CNAME` file ships with every build.
2. **Nightly rebuild (optional, but it is how ended shows come down on their own).** GitHub only runs scheduled and manual workflow runs from the repository's *default* branch, which is `main`. Until that changes, a show that has ended stays up until your next push. The simplest fix: Settings → Branches → change the default branch to `michael`. (Merging `michael` into `main` also works. If you do that, change `branches: [michael]` in `.github/workflows/publish-web.yml` to `[main]`.)

To roll back a bad publish, restore the previous commit's files on `web`, or revert the change on `michael` and push again.

## Where things live

| To change | Edit |
| --- | --- |
| Shows and posters | `src/data/shows.json`, `src/assets/posters/` |
| Any outside link (Calendly, wedding site, Instagram, YouTube), contact email | `src/data/site.json` → `links`, `email` |
| The featured video | `src/data/site.json` → `video` |
| The lessons promo (image, deadline flag) | `src/data/site.json` → `lessons` |
| Search and share text, page title | `src/data/site.json` → `seo` |
| Business details for Google | `src/data/structured-data.json` |
| Wording of a section | `src/partials/` (one file per section: `hero.html`, `services.html`, `about.html`, …) |
| Colors, fonts, layout | `src/assets/css/styles.css` |
| Photos | `src/assets/photos/` |
| Social share image | Put a 1200×630 `og-image.jpg` in `src/static/` (anything in there is published at the site root) |

The code that does the work is small: `build.mjs` (the build), `lib/` (templates, shows, calendar files), `test/` (checks that run before every publish).

## Troubleshooting

| Message | Meaning |
| --- | --- |
| `shows.json is not valid JSON` | A typo, usually a missing or trailing comma, or a missing quote. |
| `needs a time zone offset` | Add `-08:00` or `-07:00` to the end of the date. |
| `poster file not found — add src/assets/posters/…` | The file name in `poster` doesn't match a file in that folder. |
| `"x" is not defined` | A `{{ placeholder }}` in a page section has no matching value in `site.json`. |
| `⚠ poster is … KB` or `… px wide` | A warning, not an error. Shrink the poster so phones load faster. |
| `⚠ og-image.jpg is missing` | A warning. Add the share image to `src/static/`. |

## How this was built (to repeat on another client's one-file site)

1. **Work on a branch.** The live branch stays untouched until the new build is proven.
2. **Pull the images out.** Each `data:image/…;base64,…` blob in the HTML becomes a real file in `src/assets/`, named for what it is. This took the page from 963 KB to about 55 KB of actual markup.
3. **Split the page.** CSS to `styles.css`, JavaScript to `main.js`, and the HTML into one partial per section with a thin `page.html` that includes them.
4. **Move what changes into data.** Anything you edit often (shows, links, copy for SEO) goes into JSON, and the template prints it with `{{ placeholders }}`.
5. **Write a small build.** `build.mjs` fills the templates and copies assets into `dist/`. No dependencies, so there is nothing to install and nothing to go out of date.
6. **Prove it matches.** Render the old page and the new build in a browser at desktop and phone widths and compare the screenshots pixel by pixel. For this site they are identical except for the new calendar links.
7. **Automate it.** Tests plus a workflow that builds on every push and publishes to `web`, with Pages serving that branch.
