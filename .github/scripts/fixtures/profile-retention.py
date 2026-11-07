"""Local emulator fixture: counts real document loads and records live input values."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
import json

state = {}
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        key = query.get('id', [''])[0]
        if url.path == '/page':
            item = state.setdefault(key, {'loads': 0, 'value': ''})
            item['loads'] += 1
            body = b'''<!doctype html><meta name="viewport" content="width=device-width"><title>Profile draft</title>
<body style="background:#203050;color:white;font:24px sans-serif"><h1>Profile draft</h1>
<label>Draft <input id="draft" autofocus style="font-size:24px;width:90%"></label>
<script>setInterval(()=>fetch('/state'+location.search+'&value='+encodeURIComponent(document.querySelector('input').value),{cache:'no-store'}),250);</script>'''
            content_type = 'text/html; charset=utf-8'
        elif url.path == '/state':
            state.setdefault(key, {'loads': 0, 'value': ''})['value'] = query.get('value', [''])[0]
            body = b'OK'
            content_type = 'text/plain'
        elif url.path == '/snapshot':
            body = json.dumps(state).encode()
            content_type = 'application/json'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(('127.0.0.1', 8767), Handler).serve_forever()
