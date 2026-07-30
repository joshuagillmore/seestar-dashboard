"""The launcher's whole job is turning a taken port into one readable line
instead of the raw OSError traceback `uvicorn.run` would otherwise raise —
see launcher.py's module docstring for why this is not a hypothetical on
this machine.
"""
import socket

import pytest

from seestar_sidecar import launcher
from seestar_sidecar.launcher import _port_is_free, main


@pytest.fixture
def occupied_port():
    """A real bound-and-listening socket, so `_port_is_free` is exercised
    against actual OS behaviour rather than a mock of it.
    """
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.bind(("127.0.0.1", 0))
    holder.listen(1)
    try:
        yield holder.getsockname()[1]
    finally:
        holder.close()


def test_port_is_free_for_a_port_nothing_is_using(occupied_port):
    # occupied_port's fixture teardown has already released the port by the
    # time the test body runs its own checks below, so grab a fresh unbound
    # port instead of relying on that ordering.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        free_port = probe.getsockname()[1]
    assert _port_is_free("127.0.0.1", free_port)


def test_port_is_free_is_false_while_a_socket_holds_it(occupied_port):
    assert not _port_is_free("127.0.0.1", occupied_port)


def test_main_exits_cleanly_with_a_message_naming_the_taken_port(occupied_port, capsys):
    with pytest.raises(SystemExit) as exc_info:
        main(["--port", str(occupied_port)])
    assert exc_info.value.code == 1
    stderr = capsys.readouterr().err
    assert str(occupied_port) in stderr
    assert "seestar-dashboard --port" in stderr


def test_main_passes_the_command_line_port_through_to_uvicorn(monkeypatch, occupied_port):
    # Proves --port is actually plumbed through end-to-end, not just parsed
    # and ignored: a hardcoded 8000 would pass the bind-check tests above
    # (occupied_port is never 8000) but fail this one, since the mock below
    # records what main() actually asked uvicorn to bind.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        free_port = probe.getsockname()[1]
    assert free_port != occupied_port

    calls = []
    monkeypatch.setattr(launcher.uvicorn, "run", lambda *a, **kw: calls.append(kw))
    main(["--port", str(free_port)])

    assert len(calls) == 1
    assert calls[0]["port"] == free_port


def test_main_reads_the_port_override_from_the_environment(monkeypatch, occupied_port):
    monkeypatch.setenv("SEESTAR_PORT", str(occupied_port))
    with pytest.raises(SystemExit) as exc_info:
        main([])
    assert exc_info.value.code == 1
