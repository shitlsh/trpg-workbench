#!/usr/bin/env python3
"""Entry point for the TRPG Workbench backend server."""
import argparse
import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TRPG Workbench backend server")
    parser.add_argument("--port", type=int, default=7821, help="Port to listen on (default: 7821)")
    args = parser.parse_args()

    # Import app directly so PyInstaller can statically resolve the module.
    # Do NOT use the string form "app.main:app" — PyInstaller cannot trace
    # dynamic string imports and will exclude app.main from the bundle.
    from app.main import app  # noqa: E402
    uvicorn.run(app, host="127.0.0.1", port=args.port, reload=False)
