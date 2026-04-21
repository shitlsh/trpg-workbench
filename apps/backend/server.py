#!/usr/bin/env python3
"""Entry point for the TRPG Workbench backend server."""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=7821, reload=False)
