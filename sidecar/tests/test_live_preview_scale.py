"""live_preview discovery on a share laid out like the real one after a long
night, with a filesystem that charges for what it lists.

The finding this file guards: after a 1003-sub night, /api/live_preview said
`share_unreachable` while the share answered in under a tenth of a second.
The scan stat-ed every root entry twice (once for the stacked pass, once for
the sub pass), then listed the whole sub folder. The last step's cost grows
with every sub, so the scan ran past SHARE_SCAN_TIMEOUT_SECONDS late in any
long session.

The layout is the real one: SEESTAR_LIVE_SHARE_DIR points AT the `MyWorks`
folder, which holds `<target>/` (stacked masters) and `<target>_sub/` (three
files per sub) for every object ever imaged.
"""
import copy
import json
import os
import time
from pathlib import Path

import pytest

from seestar_sidecar import live_preview

SUBS = 2000
#: The newest sub by name: 2,000 subs 10 s apart from 00:00:00.
NEWEST_SUB = "Light_M1_10.0s_LP_20260924-123310_thn.jpg"
STACK_THUMB = "Stacked_1003_M1_10.0s_LP_20260924-110824_thn.jpg"


def _write(path, mtime=None):
    path.write_bytes(b"jpeg-bytes-" + path.name.encode())
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


@pytest.fixture(scope="module")
def long_night(tmp_path_factory):
    """MyWorks/ with 40 other targets' folders, M1/ and a 2,000-sub M1_sub/."""
    root = tmp_path_factory.mktemp("share") / "MyWorks"
    for i in range(20):
        for folder in (f"NGC{7000 + i}", f"NGC{7000 + i}_sub"):
            (root / folder).mkdir(parents=True)
        _write(root / f"NGC{7000 + i}" / f"Stacked_50_NGC{7000 + i}_10.0s_LP_20260701-010000_thn.jpg")
        _write(root / f"NGC{7000 + i}_sub" / f"Light_NGC{7000 + i}_10.0s_LP_20260701-010000_thn.jpg")
    (root / "M1").mkdir()
    for suffix in ("_thn.jpg", ".jpg", ".fit"):
        _write(root / "M1" / STACK_THUMB.replace("_thn.jpg", suffix))
    subs = root / "M1_sub"
    subs.mkdir()
    for i in range(SUBS):
        t = 7 * 3600 + i * 10  # a 10 s cadence from 07:00:00
        stamp = f"20260924-{t // 3600:02d}{t // 60 % 60:02d}{t % 60:02d}"
        for suffix in ("_thn.jpg", ".jpg", ".fit"):
            (subs / f"Light_M1_10.0s_LP_{stamp}{suffix}").write_bytes(b"")
    return root


def _age(root, rel, seconds):
    """Set a file's mtime to `seconds` ago."""
    mtime = time.time() - seconds
    os.utime(root / rel, (mtime, mtime))


@pytest.fixture
def listings(monkeypatch):
    """Every folder discovery lists, in order, as (folder name, pattern)."""
    calls = []
    real = live_preview.list_matching

    def spy(directory, pattern="*"):
        calls.append((directory.name, pattern))
        return real(directory, pattern)

    monkeypatch.setattr(live_preview, "list_matching", spy)
    return calls


@pytest.fixture
def stats(monkeypatch, long_night):
    """Every os.stat() of a path on the share, which over SMB is one round
    trip each. Only the share's paths count, so a stray stat elsewhere (a
    previous test's abandoned share thread, pytest itself) cannot fail it."""
    calls = []
    real = os.stat
    share = os.fspath(long_night)

    def spy(path, *args, **kwargs):
        if isinstance(path, (str, os.PathLike)) and os.fspath(path).startswith(share):
            calls.append(os.fspath(path))
        return real(path, *args, **kwargs)

    monkeypatch.setattr(os, "stat", spy)
    return calls


def test_the_newest_sub_is_found_among_2000(long_night):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.target, frame.path.name) == ("sub", "M1", NEWEST_SUB)
    assert not live_preview.is_frame_stale(frame)


