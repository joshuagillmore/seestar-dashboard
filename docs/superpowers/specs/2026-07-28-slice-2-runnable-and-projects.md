# Slice 2 — Runnable, and the Projects screen

**Date:** 2026-07-28
**Status:** awaiting review
**Depends on:** slice 1 (merged, `d7d6ba2`)

---

## 1. Why these two together

Slice 1 works but cannot be *used*: running it means two terminals and a Vite
dev server. That is a strange place to stop, so phase 1 makes it launchable
before any new screen is added.

Projects is then the natural next screen — the smallest of the four, and the one
that finally puts the user's 20.9 h photo archive to work.

The slice splits into three phases, each shipping something on its own:

| Phase | Ships | Depends on |
|---|---|---|
| **1 · Runnable** | one process, one port, offline-capable | — |
| **2 · Projects** | real integration totals, cards, session history | phase 1 |
| **3 · Suggested targets** | catalogue extension + goal model + doubling | phase 2 |

Phase 3 is separable on purpose. If it runs long, phases 1–2 still leave a
usable dashboard with a second working screen.

**Planning recommendation: write the implementation plan for phases 1–2 only.**
Slice 1 was thirteen tasks; phases 1–2 are comparable, and phase 3 adds a
catalogue extension, a two-track goal model and a new client-state mechanism on
top. Planning all three at once would produce a plan too long to hold in one
context, which is how tasks start contradicting each other.

Phase 3 also has one input still unresolved (§4): the goal formula's constants.
The user's heuristic gives 15 h for this site; published guidance suggests
20–30 h for faint targets. That difference is not a rounding detail — it is the
difference between M 31 reading 14% complete and 8% — and it should be settled
before phase 3 is planned, not decided by whoever implements it.

---

## 2. Phase 1 — Runnable

### The problem

`npm run preview` serves `dist` with no proxy, so every API call 404s. The only
working configuration is `uv run uvicorn` plus `vite dev` in separate terminals.

### The change

The sidecar serves the built frontend. FastAPI mounts `web/dist` at `/` with
`StaticFiles(html=True)`; `/api/*` continues to serve tools. One process, one
port, no proxy, no CORS in production.

- Route order matters: the `/api` router must be registered **before** the
  catch-all static mount, or the mount swallows API paths.
- `StaticFiles(html=True)` serves `index.html` for unknown paths, which is right
  for a single-page app and stays correct when a router arrives in a later slice.
- The dev loop is unaffected — Vite keeps its proxy, and the CORS middleware
  stays for that origin. Production simply never uses either.
- If `web/dist` is absent, the sidecar must still boot and serve `/api/*`,
  returning a clear message at `/` telling the user to run `npm run build`.
  A missing frontend is a setup state, not a crash.

### Fonts

`index.html` loads IBM Plex from `fonts.googleapis.com`. The sidecar has a full
offline replay mode; the typography does not. Self-host both families as static
assets so the whole app works with no network. The Sans/Mono split is
load-bearing per the design, and a fallback to `system-ui` loses it.

### The 502 message

Found by looking at the running app, not by any test. With Vite's proxy in
front, a dead sidecar makes `fetch` **resolve** with a 502 and a non-JSON body,
so `client.ts` falls through to `` `HTTP ${response.status}` `` and the banner
reads **"HTTP 502"**. Accurate and useless.

The existing test stubs `fetch` to *reject*, which exercises a path the dev
setup never takes — which is exactly why this survived slice 1's review.

Fix: when the response is not ok and the body is not JSON, say what failed and
what to do — naming the sidecar and its expected address. Add a test that
covers the resolve-with-502-and-HTML case, not only the reject case.

### Launcher

A single documented command, and a Windows shortcut target so using the
dashboard does not require a terminal:

```
uv run uvicorn seestar_sidecar.main:create_app --factory --port 8000
```

Then `http://localhost:8000`. Port 8000 is currently taken by Docker Desktop on
this machine — the launcher should fail with a clear message naming the port
rather than a stack trace, and the port must be overridable.

---

## 3. Phase 2 — Projects

### What the design specifies

`docs/design/README.md` § Screen 4. Cards in a `repeat(3, 1fr)` grid, each a
horizontal flex with a 96px cover, target id and status tag, hours collected
against a goal, a 6px progress track, and a meta line. Below, a session-history
table scoped to the selected card.

