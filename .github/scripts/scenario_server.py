# Локальный сервер для матрицы сценариев: cookies по профилям и скачивание файлов разных типов.
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

TYPES = {"pdf": "application/pdf", "csv": "text/csv", "png": "image/png", "txt": "text/plain",
         "zip": "application/zip", "mp3": "audio/mpeg", "json": "application/json", "bin": "application/octet-stream",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


class H(BaseHTTPRequestHandler):
    def page(self, body, headers=()):
        data = ("<!doctype html><meta name='viewport' content='width=device-width'>"
                "<body style='font:20px sans-serif;padding:24px;background:#fff;color:#000'>" + body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/set":
            v = q.get("v", ["x"])[0]
            self.page(f"<h2>Cookie set</h2><p>{v}</p>", [("Set-Cookie", f"v={v}; Path=/; Max-Age=3600")])
        elif u.path == "/read":
            n = q.get("n", ["0"])[0]
            self.page(f"<h2>Cookie read {n}</h2><p id=c></p><script>"
                      f"document.getElementById('c').textContent=document.cookie||'(none)';"
                      f"console.log('COOKIE n={n} '+document.cookie);</script>")
        elif u.path == "/links":
            # Долгое нажатие: крупная ссылка и картинка во всю ширину (меню ссылки и картинки).
            self.page("<a id=l href='/target?x=1' style='display:block;height:200px;font-size:28px;"
                      "background:#e8f0fe'>Long press link</a><p>text</p>"
                      "<img id=i src='/img.png' alt='Test picture' style='display:block;width:100%;height:200px'>")
        elif u.path == "/img.png":
            import struct, zlib
            def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
            data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
                    + chunk(b"IDAT", zlib.compress(b"\x00\xf0\x45\x3a")) + chunk(b"IEND", b""))
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif u.path.startswith("/file/"):
            name = u.path.rsplit("/", 1)[-1]
            data = (name * 200).encode()[:8192]
            self.send_response(200)
            self.send_header("Content-Type", TYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream"))
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.page("<h2>Os scenario server</h2>")

    def log_message(self, *a):
        pass


HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
