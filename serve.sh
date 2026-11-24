#!/usr/bin/env bash
# Serve the workbench at http://localhost:5173 (caching off, so reloads always get the latest code)
cd "$(dirname "$0")" && exec python3 serve.py "${1:-5173}"
