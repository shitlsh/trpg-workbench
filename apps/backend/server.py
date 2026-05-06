#!/usr/bin/env python3
"""Entry point for the TRPG Workbench backend server."""
import argparse
import uvicorn

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TRPG Workbench backend server")
    parser.add_argument("--port", type=int, default=7821, help="Port to listen on (default: 7821)")
    args = parser.parse_args()
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, reload=False)