def test_the_root_is_listed_once_and_only_the_targets_own_folders_after_it(long_night, listings):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    live_preview.discover_frame(long_night, "M1")

    assert [folder for folder, _ in listings] == ["MyWorks", "M1", "M1_sub"]


def test_no_root_entry_is_stat_ed(long_night, stats):
    """The old scan called is_dir() on each of the 42 root entries, twice:
    84 round trips before it looked inside a single folder. The listing
    already says which entries are folders. At most the two winners are
    stat-ed, and on Windows not even those."""
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)
    stats.clear()

    live_preview.discover_frame(long_night, "M1")

    assert len(stats) <= 2, stats


def test_a_stack_written_within_a_poll_means_the_sub_folder_is_never_listed(long_night, listings):
    _age(long_night, f"M1/{STACK_THUMB}", 10)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.path.name) == ("stacked", STACK_THUMB)
    assert "M1_sub" not in [folder for folder, _ in listings]


def test_a_stack_older_than_a_poll_loses_to_a_newer_sub(long_night):
    _age(long_night, f"M1/{STACK_THUMB}", 120)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert (frame.source, frame.path.name) == ("sub", NEWEST_SUB)


def test_a_stack_newer_than_every_sub_still_wins(long_night):
    """The parked M1 case: the final stack is written after the last sub."""
    _age(long_night, f"M1/{STACK_THUMB}", 3 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 3 * 3600 + 60)

    frame = live_preview.discover_frame(long_night, "M1")

    assert frame is not None
    assert frame.source == "stacked"
    assert live_preview.is_frame_stale(frame)


# --- the View names the stack: no scan at all ------------------------------

#: The real get_view_state payload of the parked scope on 2026-09-24, after
#: the 1003-sub M1 night (Annotate trimmed). The ended session's View keeps
#: naming its output: `output_file` and `jpg_name`, relative to the share's
#: parent, so they start with `MyWorks/`, the share root's own name.
PARKED_M1 = {
    "ok": True,
    "view_state": {
        "jsonrpc": "2.0",
        "method": "get_view_state",
        "result": {
            "View": {
                "state": "cancel",
                "lapse_ms": 13422564,
                "mode": "none",
                "cam_id": 0,
                "target_ra_dec": [5.575534, 22.017],
                "target_name": "M1",
                "lp_filter": True,
                "gain": 80,
                "Stack": {
                    "state": "cancel",
                    "lapse_ms": 13356715,
                    "frame_errcode": 266,
                    "stacked_frame": 1003,
                    "dropped_frame": 0,
                    "can_annotate": True,
                    "jpg_name": "MyWorks/M1/Stacked_1003_M1_10.0s_LP_20260924-110824.jpg",
                    "output_file": {
                        "path": "MyWorks/M1",
                        "files": [
                            {
                                "name": "Stacked_1003_M1_10.0s_LP_20260924-110824.fit",
                                "date": "2026-09-24 11:08:26",
                                "thn": "Stacked_1003_M1_10.0s_LP_20260924-110824_thn.jpg",
                                "type": 2,
                            }
                        ],
                    },
                    "Exposure": {"state": "complete", "lapse_ms": 11277, "exp_ms": 10000.0, "port": 4700},
                    "stage": "Exposure",
                },
                "stage": "Stack",
            }
        },
        "code": 0,
        "id": 25728,
    },
}

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def test_the_parked_view_names_its_stacked_thumbnail():
    assert live_preview.extract_named_stacks(PARKED_M1) == (f"MyWorks/M1/{STACK_THUMB}",)


def test_jpg_name_alone_names_the_thumbnail_beside_it():
    view = copy.deepcopy(PARKED_M1)
    del view["view_state"]["result"]["View"]["Stack"]["output_file"]

    assert live_preview.extract_named_stacks(view) == (f"MyWorks/M1/{STACK_THUMB}",)


def test_a_view_mid_stack_names_nothing():
    """The July working fixture has no output_file or jpg_name while
    stacking, so the scan is the normal path during a session."""
    working = json.loads((FIXTURES / "get_view_state.json").read_text(encoding="utf-8"))

    assert live_preview.extract_named_stacks(working) == ()


