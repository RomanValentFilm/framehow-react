#!/usr/bin/env python3
"""Builds site/public-dev/index.html — the new front page, on the test address
only. Texts come straight from Roman's "Tutorial PDF.pdf" (texts.json), one
step per slide, the text above its picture."""
import json, html, sys

texts = json.load(open(sys.argv[1]))
OUT = sys.argv[2]

def clean(s: str) -> str:
    return s.replace('ﬀ', 'ff').replace('ﬁ', 'fi').replace('ﬂ', 'fl')

steps = []
for i, lines in enumerate(texts, 1):
    lines = [clean(l) for l in lines]
    title, body = lines[0], ' '.join(lines[1:])
    extra = ''
    if i == 24:  # the install line goes to Get started, not under SYNC
        body = ' '.join(lines[1:-1]); extra = lines[-1]
    steps.append({'n': i, 'title': title, 'body': body, 'img': f'/img/wf/{i:02d}.jpg' if i <= 23 else None,
                  'w': 1286 if i == 13 else 2360, 'h': 849 if i == 13 else 1595})

CHAPTERS = [
    ('LOAD', 1, 5),
    ('ON THE RECCE', 6, 9),
    ('SKETCH & REFERENCE', 10, 13),
    ('PLAN THE SHOOT', 14, 17),
    ('SHOOTING ORDERS', 18, 20),
    ('NOTES, EXPORT, SYNC', 21, 24),
]

def esc(s): return html.escape(s, quote=True)

def step_html(s):
    small = (s['img'] or '').replace('.jpg', '-1200.jpg')
    # Full size for big and sharp screens, 1200 px for phones; the browser picks.
    srcset = f'{small} 1200w, {s["img"]} {s["w"]}w' if s['w'] > 1200 else s['img'] + f' {s["w"]}w'
    pic = (f'<img src="{s["img"]}" srcset="{srcset}" sizes="(max-width: 1148px) 90vw, 990px" width="{s["w"]}" height="{s["h"]}" loading="lazy" decoding="async" alt="{esc(s["title"])}">'
           if s['img'] else '')
    body = f'<p>{esc(s["body"])}</p>' if s['body'] else ''
    return f'''    <article class="step">
      <div class="step-text"><h3>{esc(s["title"])}</h3>{body}</div>
      {pic}
    </article>'''

wf = [step_html(s) for s in steps]
workflow = '\n'.join(wf)

page = open(sys.argv[3]).read().replace('{{WORKFLOW}}', workflow)
open(OUT, 'w').write(page)
print('steps', len(steps), '→', OUT)
