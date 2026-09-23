import os

import pytest


@pytest.fixture(autouse=True)
def _allow_the_test_clients_host(monkeypatch):
    """The app refuses any Host it does not answer to (see host_check.py), and
    Starlette's TestClient sends `Host: testserver`. Allowed here, through
    the same SEESTAR_ALLOWED_HOSTS an operator would use, rather than by a
    test-only branch in the app. tests/test_host_check.py clears it to test
    the defaults."""
    monkeypatch.setenv("SEESTAR_ALLOWED_HOSTS", "testserver")


@pytest.fixture(autouse=True)
def _isolate_the_bind_host():
    """launcher.main() writes SEESTAR_BIND_HOST into os.environ for the app
    factory to read (see launcher.py), so any test that runs it would leak a
    bind host into every later test. Cleared around each test instead."""
    before = os.environ.pop("SEESTAR_BIND_HOST", None)
    yield
    os.environ.pop("SEESTAR_BIND_HOST", None)
    if before is not None:
        os.environ["SEESTAR_BIND_HOST"] = before
