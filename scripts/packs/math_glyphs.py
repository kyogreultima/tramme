# The math pack's glyph table, extracted once from STIX Two Math (OFL): the
# advance, the bounds and the outline of each glyph the TeX subset uses,
# written as SVG path data for scripts/packs/math.ts to convert through the
# SVG reader. Run before that script:
#
#   python scripts/packs/math_glyphs.py
#
import json, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT = os.path.join(os.path.dirname(__file__), '../../plugins/math/STIX2Math.otf')
OUT = os.path.join(os.path.dirname(__file__), 'math-glyphs-raw.json')

font = TTFont(FONT)
upem = font['head'].unitsPerEm
cmap = font.getBestCmap()
glyphSet = font.getGlyphSet()
hmtx = font['hmtx']

# the subset: ASCII, the Greek letters, the italic latin of the math
# alphanumerics, and the operators and arrows the pack parses
chars = [chr(c) for c in range(0x20, 0x7F)]
chars += [chr(c) for c in range(0x391, 0x3A2)] + [chr(c) for c in range(0x3A3, 0x3AA)] + [chr(c) for c in range(0x3B1, 0x3CA)]
chars += [chr(0x1D434 + i) for i in range(26)] + [chr(0x1D44E + i) for i in range(26)]
chars += ['·', '×', '≤', '≥', '≠', '≈', '∞', '→', '←', '∑', '∫', '√', '∂', '±', '−', '…', '⋅', '∈', '∇', 'ℝ', 'ℕ', 'ℤ']

out = {'upem': upem, 'glyphs': {}}
missing = []
for ch in chars:
    name = cmap.get(ord(ch))
    if not name:
        missing.append(ch)
        continue
    g = glyphSet[name]
    pen = SVGPathPen(glyphSet)
    g.draw(pen)
    d = pen.getCommands()
    bp = BoundsPen(glyphSet)
    g.draw(bp)
    adv = hmtx[name][0]
    if not d:
        continue
    out['glyphs'][ch] = {'adv': adv, 'd': d, 'bounds': list(bp.bounds) if bp.bounds else [0, 0, 0, 0]}

# flipped to draw with y down (the pack's canvas), bounds with it
for ch, g in out['glyphs'].items():
    x0, y0, x1, y1 = g['bounds']
    g['bounds'] = [x0, -y1, x1, -y0]

json.dump(out, open(OUT, 'w'))
print(f"{len(out['glyphs'])} glyphs (upem {upem}), missing: {''.join(missing) or 'none'}")
