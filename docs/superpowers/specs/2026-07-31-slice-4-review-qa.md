# Slice 4 — Review & QA

**Status:** draft. §1 needs a decision before building; everything else follows from it.
**Design:** `docs/design/README.md` Screen 3 (lines 518–642).
**Base:** `main` @ `3dbca00` — 420 web / 328 sidecar green.

**Purpose (design):** morning-after triage. Two columns, `gap: 16px`.

---

## 0. What changed, and what did not

Hand-back item 1 shipped on 2026-07-31: `qa_tier2` now returns `subs[].metrics` —
`star_count`, `fwhm`, `hfr`, `eccentricity`, `snr`, `background`, `scattered_light`, each
nullable, with `metrics.error` set when a sub could not be analysed. Verified at source:
`qa_tier2` returns `{"summary": self._compact_report(report)}` and `_compact_report` now
carries `"metrics": _compact_metrics(v.metrics)`.

Measured payload, from their built code rather than an estimate: **298 B/PASS sub, 320 B/REJECT**
— roughly 59 KB at 200 subs, 206 KB at 700, **412 KB at 1400**. Per-target, inline, no pagination.
A columnar variant is available on request; we do not need it — 412 KB parses in milliseconds and
our constraint is DOM nodes, not bytes.

**So the shape is unblocked. Getting the data is not, and that is this slice's real problem.**

---

## 1. The data problem — decide before building

Three facts, each verified:

**a. There are no stored reports.** `find` over the server's data directory returns **zero**
`qa_report*.json` artifacts. The "read the artifacts `qa_session_report` previously wrote" option
that `CLAUDE.md` names does not currently have anything to read.

**b. There is still no read-only getter for a written report.** This was flagged as item 1's
"related gap" and is not part of what shipped. `qa_session_report` writes artifacts *and winds down
the session*, so the dashboard can never call it — it would generate files on every refresh.

**c. `qa_tier2` computes from scratch, and cannot see the archive as-is.** `_resolve_paths`
(`server.py:458`) globs `data_dir` **non-recursively** for `*.fit`/`*.fits`. The user's archive is
nested — `…/SeeStar/<Target>_sub/Light_*.fit` — so a bare `qa_tier2(target=…)` finds nothing.
It does accept explicit `paths`, which is the way in.

It is also **expensive**: photutils over every FITS in a target, 200–1400 subs at ~4 MB each. This
is minutes of CPU, not a page-load fetch. Their own correction confirms the intent — Tier-2 is a
**post-session** activity, which suits "morning-after triage" exactly, but not an on-render call.

### Options

**A — On-demand, explicitly triggered, cached.** The sidecar resolves a target to its FITS paths
from the archive scan it already does, calls `qa_tier2(paths=…)`, and caches the result to disk.
The screen shows a target list with "analysed / not yet analysed", and analysis is a deliberate
action with visible progress, not something a page load starts.

**B — Wait for a read-only report getter** (the item 1 related gap) plus persisted reports.
Cleanest long-term, and it puts the caching where the analysis is. Blocks the screen indefinitely.

**C — Sidecar reimplements scoring.** Rejected outright: QA verdicts and thresholds are
server-owned policy, and `CLAUDE.md` forbids exactly this.

**Recommendation: A, and raise B as a hand-back.** A is honest about cost, gives the user control
over when a heavy job runs, and produces the cache that B would otherwise provide. It reuses
`archive.py`'s existing scan rather than adding a second view of the same tree.

**The one thing A must get right:** analysis is minutes long. It cannot block a request, and it
cannot be retried automatically. Progress, cancellation and a clear "this will take a while" are
part of the feature, not polish.

---

## 2. What the screen shows (design §Screen 3, 518–642)

Two columns. Left: session summary and the verdict distribution. Right: per-sub charts —
eccentricity, FWHM, SNR, star count — and the per-sub table.

**Verdicts are rendered, never computed.** PASS / MARGINAL / REJECT and every threshold behind them
are server-owned (`config.py`; `docs/qa-policy-SKILL.md`). The UI displays `verdict` and `reasons[]`
as returned. It does not re-derive a verdict from `metrics`, does not colour by its own cutoffs, and
does not hardcode the numbers in the policy table.

Each verdict must stay traceable to a metric and a threshold — the policy's standard is *"an
auditable, defensible quality verdict, never a vibe"*, e.g. *"REJECT — eccentricity 0.61 ≥ 0.575
cutoff (tracking error)"*. `reasons[]` carries that; render it rather than reducing it to a colour.

**Every metric is nullable.** A sub that could not be analysed still appears, with `metrics.error`
set. Render it as an unanalysed row, not as a zero and not as a rejection.

---

## 3. Scale — this is the screen where it bites

Real nights: 200–1400 subs per target. Four charts over 1400 points, with **no charting library**
(the CSS-bars decision), is 5600 absolutely-positioned nodes if built naively.

The reference notes are explicit: *"Per-sub views need virtualization or aggregation. Low-sub
targets (e.g. 83 subs) are genuinely noisy results — don't smooth them into looking like a
1386-sub stack."*

So: virtualise or aggregate, but **do not make a sparse target look dense**. A 83-sub result should
read as thin, because it is.

---

## 4. Known-honest states

- **No analysis yet** for a target — the common case initially, and not an error.
- **Analysis running** — minutes, with progress.
- **`metrics.error`** on individual subs inside an otherwise good report.
- **`median_fwhm` is nullable forever.** Now backfilled from the newest QA report where one exists,
  but a session never scored still cannot report one, and pre-fix records were not backfilled.
- **Eccentricity dominating rejects is real alt-az field rotation**, worst near zenith — expected,
  and the policy says so. Do not present it as anomalous.

---

## 5. To raise with the server team

1. **A read-only `get_session_report(target, date)`** — item 1's related gap, unaddressed. With it,
   option B replaces option A's caching and the heavy path runs once, server-side, where it belongs.
2. **`_resolve_paths` is non-recursive**, so `qa_tier2(target=…)` cannot see a real archive layout.
   Passing explicit `paths` works and is what we will do, but a recursive option would make the
   `target` argument actually usable.
3. **A stale docstring**, worth flagging given they just corrected two others: `qa_tier2`'s own
   docstring (`server.py:511`) still reads *"does not dump full metrics for every sub"* — which
   their own change has just made false. Their closing note applies to themselves here: a comment
   is evidence about what someone believed, not about what the code does.
