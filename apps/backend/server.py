#!/usr/bin/env python3
"""Entry point for the TRPG Workbench backend server."""
import argparse
import logging

from app.utils.logging_config import setup_logging

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TRPG Workbench backend server")
    parser.add_argument("--port", type=int, default=7821, help="Port to listen on (default: 7821)")
    parser.add_argument("--log-level", default="INFO", help="Log level (default: INFO)")
    args = parser.parse_args()

    log_file = setup_logging(level=args.log_level)
    logger = logging.getLogger(__name__)
    logger.info("=== TRPG Workbench backend starting, log: %s ===", log_file)
    logger.info("Listening on port %d", args.port)

    import uvicorn
    # Import app directly so PyInstaller can statically resolve the module.
    # Do NOT use the string form "app.main:app" — PyInstaller cannot trace
    # dynamic string imports and will exclude app.main from the bundle.
    from app.main import app  # noqa: E402
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        reload=False,
        # Let uvicorn use the root logger we already configured
        log_config=None,
    )
