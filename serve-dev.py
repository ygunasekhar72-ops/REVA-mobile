#!/usr/bin/env python3
"""Dev server with CORS headers — ES-module imports (three.js etc.) fail
without Access-Control-Allow-Origin when fetched as module scripts.
Serves the harness directory on 8402 with permissive CORS (dev only)."""
import http.server
import socketserver

PORT = 8402

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print('REVA dev server (CORS) on http://127.0.0.1:' + str(PORT))
        httpd.serve_forever()
