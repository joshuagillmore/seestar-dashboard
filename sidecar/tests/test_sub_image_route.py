"""HTTP-level tests for `/api/sub_image/{target_id}/{sub_name}`.

Serves the Seestar's own `<stem>_thn.jpg` so a Review & QA row can be looked
at, not just read. The alternative the user offered — handing the path to the
OS to open — is not needed and is not done: the scope already writes a JPEG
beside every sub (verified across the archive: 7,533 subs, 7,533 thumbnails).

The security property is the reason most of these exist. Two path components
arrive from the URL and NEITHER is used to build a filesystem path:
`target_id` goes through `is_plausible_target_id()`, and the sub is resolved
by matching `sub_name` against the stems of files the archive scan itself
discovered. Written at the route boundary rather than against the helpers,
because a wrapper can drift from the function under it — the lesson
seestar-mcp handed us after finding exactly that in their own repo.
"""

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar.main import create_app

STEM = "Light_M 31_10.0s_IRCUT_20240104-203641"
#: JPEG SOI marker — what a served thumbnail starts with, and what a
#: traversal response must never start with.
JPEG_MAGIC = bytes([0xFF, 0xD8])


@pytest.fixture
def archive(tmp_path):
    root = tmp_path / "archive"
    subs = root / "M 31-sub"
    subs.mkdir(parents=True)
    (subs / f"{STEM}.fit").write_bytes(b"not-really-fits")
    (subs / f"{STEM}_thn.jpg").write_bytes(b"\xff\xd8\xff\xe0 thumbnail")
    # A sub with NO thumbnail — a real and different state from "no such sub".
    (subs / "Light_M 31_10.0s_IRCUT_20240104-203652.fit").write_bytes(b"x")
    return root


@pytest.fixture
def client(tmp_path, archive):
    return TestClient(
        create_app(
            archive_dir=archive,
            qa_cache_dir=tmp_path / "qa_cache",
            catalog_path=tmp_path / "no-catalog.json",
            aliases_path=tmp_path / "no-aliases.json",
        )
    )


def test_the_thumbnail_is_served(client):
    response = client.get(f"/api/sub_image/M31/{STEM}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8")


def test_the_sub_name_is_the_stem_with_no_extension(client):
    """`qa_tier2.summary.subs[].name` is `path.stem` (CONTRACT.md). The route
    appends the thumbnail suffix itself, so a caller passing the .fit name is
    passing something no sub is keyed by."""
    assert client.get(f"/api/sub_image/M31/{STEM}.fit").status_code == 404


def test_a_sub_without_a_thumbnail_is_distinct_from_a_missing_sub(client):
    response = client.get("/api/sub_image/M31/Light_M 31_10.0s_IRCUT_20240104-203652")

    assert response.status_code == 404
    # The sub is real; its thumbnail is not. The message says which.
    assert "thumbnail" in response.json()["error"]


def test_an_unknown_sub_says_so(client):
    response = client.get("/api/sub_image/M31/Light_M 31_10.0s_IRCUT_19990101-000000")

    assert response.status_code == 404
    assert "no sub" in response.json()["error"]


@pytest.mark.parametrize(
    "hostile_target",
    ["../../../etc", "..%2f..%2fsecrets", "M31/../../etc", "a b; rm -rf /", "." * 64],
)
def test_an_implausible_target_id_never_yields_a_file(client, hostile_target):
    """What matters is that no file comes back, not which status says so.

    A `../` URL is normalised by the HTTP layer BEFORE routing, so it matches
    no API route at all and falls through to the SPA catch-all — 200 with
    index.html. That is a stronger property than the handler rejecting it:
    the request never reaches the handler. `is_plausible_target_id()` is
    defence in depth behind that, for anything that does.

    So the assertion is on the outcome: never an image, never file bytes."""
    response = client.get(f"/api/sub_image/{hostile_target}/{STEM}")

    assert response.status_code != 500
    assert response.headers.get("content-type", "") != "image/jpeg"
    assert not response.content.startswith(JPEG_MAGIC)


@pytest.mark.parametrize(
    "hostile_sub",
    [
        "../../../../Windows/System32/drivers/etc/hosts",
        "..%2f..%2f.env",
        "/etc/passwd",
        "Light_M 31_10.0s_IRCUT_20240104-203641/../../../secret",
    ],
)
def test_a_hostile_sub_name_matches_no_stem_and_never_escapes(client, hostile_sub):
    """The guard is structural rather than a filter: the handler only ever
    returns a file the archive scan already found, so a traversal string has
    nothing to traverse — it simply matches no stem. Inputs containing `../`
    do not even reach it (see the target-id test above); those that do, match
    nothing. Either way no file leaves the archive."""
    response = client.get(f"/api/sub_image/M31/{hostile_sub}")

    assert response.status_code != 500
    assert response.headers.get("content-type", "") != "image/jpeg"
    assert not response.content.startswith(JPEG_MAGIC)
    assert b"root:" not in response.content


def test_an_unknown_target_says_so(client):
    response = client.get(f"/api/sub_image/NGC7380/{STEM}")

    assert response.status_code == 404
    assert "no archive target" in response.json()["error"]
