#!/usr/bin/env python3
"""Tiny HTTP wrapper.  GET /match/<name> -> data/<name>.json
POST /fork {"match": "match", "at": 66.5, "tweak": "step_up", "params": {"player": "a6"}} -> fork JSON
Single-threaded on purpose: one GRF engine per process.  python server.py [port]"""
import json, os, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import sim

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
NAME = re.compile(r'^[\w-]+$')


class H(BaseHTTPRequestHandler):
    def send(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())

    def do_OPTIONS(self):
        self.send(204, b'')

    def do_GET(self):
        name = self.path.split('?')[0][len('/match/'):] if self.path.startswith('/match/') else ''
        path = os.path.join(DATA, name + '.json')
        if not NAME.match(name) or not os.path.exists(path):
            return self.send(404, {'error': 'not found'})
        with open(path, 'rb') as fh:
            self.send(200, fh.read())

    def do_POST(self):
        if self.path != '/fork':
            return self.send(404, {'error': 'not found'})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            name = str(req.get('match', 'match'))
            if not NAME.match(name):
                raise ValueError('bad match name')
            doc = sim.fork(os.path.join(DATA, name + '.json'), float(req['at']), req['tweak'], req.get('params'))
        except (KeyError, ValueError, TypeError, FileNotFoundError, AssertionError) as e:
            return self.send(400, {'error': str(e)})
        self.send(200, doc)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'listening on :{port}')
    HTTPServer(('', port), H).serve_forever()
