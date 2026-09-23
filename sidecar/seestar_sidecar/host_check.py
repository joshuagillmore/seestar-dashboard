"""Refuse any request whose Host header is not a name this server answers to.

Why: DNS rebinding. A page on `attacker.example` can have its DNS record
re-pointed at 127.0.0.1 after it loads; the browser then treats this sidecar
as same-origin with that page, so CORS no longer applies and the page can
read every /api response — site, projects, provenance log. The one thing it
cannot change is the Host header, which still says `attacker.example`.
Checking Host is the standard defence, and it costs a legitimate client
nothing: a browser pointed at this server always names it.

Why not Starlette's TrustedHostMiddleware: it takes the host as everything
before the first ":", so `[::1]:8787` reads as `[` and IPv6 loopback could
never be allowed. This parses bracketed IPv6 properly and is otherwise the
same check.
"""
from __future__ import annotations

import logging
import socket
from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger(__name__)

#: Always allowed. Stored without brackets or port, lower-case — see
#: host_from_header().
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

#: Bind addresses that mean "every interface". The names a client will use
#: to reach such a server cannot be known from the bind address itself.
_WILDCARD_BINDS = frozenset({"0.0.0.0", "::", ""})


def normalise_host(host: str) -> str:
    """Lower-case, and without IPv6 brackets: `[::1]` -> `::1`."""
    host = host.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host


def host_from_header(value: str) -> str:
    """The host part of a Host header (or an Origin's netloc), port removed.

    `127.0.0.1:8787` -> `127.0.0.1`; `[::1]:8787` -> `::1`; `localhost` ->
    `localhost`. An unbracketed value with several colons is taken as a bare
    IPv6 address rather than host:port, since no port parse of it is sound.
    """
    value = value.strip()
    if value.startswith("["):
        end = value.find("]")
        return normalise_host(value[: end + 1]) if end != -1 else ""
    if value.count(":") == 1:
        value = value.split(":", 1)[0]
    return normalise_host(value)


def is_loopback_bind(bind_host: str | None) -> bool:
    return bind_host is None or normalise_host(bind_host) in LOOPBACK_HOSTS


def _this_machines_names() -> set[str]:
    """Best-effort: this machine's hostname and its addresses — the names a
    LAN client will use when the server binds every interface. An address
    literal is safe to allow: a rebinding page cannot make a browser send a
    Host header naming our own IP unless the page itself was loaded from
    that IP, i.e. from us."""
    names: set[str] = set()
    try:
        hostname = socket.gethostname()
    except OSError:
        return names
    if hostname:
        names.update({hostname, f"{hostname}.local"})
        try:
            for *_, sockaddr in socket.getaddrinfo(hostname, None):
                names.add(str(sockaddr[0]))
        except OSError:
            pass
    return {normalise_host(name) for name in names}


def allowed_hosts(bind_host: str | None, extra: Iterable[str] = ()) -> frozenset[str]:
    """Every Host this server should answer to.

    Loopback always. A specific non-loopback bind adds that address; a
    wildcard bind (0.0.0.0 / ::) adds this machine's own hostname and
    addresses. `extra` (SEESTAR_ALLOWED_HOSTS) adds anything else — a DNS
    name on the LAN, say.
    """
    hosts = set(LOOPBACK_HOSTS)
    if bind_host is not None:
        bind = normalise_host(bind_host)
        if bind in _WILDCARD_BINDS:
            hosts |= _this_machines_names()
        else:
            hosts.add(bind)
    hosts |= {normalise_host(h) for h in extra if h.strip()}
    return frozenset(hosts)


def warn_if_exposed(bind_host: str | None) -> None:
    if is_loopback_bind(bind_host):
        return
    logger.warning(
        "SeeStar Console is bound to %s, so other machines can reach it. The API "
        "has NO authentication: anyone on this network can read the site profile, "
        "projects and session log, and start QA analyses. Bind to 127.0.0.1 (the "
        "default) unless you mean this.",
        bind_host,
    )


class AllowedHostMiddleware:
    """400 for any request whose Host is not in `hosts`. Outermost, so it
    runs before routing, CORS, and the static frontend alike."""

    def __init__(self, app: ASGIApp, hosts: Iterable[str]) -> None:
        self.app = app
        self.hosts = frozenset(hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        host = host_from_header(Headers(scope=scope).get("host", ""))
        if host in self.hosts:
            await self.app(scope, receive, send)
            return
        response = JSONResponse({"ok": False, "error": "invalid Host header"}, status_code=400)
        await response(scope, receive, send)
