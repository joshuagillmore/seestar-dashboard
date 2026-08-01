"""Strip credentials out of anything on its way to a client.

## Why this exists

The Tonight screen rendered a user's meteoblue API key. The whole chain was
ordinary code doing what it was told:

1. `planning/weather.py` builds a request with `params={"apikey": ...}` and
   calls `raise_for_status()`. It catches `httpx.RequestError` (network-level)
   but not `httpx.HTTPStatusError`, which is a sibling — so a 429 or a 401 on a
   rotated key propagates.
2. `server.py`'s `assess_conditions` has an outer `except Exception as exc:
   return {"ok": False, "error": str(exc)}`. httpx's `HTTPStatusError.__str__`
   embeds the full request URL, query string included.
3. The sidecar forwards a valid `{"ok": false, ...}` payload verbatim.
4. `client.ts` throws `ApiError(String(body.error))` and the screen renders it.

Nothing there is a bug in isolation. The failure is that no layer treated an
upstream error string as untrusted, so a credential travelled from an HTTP
client into the DOM, where a screenshot publishes it.

## What this does, and what it does not

It redacts the *values* of parameters whose names look like credentials, in
query strings and in `key=value` prose, leaving the rest of the message intact —
a truncated-to-nothing error is useless for diagnosis, which is how sanitising
ends up quietly removed later.

It is a backstop, not a boundary. The real fix is upstream not putting secrets
in exception text, which is a `seestar-mcp` change. This runs on every error the
sidecar forwards so that a secret introduced by any future call path is caught
without anyone remembering to think about it.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

#: Parameter names whose values are redacted wherever they appear. Matched
#: case-insensitively, and as a substring — `apikey`, `api_key`, `X-Api-Key`
#: and `meteoblue_apikey` all hit on `key`.
_SECRET_NAME_HINTS = ("key", "token", "secret", "password", "passwd", "pwd", "auth", "credential")

#: `name=value` in a query string or in prose. The value runs to the next
#: delimiter — `&`, whitespace, quote, or end.
_ASSIGNMENT = re.compile(
    r"(?P<name>[A-Za-z0-9_\-\[\]]{1,64})(?P<sep>=)(?P<value>[^&\s'\"<>]+)"
)

REDACTED = "<redacted>"


def _is_secret_name(name: str) -> bool:
    lowered = name.lower()
    return any(hint in lowered for hint in _SECRET_NAME_HINTS)


def redact_secrets(text: str) -> str:
    """Replace credential-looking values in `text`, keeping everything else.

    >>> redact_secrets("429 for url 'https://x/y?lat=51.5&apikey=abc123'")
    "429 for url 'https://x/y?lat=51.5&apikey=<redacted>'"

    Non-secret parameters survive, because they are usually the diagnostic
    content — a rate-limit error is much less useful without the endpoint it
    was rate-limited on.
    """
    if not text:
        return text

    hits: list[str] = []

    def replace(match: re.Match[str]) -> str:
        name = match.group("name")
        if _is_secret_name(name):
            hits.append(name)
            return f"{name}={REDACTED}"
        return match.group(0)

    out = _ASSIGNMENT.sub(replace, text)

    if hits:
        # Firing is not routine. This is a backstop for a defect upstream — a
        # credential should never be in an error string in the first place — so
        # a hit means something regressed at the source and is worth finding,
        # not absorbing silently. The parameter NAMES are safe to log; the
        # values are exactly what must not be.
        logger.warning(
            "redacted %d credential-shaped value(s) from an outbound error: %s. "
            "A secret reached this layer; fix it at the source rather than relying on this.",
            len(hits),
            ", ".join(sorted(set(hits))),
        )
    return out


def redact_payload(payload: dict) -> dict:
    """Redact the `error` field of a tool payload, if it has one.

    Only `error` is touched. Redacting every string in every response would
    mangle legitimate data — target names, filenames, reason text — for no gain,
    since the leak path is specifically exception messages.
    """
    error = payload.get("error")
    if isinstance(error, str):
        redacted = redact_secrets(error)
        if redacted != error:
            return {**payload, "error": redacted}
    return payload
