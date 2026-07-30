# Attribution and licence — DSS2 sky-survey fallback imagery

`sidecar/seestar_sidecar/imagery.py` serves a Digitized Sky Survey (DSS2)
cutout, via CDS's `hips2fits` service, for any target the user has not
personally imaged. This file is the attribution notice that imagery requires,
parallel to `data/ATTRIBUTION-OpenNGC.md` for the catalogue data.

## Required acknowledgment (verbatim, from STScI/MAST)

> Investigators using these scans are requested to include these
> acknowledgments in any publications as appropriate.
>
> The Digitized Sky Surveys were produced at the Space Telescope Science
> Institute under U.S. Government grant NAG W-2166. The images of these
> surveys are based on photographic data obtained using the Oschin Schmidt
> Telescope on Palomar Mountain and the UK Schmidt Telescope. The plates were
> processed into the present compressed digital form with the permission of
> these institutions.
>
> The National Geographic Society — Palomar Observatory Sky Atlas (POSS-I)
> was made by the California Institute of Technology with grants from the
> National Geographic Society.
>
> The Second Palomar Observatory Sky Survey (POSS-II) was made by the
> California Institute of Technology with funds from the National Science
> Foundation, the National Geographic Society, the Sloan Foundation, the
> Samuel Oschin Foundation, and the Eastman Kodak Corporation.
>
> The Oschin Schmidt Telescope is operated by the California Institute of
> Technology and Palomar Observatory.
>
> The UK Schmidt Telescope was operated by the Royal Observatory Edinburgh,
> with funding from the UK Science and Engineering Research Council (later
> the UK Particle Physics and Astronomy Research Council), until 1988 June,
> and thereafter by the Anglo-Australian Observatory. The blue plates of the
> southern Sky Atlas and its Equatorial Extension (together known as the
> SERC-J), as well as the Equatorial Red (ER), and the Second Epoch [red]
> Survey (SES) were all taken with the UK Schmidt.
>
> Supplemental funding for sky-survey work at the ST ScI is provided by the
> European Southern Observatory.

Source: <https://archive.stsci.edu/dss/acknowledging.html> (retrieved
2026-07-30). Copyright provisions for the individual plate series (AAO
Board; UK SERC/PPARC jointly with the AAO Board; Caltech; AURA for
everything else, under NASA contract NAS5-26555) are at
<https://archive.stsci.edu/dss/copyright.html>. This dashboard does not
redistribute the underlying plates — it re-serves cutouts on request via
CDS's hosted service and its own cache, under the same acknowledgment
obligation as any other use of the data.

## The delivery service (CDS hips2fits) is a separate, additional credit

The colour composite and the cutout mechanism itself are CDS's, not STScI's —
`CDS/P/DSS2/color` is "HiPS created by Oberto A. (CDS), Fernique P. (CDS) —
CNRS/Unistra" (per the service's own embedded provenance, checked directly
against a live response 2026-07-30). Citing CDS's HiPS2FITS service
(<https://alasky.cds.unistra.fr/hips-image-services/hips2fits>) alongside the
STScI/DSS acknowledgment above covers both layers.

## What the app actually shows

`imagery.SURVEY_CREDIT` — the short string carried in the API's `credit`
field and shown next to a survey image in the UI — is deliberately not the
full notice above; it names the actual rights holders (STScI/AURA, Palomar
Observatory/Caltech, UK Schmidt-AAO) plus the delivery service, and links back
to this file being the place the complete text lives. `source: "survey"` on
the same payload is the field that labels the image as not the user's own
capture — see the sidecar's contract in `handback-to-seestar-ai.md` item 8
and `slice-2-backlog.md`'s "Imagery: a dashboard feature, not a server gap".

## Verified against the live service (2026-07-30)

- `GET https://alasky.cds.unistra.fr/hips-image-services/hips2fits` with
  `hips=CDS/P/DSS2/color&ra=<deg>&dec=<deg>&fov=<deg>&width=<px>&height=<px>
  &format=jpg` returns `200 image/jpeg` with `Access-Control-Allow-Origin: *`.
- A missing dimension or an unknown `hips` id returns `400` with a JSON body
  shaped `{"title": ..., "description": ...}` — not a 200 with a broken image.
- `fov` up to 180 (degrees, whole sky) is accepted; `fov=0` is rejected.
- The returned JPEG itself embeds a FITS-style provenance comment repeating
  the STScI/CDS copyright and HiPS-creation credit above — confirms the
  wording is the service's own, not paraphrased from documentation that could
  be stale.

This app requests only DSS2 colour cutouts by RA/Dec/field-of-view — no other
survey, no spectra, no catalogue cross-match — so no other HiPS collection's
licence terms apply.
