"""Loopback-only fixture for outgoing app links. No external accounts or calls."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, quote
from threading import Lock
import html
import json
import re

PORT = 8768
states = {}
lock = Lock()


def state(case):
    return states.setdefault(case, {'loads': 0, 'fallbacks': 0, 'events': {}})


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        case = query.get('case', ['case'])[0]
        if not re.fullmatch(r'[a-z0-9-]{1,64}', case):
            self.send_error(400)
            return
        mode = query.get('mode', ['normal'])[0]
        if mode not in {'normal', 'auto', 'frame', 'background', 'incognito'}:
            mode = 'normal'
        content_type = 'text/html; charset=utf-8'
        if url.path == '/page':
            with lock:
                state(case)['loads'] += 1
            fallback = f'http://localhost:{PORT}/fallback/{case}'
            intent = ('intent://open#Intent;scheme=os-missing-acceptance;'
                      'package=ru.multibrowser.acceptance.missing;'
                      f'S.browser_fallback_url={quote(fallback, safe="")};end')
            frame = f'/frame?case={case}'
            body = f'''<!doctype html><html lang="en"><meta name="viewport" content="width=device-width">
<title>External app acceptance</title><style>
body{{font:18px sans-serif;background:#203050;color:white;margin:16px}}h1{{font-size:22px}}
a{{display:block;background:#e0f2e8;color:#102018;padding:18px;margin:14px 0;border-radius:8px;text-decoration:none}}
iframe{{width:100%;height:110px;border:1px solid #829a9a}}p{{font-size:14px}}
</style><h1>External app acceptance</h1><p>Safe test number: 5551234. No call is placed.</p>
<a href="tel:5551234" onclick="mark('tel_click')">Open dialer</a>
<a href="{html.escape(intent, quote=True)}" onclick="mark('fallback_click')">Missing app fallback</a>
<iframe title="Frame link" src="{html.escape(frame, quote=True)}"></iframe>
<script>
const testCase={json.dumps(case)};
function mark(name){{fetch('/event?case='+testCase+'&name='+encodeURIComponent(name),{{cache:'no-store'}});}}
mark('loaded');
const mode={json.dumps(mode)};
if(mode==='auto')setTimeout(()=>{{mark('auto_attempt');location.href='tel:5551234';}},1500);
if(mode==='background')setTimeout(()=>{{mark('background_attempt');location.href='tel:5551234';}},20000);
</script></html>'''.encode()
        elif url.path == '/frame':
            body = f'''<!doctype html><html lang="en"><meta name="viewport" content="width=device-width">
<style>body{{margin:8px;font:18px sans-serif}}a{{display:block;padding:20px;background:#f2e2bd;color:#201c10}}</style>
<a href="tel:5551234" onclick="fetch('/event?case={case}&name=frame_click',{{cache:'no-store'}})">Frame dialer</a>
</html>'''.encode()
        elif url.path == '/event':
            name = query.get('name', [''])[0]
            if name not in {'loaded', 'tel_click', 'fallback_click', 'frame_click', 'auto_attempt', 'background_attempt'}:
                self.send_error(400)
                return
            with lock:
                events = state(case)['events']
                events[name] = events.get(name, 0) + 1
            body = b'OK'
            content_type = 'text/plain'
        elif url.path.startswith('/fallback/'):
            target = url.path[len('/fallback/'):]
            if not re.fullmatch(r'[a-z0-9-]{1,64}', target):
                self.send_error(400)
                return
            with lock:
                state(target)['fallbacks'] += 1
            body = b'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>App fallback</title><body style="font:24px sans-serif;background:#d7f0e2;padding:24px"><h1>App fallback</h1><p>The web page stayed in this browser.</p></body></html>'
        elif url.path == '/snapshot':
            with lock:
                body = json.dumps(states).encode()
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


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