### What the data actually supports

Three findings from slice 1's investigation change this screen:

**Every project has `goal_minutes: 0.0`.** All 15. So the designed
goal-progress view has nothing to render, `recommend_projects` degrades to
creation order because nothing is short of a goal, and the header line
(*"NGC 1499 first — 6.9 h short of goal"*) has no source. Goals can only be set
via `set_project_goal`, a **write** tool permanently outside the allowlist.

**Two disjoint records of what has been imaged, neither complete.** The store
holds 9.1 h across 15 targets (Jul 2026); the archive at
`C:\Users\<user>\OneDrive\Documents\SeeStar` holds 20.9 h across 20 targets
(Dec 2023 – Mar 2024). They overlap on two. For M 31 the store has 84.2 min and
the archive a further 38.3, so **neither knows the real ~122 min**.

**`recommend_projects` returns the same shape as `list_projects`** — full
`Project` objects, reordered. One schema, not two.

### The screen this slice builds

Integration-led rather than goal-led. Hours collected is the primary number,
sorted by most time invested. The progress track renders only where a target
exists (none in phase 2; phase 3 supplies suggestions). Session history sits
below, scoped to the selected card, unioned across both sources.

This keeps every structural element of the design and changes only which fact
leads — and it degrades into the designed view automatically once goals exist.

### Archive reconciliation

A read-only scan in the sidecar:

- One `Light_*.fit` per directory `<target>-sub/` is one sub. Exposure is fixed
  at 10.0 s across the whole archive — confirmed by the user, and every filename
  encodes it — so integration is `count × 10 s`. No per-file parsing.
- Normalise `M 31` → `M31` for the join; the archive uses spaced catalogue
  names and the tools use unspaced ids.
- Union with `list_projects`, **de-duplicating by night**. Today the two sources
  do not overlap by date at all, so de-duplication is a no-op — but any future
  session writes to both, so it must exist and be tested with a synthetic
  overlapping fixture rather than left untested because live data cannot reach it.
- One directory is literally named `Unknown` (535 subs, 89 min). Surface it as
  `Unknown` rather than dropping it or guessing.

**Measured cost: 0.04 s** for the full 7,533-frame scan; a directory-mtime probe
is 3 ms. **No cache, no database.** Persistence here would be a third source of
truth beside the store and the filesystem, which is the "which number is true"
problem this project keeps refusing to create.

### New routes

`list_projects` and `recommend_projects` join the allowlist. Both are read-only.
This is the first time the allowlist grows, so:

- The route-set invariant test from slice 1 asserts registered `/api/*` paths
  equal `{health} ∪ ALLOWED_TOOLS` exactly — it will fail until updated, which
  is the test doing its job.
- `record.py` indexes `ARGUMENTS[tool]` while iterating `ALLOWED_TOOLS`, so a
  new tool without an arguments entry raises `KeyError` mid-loop with fixtures
  half-written. This is the slice the deferred one-line `assert` must land in.
- Record fixtures for both new tools before building against them.

---

## 4. Phase 3 — Suggested integration targets

### The formula

Derived from the user's brief and checked against published guidance.

**Surface brightness drives it**, not integrated magnitude — a magnitude-4
object across 85′ and a magnitude-4 star are different exposure problems
entirely. Computed from data the catalogue already carries:

```
SB ≈ magnitude + 2.5 · log₁₀(π · (size_arcmin · 60 / 2)²)   mag/arcsec²
```

Sanity-checked against published values: M31 23.3, M42 22.3, M45 20.4,
M101 23.8. Open clusters land at 19.8–20.1 (least time), emission nebulae and
supernova remnants at 24–25.5 (most). The ranking is derived, not a lookup table
anyone has to maintain.

**Scaled by f-ratio and sky.** The S50 is f/5; the site is Bortle 8. The user's
starting heuristic — hours equal to f-stop, ×3 for Bortle 7–8 — gives 15 h.
Published guidance for Bortle 8–9 runs 24–36 h for faint targets. The constants
should be calibrated toward the literature rather than taken as given, and must
be **named constants in one place**, not scattered.

