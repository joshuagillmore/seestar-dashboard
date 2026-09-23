"""DNS rebinding: a page on attacker.example re-points its own DNS record at
127.0.0.1, and the browser then treats this sidecar as same-origin with it —
CORS stops applying and the page reads every /api response. The Host header
still names attacker.example, so that is what gets checked.
"""
import logging

import pytest
from fastapi.testclient import TestClient

from seestar_sidecar import host_check, launcher, routes
from seestar_sidecar.main import create_app


@pytest.fixture
def no_extra_hosts(monkeypatch):
    monkeypatch.delenv("SEESTAR_ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv("SEESTAR_REPLAY", "1")


def _get(app, host, path="/api/health"):
    client = TestClient(app, base_url="http://127.0.0.1:8787")
    return client.get(path, headers={"host": host})


@pytest.mark.parametrize("host", ["127.0.0.1:8787", "localhost:8787", "[::1]:8787", "LOCALHOST"])
def test_loopback_names_are_served(no_extra_hosts, host):
    assert _get(create_app(), host).status_code == 200


@pytest.mark.parametrize(
    "host",
    [
        "attacker.example",
        "attacker.example:8787",
        "127.0.0.1.attacker.example:8787",
        "localhost.attacker.example",
        "[::2]:8787",
        "",
    ],
)
def test_any_other_host_is_refused(no_extra_hosts, host):
    response = _get(create_app(), host)
    assert response.status_code == 400
    assert response.json() == {"ok": False, "error": "invalid Host header"}


def test_a_rebound_page_cannot_read_tool_data(no_extra_hosts):
    response = _get(create_app(), "attacker.example:8787", "/api/get_site_profile")
    assert response.status_code == 400
    assert "profile" not in response.text


def test_the_frontend_is_covered_too(no_extra_hosts, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
    app = create_app(web_dist=dist)
    assert _get(app, "attacker.example", "/").status_code == 400
    assert _get(app, "127.0.0.1:8787", "/").status_code == 200


def test_extra_hosts_come_from_the_environment(no_extra_hosts, monkeypatch):
    monkeypatch.setenv("SEESTAR_ALLOWED_HOSTS", "console.lan, Other.Lan ")
    app = create_app()
    assert _get(app, "console.lan:8787").status_code == 200
    assert _get(app, "other.lan").status_code == 200
    assert _get(app, "attacker.example").status_code == 400


def test_a_specific_non_loopback_bind_is_allowed_and_warned_about(no_extra_hosts, caplog):
    with caplog.at_level(logging.WARNING, logger=host_check.__name__):
        app = create_app(bind_host="192.168.1.50")

    assert _get(app, "192.168.1.50:8787").status_code == 200
    assert _get(app, "127.0.0.1:8787").status_code == 200
    assert _get(app, "attacker.example").status_code == 400
    assert any("NO authentication" in r.getMessage() for r in caplog.records)


def test_a_wildcard_bind_allows_this_machines_own_names(no_extra_hosts, monkeypatch, caplog):
    monkeypatch.setattr(host_check.socket, "gethostname", lambda: "Scope-PC")
    monkeypatch.setattr(
        host_check.socket,
        "getaddrinfo",
        lambda host, port: [(None, None, None, "", ("192.168.1.77", 0))],
    )
    with caplog.at_level(logging.WARNING, logger=host_check.__name__):
        app = create_app(bind_host="0.0.0.0")

    for host in ("192.168.1.77:8787", "scope-pc:8787", "scope-pc.local", "127.0.0.1:8787"):
        assert _get(app, host).status_code == 200, host
    assert _get(app, "attacker.example").status_code == 400
    assert any("NO authentication" in r.getMessage() for r in caplog.records)


def test_a_loopback_bind_logs_no_warning(no_extra_hosts, caplog):
    with caplog.at_level(logging.WARNING, logger=host_check.__name__):
        create_app(bind_host="127.0.0.1")
    assert not caplog.records


def test_the_bind_host_is_read_from_the_launchers_environment(no_extra_hosts, monkeypatch):
    monkeypatch.setenv("SEESTAR_BIND_HOST", "192.168.1.50")
    assert _get(create_app(), "192.168.1.50").status_code == 200


def test_the_launcher_hands_its_bind_host_to_the_app_and_warns(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(launcher, "_port_is_free", lambda host, port: True)
    monkeypatch.setattr(launcher.uvicorn, "run", lambda *a, **kw: calls.append(kw))

    launcher.main(["--host", "0.0.0.0", "--port", "8787"])

    import os

    assert os.environ["SEESTAR_BIND_HOST"] == "0.0.0.0"
    assert calls[0]["host"] == "0.0.0.0"
    err = capsys.readouterr().err
    assert "no authentication" in err.lower()
    err.encode("ascii")  # printed to a raw Windows console; see launcher.py


def test_the_launcher_is_quiet_on_loopback(monkeypatch, capsys):
    monkeypatch.setattr(launcher, "_port_is_free", lambda host, port: True)
    monkeypatch.setattr(launcher.uvicorn, "run", lambda *a, **kw: None)

    launcher.main(["--port", "8787"])

    assert "authentication" not in capsys.readouterr().err.lower()


@pytest.mark.parametrize(
    "value, expected",
    [
        ("127.0.0.1:8787", "127.0.0.1"),
        ("[::1]:8787", "::1"),
        ("[::1]", "::1"),
        ("LocalHost", "localhost"),
        ("::1", "::1"),
        ("[bad", ""),
    ],
)
def test_host_header_parsing(value, expected):
    assert host_check.host_from_header(value) == expected


# --- Origin on the one POST ---------------------------------------------------
#
# A POST with NO Origin is allowed, deliberately. Every browser this app
# targets sends Origin on every POST, same-origin included, so an absent one
# means a non-browser client (curl, a script) — which the guard is not for:
# it exists to stop a third-party PAGE, and a local process can already do
# anything this API offers. `Origin: null` (a sandboxed frame, a file://
# page, some redirects) IS a browser page, one we cannot place, so it is
# refused.


def _start(app, **headers):
    client = TestClient(app, base_url="http://127.0.0.1:8787")
    return client.post(
        "/api/qa_analysis_start",
        params={"target": "NOSUCHTARGET"},
        headers={"host": "127.0.0.1:8787", routes.CLIENT_HEADER: "t", **headers},
    )


def test_a_post_without_an_origin_is_allowed(no_extra_hosts):
    # 404: it got past the caller checks to the "no such target" answer.
    assert _start(create_app()).status_code == 404


def test_a_null_origin_is_refused(no_extra_hosts):
    assert _start(create_app(), origin="null").status_code == 403


@pytest.mark.parametrize(
    "origin", ["http://127.0.0.1:8787", "http://localhost:5173", "http://[::1]:8787"]
)
def test_loopback_origins_are_allowed(no_extra_hosts, origin):
    """`[::1]` used to be refused: the check compared urlparse().hostname,
    which strips the brackets, against a list spelled with them."""
    assert _start(create_app(), origin=origin).status_code == 404


def test_the_configured_lan_host_is_an_allowed_origin(no_extra_hosts):
    app = create_app(bind_host="192.168.1.50")
    assert _start(app, origin="http://192.168.1.50:8787").status_code == 404
    assert _start(app, origin="http://attacker.example").status_code == 403
