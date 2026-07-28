"""FastAPI app factory. CORS is open to the Vite dev origin only."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from seestar_sidecar.routes import router

VITE_DEV_ORIGIN = "http://localhost:5173"


def create_app() -> FastAPI:
    app = FastAPI(title="seestar-sidecar", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[VITE_DEV_ORIGIN],
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(router)
    return app
