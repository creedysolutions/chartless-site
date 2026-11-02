# STOP: do not deploy this folder directly

chartless.creedysolutions.com runs the **redesign**. This folder is still where the content lives (pages, guides, images,
`/media`, feeds), so keep editing here as usual, but it is **not** what gets deployed anymore.

Running `wrangler pages deploy` from here (or uploading this folder to the `chartless-site` Pages project any
other way) puts the OLD design back on the live site. That happened once already (2026-11-01).

## How to publish a change

1. Make the change here (edit a page, add a guide, drop files into `media/` or `assets/`).
2. From `~/Documents/CreedySolutions/sites/creedysolutions-redesign`:

   ```bash
   node remake/rebrand/chartless-site.mjs && python3 remake/rebrand/release.py
   npx wrangler@4 pages deploy dist/chartless --project-name chartless-site --branch main --commit-dirty=true
   ```

   The build restyles the pages, merges in every other file from this folder unchanged, and checks the
   result before anything ships.

Keep it free of a `404.html`: the app's `/open?url=` deep link relies on Pages serving index.html for
unknown paths. The contact form and its `?sent=1` confirmation are checked by the build.

Details, rollback and the full rules: `creedysolutions-redesign/KEEP.md`, section 0.
Not covered here: fawnhaven.creedysolutions.com is a separate project and stays exactly as it is.
