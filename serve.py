#!/usr/bin/env python3
"""Serve the workbench with caching turned off, so a normal reload always picks up code changes."""
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f'Fire Guard Workbench on http://localhost:{port}')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
