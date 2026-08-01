"""Console entry point: `uv run seestar-dashboard`.

The bare `uvicorn seestar_sidecar.main:create_app --factory` command works,
but a taken port fails as a raw OSError traceback out of asyncio, and port
collisions are not hypothetical: the default was 8000 until it collided with
both Docker Desktop and an unrelated local app. 8787 is the default now,
chosen to sit clear of the usual suspects (8000, 8080, 8888, 5000, 3000). This wraps it: check the port first, fail with one
readable line naming the port if it's taken, and print the URL to open
before uvicorn's own logging takes over.
"""
import argparse
import os
import socket
import sys

import uvicorn

# Loads .env before SEESTAR_PORT is read below (main()'s argparse default) —
# see env.py. This is the one machine-specific env-var read in this module
# that doesn't happen via another seestar_sidecar module already importing
# env.py first: launcher.py hands uvicorn a STRING ("seestar_sidecar.main:
# create_app"), so main.py isn't actually imported until uvicorn.run() below,
# which is after this module's own argparse defaults have already been built.
from seestar_sidecar import env as _env  # noqa: F401, E402


def _port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="seestar-dashboard", description="Run the SeeStar Console."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("SEESTAR_PORT", "8787")),
        help="Port to serve on (default: 8787, or $SEESTAR_PORT).",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1).",
    )
    args = parser.parse_args(argv)

    if not _port_is_free(args.host, args.port):
        # Plain ASCII only: this prints straight to a raw Windows console
        # (no Python startup override forces the codepage to UTF-8 there),
        # and an em dash sent to one of the legacy codepages some machines
        # still default to renders as a mangled replacement glyph — seen by
        # actually triggering this path, not by reading the source.
        print(
            f"Port {args.port} is already in use, so the SeeStar Console can't "
            f"start there. Docker Desktop holds this port on some machines - "
            f"either stop whatever is using it, or run on another port:\n"
            f"    uv run seestar-dashboard --port {args.port + 1}",
            file=sys.stderr,
        )
        raise SystemExit(1)

    # flush=True: stdout is fully buffered rather than line-buffered
    # whenever it isn't a live terminal (piped to a log file, captured by a
    # launcher .bat, etc.), and uvicorn's own logging would otherwise reach
    # the screen first — or this line might not appear until the process
    # exits. Confirmed by actually redirecting output, not by inspection.
    print(f"SeeStar Console starting at http://{args.host}:{args.port}", flush=True)
    uvicorn.run("seestar_sidecar.main:create_app", factory=True, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