@pytest.mark.parametrize(
    "stack",
    [
        None,
        "Stack",
        {"output_file": None, "jpg_name": None},
        {"output_file": {"path": 5, "files": [{"thn": STACK_THUMB}]}},
        {"output_file": {"path": "MyWorks/M1", "files": "nope"}},
        {"output_file": {"path": "MyWorks/M1", "files": [None, {"thn": 7}, {"name": "x.fit"}]}},
        {"jpg_name": "MyWorks/M1/Stacked_1003_M1_10.0s_LP_20260924-110824.fit"},
    ],
)
def test_odd_stack_fields_name_nothing_and_never_raise(stack):
    view = {"ok": True, "view_state": {"result": {"View": {"target_name": "M1", "Stack": stack}}}}

    assert live_preview.extract_named_stacks(view) == ()


@pytest.mark.parametrize("payload", [None, {}, {"ok": False}, {"ok": True, "view_state": None}])
def test_a_payload_without_a_view_names_nothing(payload):
    assert live_preview.extract_named_stacks(payload) == ()


@pytest.mark.parametrize(
    ("named", "expected"),
    [
        (f"MyWorks/M1/{STACK_THUMB}", f"M1/{STACK_THUMB}"),
        (f"myworks/M1/{STACK_THUMB}", f"M1/{STACK_THUMB}"),
        (f"M1/{STACK_THUMB}", f"M1/{STACK_THUMB}"),
        (f"MyWorks\\M1\\{STACK_THUMB}", f"M1/{STACK_THUMB}"),
        # Another target's stack is not this target's.
        ("MyWorks/M31/Stacked_80_M31_10.0s_LP_20260924-110824_thn.jpg", None),
        # Only a stacked thumbnail: never the full-res sibling or the FITS.
        ("MyWorks/M1/Stacked_1003_M1_10.0s_LP_20260924-110824.jpg", None),
        ("MyWorks/M1/Stacked_1003_M1_10.0s_LP_20260924-110824.fit", None),
        # Never a sub, and never outside `<root>/<target folder>/`.
        ("MyWorks/M1_sub/Light_M1_10.0s_LP_20260924-123310_thn.jpg", None),
        (f"MyWorks/../M1/{STACK_THUMB}", None),
        (f"../{STACK_THUMB}", None),
        (f"C:/{STACK_THUMB}", None),
        (f"Other/MyWorks/M1/{STACK_THUMB}", None),
        (STACK_THUMB, None),
        # Names Windows cannot stat, or that only look valid to a `$` anchor:
        # these must name nothing (the caller scans), never reach stat().
        (f"MyWorks/M1/{STACK_THUMB}\n", None),
        ("MyWorks/M1/Stacked_1003_M1<x>_10.0s_LP_20260924-110824_thn.jpg", None),
        ("MyWorks/M1/Stacked_1003_M1?_10.0s_LP_20260924-110824_thn.jpg", None),
        (f"MyWorks/M1 \x00/{STACK_THUMB}", None),
        (f"MyWorks/M1\x01/{STACK_THUMB}", None),
    ],
)
def test_a_named_stack_resolves_only_to_the_targets_own_folder(named, expected):
    root = Path("share") / "MyWorks"

    resolved = live_preview._resolve_named_stack(root, "M1", named)

    assert resolved == (None if expected is None else root / expected)


def test_a_fresh_stack_named_by_the_view_is_served_without_listing_anything(
    long_night, listings, stats
):
    _age(long_night, f"M1/{STACK_THUMB}", 10)
    stats.clear()

    frame = live_preview.discover_frame(
        long_night, "M1", named_stacks=live_preview.extract_named_stacks(PARKED_M1)
    )

    assert frame is not None
    assert (frame.source, frame.target, frame.path) == ("stacked", "M1", long_night / "M1" / STACK_THUMB)
    assert listings == []
    assert len(stats) == 1  # the one named file


@pytest.mark.parametrize(
    "named",
    [f"MyWorks/M1 \x00/{STACK_THUMB}", "MyWorks/M1/Stacked_1003_M1|_10.0s_LP_20260924-110824_thn.jpg"],
)
def test_an_unstat_able_named_stack_falls_back_to_the_scan_instead_of_raising(long_night, named):
    frame = live_preview.discover_frame(long_night, "M1", named_stacks=(named,))

    assert frame is not None
    assert frame.target == "M1"


