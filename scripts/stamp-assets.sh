#!/usr/bin/env bash
# Appends a content hash to every local CSS/JS reference, e.g.
#   assets/js/cms.js  ->  assets/js/cms.js?v=1a2b3c4d
#
# GitHub Pages serves these with cache-control: max-age=600, so without this a
# browser can hold one file for ten minutes while fetching a fresh copy of
# another. A mismatched pair of admin.js and cms-map.js renders an EMPTY editor,
# which looks exactly like a broken feature.
#
# Run before committing whenever a .js or .css file changed.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, glob, hashlib, os

def h(path):
    return hashlib.md5(open(path,'rb').read()).hexdigest()[:8] if os.path.exists(path) else None

changed = 0
for f in glob.glob('*.html') + glob.glob('admin/*.html'):
    s = open(f, encoding='utf-8').read()
    orig = s
    base = os.path.dirname(f)

    def stamp(m):
        attr, url = m.group(1), m.group(2)
        clean = url.split('?')[0]
        target = os.path.normpath(os.path.join(base, clean))
        v = h(target)
        return f'{attr}="{clean}"' if not v else f'{attr}="{clean}?v={v}"'

    s = re.sub(r'(src|href)="((?:\.\./)?assets/(?:js|css)/[^"?]+\.(?:js|css)(?:\?v=[0-9a-f]+)?)"', stamp, s)
    s = re.sub(r'(src|href)="(admin\.(?:js|css)(?:\?v=[0-9a-f]+)?)"', stamp, s)
    if s != orig:
        open(f, 'w', encoding='utf-8').write(s)
        changed += 1
        print(f'  stamped {f}')
print(f'{changed} file(s) updated')
PY