> **Corrected 2026-07-30.** This paragraph previously cited "one widely cited
> figure has 2 h of dark-sky signal needing ~4.5 h at Bortle 5 (already 2.25×)".
> **That figure could not be traced to any source**, and two independent
> estimates for the same span — the Bortle/Unihedron SQM table (~7×) and a
> published calculator's worked example (9.8×) — disagree with it by a factor of
> 3–4. It has been struck rather than cited. See
> `.superpowers/integration-constants-research.md`.
>
> Two further findings from that research change this section:
>
> 1. **The f-ratio term is not live.** `t ∝ f-ratio²` for extended objects is
>    standard and confirmed, but the S50's f/5 is fixed, so it belongs baked into
>    the reference constant, not expressed as a separate term. It only becomes a
>    real variable if the model generalises across other smart-scope bodies.
> 2. **The Bortle penalty must be two curves, not one.** Broadband runs ~50–100×
>    from Bortle 1→8 (SQM-derived, moderate confidence); narrowband/dual-band is
>    far flatter, tentatively ~1.5–3×. The qualitative consensus for the
>    narrowband flattening is strong across many sources but **no source
>    publishes a number** — ours is an extrapolation and must be labelled as one
>    in the code.

**The rule of doubling is exactly right and has the maths behind it.** SNR
improves with √t, so a doubling buys ~41% and anything smaller is invisible.
That justifies a doubling control rather than a free-text field.

### Two tracks, and the card says which

Not every object has photometry, and for some the quantity does not exist.
SIMBAD has SH2-142 as a 30′ HII region with **no magnitude in any band** — not
an omission, but because integrated magnitude is not well-defined for a diffuse
nebula. LDN 1625 is a *dark* nebula: an absorption feature with nothing to
measure.

| Track | Applies to | Input | Shown as |
|---|---|---|---|
| **Photometric** | galaxies, planetary nebulae, nebulae with photometry | computed surface brightness | a target with a figure |
| **Cluster** | open and globular clusters | type + angular size, flat band | a target, marked coarse |
| **None** | no photometry, diffuse HII, dark nebulae | — | no target; hours only |

> **Corrected 2026-07-30**, on two research findings.
>
> **The "classified" track as originally drafted does not exist.** It proposed
> deriving a target from Sharpless brightness class or Lynds opacity class.
> There is **no published linkage from either class to exposure time, in any
> source found** — these schemes come from 1950s–60s photographic surveys and
> predate digital SNR calculation entirely; nobody has published a bridge.
> Diffuse HII and dark nebulae therefore fall to **None**, which is what the
> section below already argues for on separate grounds.
>
> **Clusters have moved off the photometric track.** The surface-brightness
> formula is the standard mean-SB definition and is correct as written, but mean
> SB over the catalogued area is a poor predictor of imaging difficulty when the
> signal is *concentrated rather than spread*. M45's SB of 20.4 comes from
> smearing integrated starlight across a 110′ disk, while what is actually
> imaged is bright pinpoint stars. This is a structural property of the input,
> **not something a different exponent can fix** — so clusters get their own
> flat band, marked coarse. The same effect applies mildly to bright galaxy
> cores such as M31's and is accepted there.

Forcing everything down one path would put a confident wrong number on M45 —
a magnitude 1.6 cluster that reads 8% complete against a flat 15 h baseline and
is, by the user's own rule, essentially finished.

### The target is a quality tier, not a constant

**Added 2026-07-30.** The single most consequential research finding is not a
number. Published totals for one object at roughly fixed Bortle span **2 h 10 m
to 100 h** — M101 appears at 2 h 10 m described as "healthy SNR", at 6 h 18 m, at
56.5 h, and at 100 h for a deep project. **That ~50× spread on a single object is
wider than the surface-brightness range across the entire catalogue.**

So the hours figure is a choice of quality percentile, not a physical
requirement, and no calibration of `k` can make it otherwise. Two consequences:

- The model targets the **"solid / presentable"** tier deliberately, and that
  choice is recorded in the constants module rather than left implicit.
- **The copy must not imply the number is required.** "Suggested" or "typical
  for a presentable result", never "needed". A progress bar reading 40% must not
  be read as the image being unfinished — under the user's own doubling rule,
  anything past a doubling is a judgement call, which is exactly why the
  doubling control exists.