def test_an_older_named_stack_is_still_compared_with_the_subs(long_night, listings):
    """The View's stack is the newest stacked frame this target has, so its
    folder is not listed; the sub folder still is, since a sub can be newer."""
    _age(long_night, f"M1/{STACK_THUMB}", 3 * 3600)
    _age(long_night, f"M1_sub/{NEWEST_SUB}", 5)

    frame = live_preview.discover_frame(
        long_night, "M1", named_stacks=live_preview.extract_named_stacks(PARKED_M1)
    )

    assert frame is not None
    assert (frame.source, frame.path.name) == ("sub", NEWEST_SUB)
    assert [folder for folder, _ in listings] == ["MyWorks", "M1_sub"]


def test_a_named_stack_missing_from_the_share_falls_back_to_the_scan(long_night, listings):
    _age(long_night, f"M1/{STACK_THUMB}", 10)

    frame = live_preview.discover_frame(
        long_night, "M1", named_stacks=("MyWorks/M1/Stacked_9_M1_10.0s_LP_20260924-112310_thn.jpg",)
    )

    assert frame is not None
    assert frame.path.name == STACK_THUMB
    assert [folder for folder, _ in listings] == ["MyWorks", "M1"]


# --- slow is not unreachable -------------------------------------------------

#: What a listing costs per entry it returns, on the simulated share: 2,000
#: sub thumbnails take 1 s, the 42-entry root 21 ms.
PER_ENTRY_S = 0.0005
#: Well above the root listing, well below the sub folder's.
TIMEOUT_S = 0.3


@pytest.fixture
def slow_share(monkeypatch):
    """A share whose listings cost time in proportion to what they return,
    the way the real one's did before the server filtered them."""
    real = live_preview.list_matching

    def slow(directory, pattern="*"):
        entries = real(directory, pattern)
        time.sleep(PER_ENTRY_S * len(entries))
        return entries

    monkeypatch.setattr(live_preview, "list_matching", slow)


async def test_a_scan_that_outlasts_its_budget_after_the_root_answered_is_slow_not_unreachable(
    long_night, slow_share
):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)

    with pytest.raises(live_preview.ShareScanSlowError) as caught:
        await live_preview.discover_frame_within_timeout(long_night, timeout_s=TIMEOUT_S, target="M1")

    assert not isinstance(caught.value, live_preview.ShareUnreachableError)


async def test_the_named_stack_answering_counts_as_the_share_answering(long_night, slow_share):
    _age(long_night, f"M1/{STACK_THUMB}", 6 * 3600)

    with pytest.raises(live_preview.ShareScanSlowError):
        await live_preview.discover_frame_within_timeout(
            long_night,
            timeout_s=TIMEOUT_S,
            target="M1",
            named_stacks=live_preview.extract_named_stacks(PARKED_M1),
        )


async def test_a_root_that_does_not_answer_in_time_is_unreachable(long_night, monkeypatch):
    real = live_preview.list_matching

    def root_hangs(directory, pattern="*"):
        if directory == long_night:
            time.sleep(TIMEOUT_S + 0.3)
        return real(directory, pattern)

    monkeypatch.setattr(live_preview, "list_matching", root_hangs)

    with pytest.raises(live_preview.ShareUnreachableError):
        await live_preview.discover_frame_within_timeout(long_night, timeout_s=TIMEOUT_S, target="M1")


async def test_on_the_same_slow_share_a_fresh_stack_answers_in_time(long_night, slow_share):
    """Skipping the sub folder is what keeps a fresh stack inside the budget."""
    _age(long_night, f"M1/{STACK_THUMB}", 10)

    frame = await live_preview.discover_frame_within_timeout(long_night, timeout_s=TIMEOUT_S, target="M1")

    assert frame is not None
    assert frame.source == "stacked"


async def test_a_root_that_cannot_be_listed_is_still_unreachable(tmp_path):
    with pytest.raises(live_preview.ShareUnreachableError):
        await live_preview.discover_frame_within_timeout(tmp_path / "gone", target="M1")
