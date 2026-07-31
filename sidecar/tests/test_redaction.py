"""Credentials must not survive a trip through an error message.

The case that prompted this: the Tonight screen rendered a real meteoblue API
key, because httpx's HTTPStatusError embeds the full request URL and every layer
below treated that string as ordinary text.
"""

from seestar_sidecar.redaction import REDACTED, redact_payload, redact_secrets

#: The real *shape* of the error that reached the browser, with a fabricated
#: key. The first version of this file pasted in the genuine one — while fixing
#: a credential leak — which is exactly how secrets get committed: as evidence,
#: by someone who has just been staring at them. The shape is what the regex
#: needs; the value must never be real.
REAL_LEAK = (
    "Client error '429 Too Many Requests' for url "
    "'https://my.meteoblue.com/packages/basic-1h_clouds-3h"
    "?lat=51.4778&lon=-0.0015&asl=46.0&format=json&apikey=FAKEKEYd0not5use'"
)


def test_the_meteoblue_key_does_not_survive():
    out = redact_secrets(REAL_LEAK)
    assert "FAKEKEYd0not5use" not in out
    assert f"apikey={REDACTED}" in out


def test_the_rest_of_the_message_survives():
    # A redactor that eats the whole message gets removed by whoever next has
    # to diagnose a 429, so the diagnostic content has to stay.
    out = redact_secrets(REAL_LEAK)
    assert "429 Too Many Requests" in out
    assert "my.meteoblue.com" in out
    assert "format=json" in out


def test_common_credential_names_are_all_caught():
    for name in ("apikey", "api_key", "API-KEY", "token", "access_token",
                 "secret", "client_secret", "password", "pwd", "authorization"):
        out = redact_secrets(f"failed: {name}=hunter2 and lat=51.4")
        assert "hunter2" not in out, f"{name} leaked"
        assert "lat=51.4" in out, f"{name} redaction ate an unrelated param"


def test_a_value_containing_an_equals_sign_is_still_removed():
    # Base64 credentials routinely end in '='.
    out = redact_secrets("token=YWJjZGVm==&next=1")
    assert "YWJjZGVm" not in out


def test_payload_redaction_only_touches_the_error_field():
    payload = {
        "ok": False,
        "error": "boom apikey=sekrit",
        # Real data that must not be mangled: a filename legitimately contains
        # '=' nowhere, but a reason string could, and target names are data.
        "target": "NGC7380",
        "reasons": ["cloud cover 86%"],
    }
    out = redact_payload(payload)
    assert "sekrit" not in out["error"]
    assert out["target"] == "NGC7380"
    assert out["reasons"] == ["cloud cover 86%"]


def test_a_clean_payload_is_returned_unchanged():
    payload = {"ok": True, "cloud_cover_pct": 17}
    assert redact_payload(payload) is payload


def test_no_error_field_is_fine():
    assert redact_payload({"ok": True}) == {"ok": True}


def test_empty_and_missing_text_do_not_raise():
    assert redact_secrets("") == ""
    assert redact_payload({"ok": False, "error": None}) == {"ok": False, "error": None}