There is also **no canonical amateur formula** for total integration vs surface
brightness — the closest citable framework (Glover / SharpCap) answers *optimal
sub-exposure length*, a different question. The curve we ship is an empirical fit
to observed practice and is labelled as such in the code, not dressed up as
physics.

### Catalogue extension

The server's catalogue is 120 objects; **10 of the user's 20 archive targets are
absent**, including IC 405 — their single largest investment at 217 minutes.
This is not only a dashboard problem: `plan_targets` can only rank what is in
that catalogue, so **the ranker is structurally incapable of ever suggesting
IC 405, NGC 1499 or SH2-142.**

Deliverable, staged in `docs/handback/` as the artifact accompanying hand-back
item 11:

- **OpenNGC** filtered to Seestar-suitable objects — 3′–60′, mag ≤ 12, excluding
  duplicates and star entries: **1,099 objects**, a 9× expansion that stays
  useful. The full 14,034 would have the ranker recommending 621 faint galaxies
  an f/5 50 mm cannot resolve, making it worse.
- **Sharpless VII/20** and **Lynds VII/7A** for the diffuse objects OpenNGC does
  not cover (SH2-142, LDN 1625).
- Emitted in `dso_catalog.json`'s own format with a provenance header.

**Licences differ and must be recorded**, since SeeStar-AI is MIT and public:
OpenNGC is **CC-BY-SA-4.0** (attribution, share-alike on the data); VizieR/CDS
catalogues require citing the original papers. Neither blocks use; both need a
notice.

### Doubling control

Per project, persisted in `localStorage` — the only new client state. It is not
a server concept, and `set_project_goal` is a write tool the allowlist excludes,
so this cannot round-trip. The UI must be clear that doubling is a local view
adjustment, not something the telescope knows about.

---

## 5. What this slice does not do

- No container. The sidecar spawns the MCP server over stdio, so an image must
  bundle SeeStar-AI and its scientific stack, duplicating `deploy/docker/` that
  already exists there. If headless deployment is wanted, it belongs in that
  compose file, not a parallel stack here.
- No database. See phase 2 — 0.04 s scan, and a third store is the problem, not
  the solution.
- No goal *setting*. `set_project_goal` writes, so it stays out of the allowlist
  permanently.
- No Live, Review or mobile screens.
- No image serving yet. The archive has `Stacked_*_thn.jpg` per target and the
  design wants covers, but serving image bytes is a new route class needing its
  own read-only, path-constrained design. Phase 2 leaves the cover slot absent
  rather than half-built.

---

## 6. Testing

Same gate as slice 1: `npm test` **and** `npm run build` — `noUnusedLocals`
makes a green suite insufficient — plus `uv run pytest`.

Specific to this slice:

- **The archive scan needs fixtures, not the real 19,622-file directory.** A
  small synthetic tree under `sidecar/tests/` with a known frame count, so the
  test is fast, hermetic and does not depend on a OneDrive path.
- **De-duplication must be tested with an overlapping fixture**, because live
  data cannot exercise it — the two sources do not overlap by date today.
- **Surface-brightness computation gets unit tests** against the four
  hand-checked values (M31 23.3, M42 22.3, M45 20.4, M101 23.8).
- **The route-set invariant** must be updated deliberately when the allowlist
  grows, not loosened.
- Slice 1's lesson stands: for every assertion, ask what change would break it.
  Six assertions in slice 1 looked meaningful and could not fail. Prefer proving
  it by mutation over reading.

---

## 7. Hand-backs this slice produces

| # | Item | Why it matters |
|---|---|---|
| 10 | Provenance cannot distinguish clients | Blocks slice 5's operator panel; the `log_call` fields already exist and are simply unused |
| 11 | Catalogue covers 120 objects | The ranker cannot suggest the user's most-imaged target; extension artifact supplied |
| 12 | `list_projects` should return `target_type` | Avoids a per-target `get_target_observability` call just to classify |
| 13 | Backfill the store from the archive | Would make `list_projects` the single source of truth and let the sidecar's scan be deleted |
| — | The goal formula itself | Once calibrated, belongs in `config.py` so `recommend_projects` can rank by shortfall against it |
