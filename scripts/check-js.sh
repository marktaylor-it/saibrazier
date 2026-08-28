#!/usr/bin/env bash
# `node --check` only validates syntax. It passes happily on a function that is
# called but never defined — which is exactly how a span-based edit silently
# deleted loadState() and markDirty() and blanked the whole editor.
#
# This asserts the functions each file must define. Cheap, precise, no guessing.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in assets/js/*.js admin/admin.js; do
  node --check "$f" >/dev/null || { echo "SYNTAX ERROR: $f"; exit 1; }
done

python3 - <<'PY'
import re, sys
REQUIRED = {
  'admin/admin.js': ['markDirty','loadState','readPage','renderFields','renderImages',
                     'renderColors','checkContrast','previewTheme','renderTodos',
                     'renderCustom','addCustomPage','renderAccess','addAccess','publish','guard','guardAsync',
                     'resizeToBase64','ratio','lum','srgb','hash'],
  'assets/js/cms.js': ['decodeValue','decodeFields','getDoc','pageSlug','applyBlocks',
                       'themeCss','applyTheme','safeHref','applyLinks','applyMeta',
                       'applyNav','applyImages','applyTodos','apply'],
  'assets/js/cms-map.js': [],
  'assets/js/nav.js': ['closeAll'],
  'assets/js/theme.js': ['current','render'],
}
bad = 0
for f, names in REQUIRED.items():
    s = open(f, encoding='utf-8').read()
    defined = set(re.findall(r'(?:async\s+)?function\s+([A-Za-z_$][\w$]*)', s))
    for n in names:
        if n not in defined:
            print(f'  MISSING: {f} must define {n}()')
            bad += 1
print('  all required functions present' if not bad else f'  {bad} missing')
sys.exit(1 if bad else 0)
PY
