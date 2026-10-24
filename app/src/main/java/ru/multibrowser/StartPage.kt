package ru.multibrowser

/** Локализованная стартовая страница (генерируется под текущий язык и тему). */
object StartPage {
    fun html(): ByteArray {
        val dark = Ui.dark
        val bg = hex(Ui.BG); val text = hex(Ui.TEXT); val muted = hex(Ui.MUTED); val accent = hex(Ui.ACCENT)
        val dir = if (Tr.isRtl()) "rtl" else "ltr"
        val tagline = esc(Tr.t("start_tagline"))
        val hint = esc(Tr.t("start_hint"))
        val s = """<!doctype html><html dir="$dir"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:$bg;color:$text;text-align:center;padding:24px}
.ring{width:70px;height:70px;border:9px solid $text;border-radius:50%;position:relative;margin-bottom:8px}
.axis{position:absolute;top:50%;left:-34px;width:150px;height:8px;background:$accent;transform:translateY(-50%)}
.dot{position:absolute;top:50%;left:-44px;width:18px;height:18px;border-radius:50%;background:$accent;transform:translateY(-50%)}
h1{font-size:22px;margin:14px 0 4px}.t{color:$accent}
.b{color:$muted;font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px}
p{color:$muted;font-size:14px;max-width:320px;line-height:1.5}</style></head>
<body><div class="ring"><div class="axis"></div><div class="dot"></div></div>
<h1>Ось<span class="t">Browser</span></h1>
<p class="b">$tagline</p>
<p>$hint</p></body></html>"""
        return s.toByteArray(Charsets.UTF_8)
    }

    private fun hex(c: Int) = String.format("#%06X", 0xFFFFFF and c)
    private fun esc(x: String) = x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
