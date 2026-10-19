"""Gedung untuk kawasan Mini Kota.

Entrances face Blender -Y (+Z in the app). Footprints are sized to fit the lots on the
map (1 map unit = 0.4 m). The `dinding` material may be recoloured per building.
"""
import math
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402


def wall_paint(color=(0.88, 0.86, 0.8)):
    return c.material('dinding', color, roughness=0.85)


def windows(width, depth, rows, row_height, base_z, win=(1.2, 1.2), spacing=3.0, sides='fblr', band=False, mat=None):
    """Windows on the facades of a width (X) × depth (Y) block. `band` makes one strip per
    floor instead of separate windows (cheaper for tall buildings)."""
    mat = mat or p.mat('window')
    out = []
    faces = {'f': (width, -depth / 2 - 0.03, 0), 'b': (width, depth / 2 + 0.03, 0),
             'l': (depth, width / 2 + 0.03, 1), 'r': (depth, -width / 2 - 0.03, 1)}
    for side in sides:
        length, offset, along_y = faces[side]
        for row in range(rows):
            z = base_z + row * row_height
            if band:
                size = (0.06, length - 1.0, win[1]) if along_y else (length - 1.0, 0.06, win[1])
                out.append(c.box('band', size, (offset, 0, z) if along_y else (0, offset, z), mat))
                continue
            count = max(1, int((length - 1.5) // spacing))
            for i in range(count):
                t = (i - (count - 1) / 2) * spacing
                size = (0.06, win[0], win[1]) if along_y else (win[0], 0.06, win[1])
                out.append(c.box('window', size, (offset, t, z) if along_y else (t, offset, z), mat))
    return out


def gable_roof(width, depth, base_z, rise, overhang=0.5, mat=None, ridge_along='x'):
    """Pitched roof; the ridge runs along X unless ridge_along='y'."""
    mat = mat or p.mat('roof_tile')
    if ridge_along == 'x':
        d = depth / 2 + overhang
        return c.prism('roof', [(-d, base_z), (d, base_z), (0, base_z + rise)], width + 2 * overhang, mat)
    d = width / 2 + overhang
    roof = c.prism('roof', [(-d, base_z), (d, base_z), (0, base_z + rise)], depth + 2 * overhang, mat)
    c.rotate_about_z([roof], math.pi / 2)
    return roof


def block(name, size, z0, mat):
    w, d, h = size
    return c.box(name, (w, d, h), (0, 0, z0 + h / 2), mat)


def door(x, y, w, h, mat=None):
    return c.box('door', (w, 0.08, h), (x, y, h / 2 + 0.3), mat or p.mat('wood'))


# ---------------------------------------------------------------- buildings

def build_house():
    """Rumah satu lantai 8 × 9 m dengan teras dan atap genteng."""
    w, d, h = 8.0, 9.0, 3.2
    wall = wall_paint()
    parts = [c.box('plinth', (w + 0.3, d + 0.3, 0.3), (0, 0, 0.15), p.mat('concrete')), block('walls', (w, d, h), 0.3, wall)]
    parts += windows(w, d, 1, 0, 1.9, win=(1.1, 1.2), spacing=2.6, sides='blr')
    parts += [c.box('window_front', (1.6, 0.06, 1.2), (-2.2, -d / 2 - 0.03, 1.9), p.mat('window')), door(1.2, -d / 2 - 0.04, 1.0, 2.1)]
    # Terrace: slab, two columns and a small roof.
    parts += [c.box('terrace', (w, 2.0, 0.3), (0, -d / 2 - 1.0, 0.15), p.mat('concrete'))]
    parts += [c.box('column', (0.25, 0.25, 2.8), (x, -d / 2 - 1.8, 1.7), wall) for x in (-w / 2 + 0.3, w / 2 - 0.3)]
    parts.append(c.box('terrace_roof', (w + 0.4, 2.4, 0.15), (0, -d / 2 - 1.0, 3.2), p.mat('roof_tile')))
    c.join('walls', parts)
    gable_roof(w, d, h + 0.3, 2.4)


def build_house_two():
    """Rumah dua lantai 7 × 9 m; atap pelana menghadap jalan."""
    w, d, h = 7.0, 9.0, 6.4
    wall = wall_paint((0.86, 0.74, 0.58))
    parts = [c.box('plinth', (w + 0.3, d + 0.3, 0.3), (0, 0, 0.15), p.mat('concrete')), block('walls', (w, d, h), 0.3, wall)]
    parts += windows(w, d, 2, 3.2, 1.9, win=(1.1, 1.2), spacing=2.4, sides='blr')
    parts += [c.box('window_front', (1.4, 0.06, 1.2), (-1.8, -d / 2 - 0.03, 1.9), p.mat('window')), door(1.4, -d / 2 - 0.04, 1.0, 2.1),
              c.box('window_upper', (3.0, 0.06, 1.3), (0, -d / 2 - 0.03, 5.0), p.mat('window')),
              c.box('balcony', (3.6, 1.0, 0.15), (0, -d / 2 - 0.5, 3.6), p.mat('concrete')),
              c.box('railing', (3.6, 0.06, 0.9), (0, -d - 0.5 + d / 2, 4.1), p.mat('dark'))]
    c.join('walls', parts)
    gable_roof(w, d, h + 0.3, 2.6, ridge_along='y')


def build_shophouse():
    """Ruko tiga pintu, masing-masing 4,5 m, dua lantai dengan papan nama."""
    units, uw, d, h = 3, 4.5, 12.0, 8.0
    w = units * uw
    wall = wall_paint((0.92, 0.9, 0.84))
    parts = [c.box('plinth', (w + 0.3, d + 0.3, 0.3), (0, 0, 0.15), p.mat('concrete')), block('walls', (w, d, h), 0.3, wall),
             c.box('parapet', (w, 0.3, 1.0), (0, -d / 2 + 0.15, h + 0.8), wall),
             c.box('canopy', (w + 0.2, 1.4, 0.15), (0, -d / 2 - 0.7, 3.6), p.mat('roof_metal'))]
    for i in range(units):
        x = (i - (units - 1) / 2) * uw
        parts += [
            c.box('rolling_door', (uw - 0.8, 0.08, 3.0), (x, -d / 2 - 0.04, 1.8), p.mat('grey')),
            c.box('window_upper', (uw - 1.4, 0.06, 1.4), (x, -d / 2 - 0.03, 5.6), p.mat('window')),
            c.box('sign', (uw - 0.6, 0.1, 0.7), (x, -d / 2 - 0.08, 4.2), c.material(f'papan_{i}', [(0.75, 0.2, 0.15), (0.15, 0.4, 0.65), (0.85, 0.6, 0.1)][i], roughness=0.5)),
        ]
        for z in (1.0, 1.8, 2.6):
            parts.append(c.box('slat', (uw - 0.8, 0.1, 0.04), (x, -d / 2 - 0.09, z), p.mat('dark')))
    parts += [c.box('divider', (0.2, 0.2, h), ((i - units / 2) * uw, -d / 2 - 0.05, h / 2 + 0.3), wall) for i in range(units + 1)]
    c.join('walls', parts)
    c.box('roof', (w, d - 0.3, 0.2), (0, 0.15, h + 0.4), p.mat('roof_metal'))


def build_office():
    """Gedung kantor 10 lantai, 20 × 20 × 36 m, dengan lobi kaca."""
    w = d = 20.0
    floors, fh = 10, 3.6
    h = floors * fh
    wall = wall_paint((0.78, 0.8, 0.8))
    parts = [c.box('podium', (w + 2, d + 2, 0.4), (0, 0, 0.2), p.mat('concrete')), block('core', (w, d, h), 0.4, wall)]
    parts += windows(w, d, floors - 1, fh, 0.4 + fh * 1.55, win=(0, 2.0), band=True)
    parts += [c.box('lobby', (w - 4, 0.08, 3.0), (0, -d / 2 - 0.04, 1.9), p.mat('window')),
              c.box('canopy', (8.0, 3.0, 0.3), (0, -d / 2 - 1.5, 3.8), p.mat('roof_metal')),
              c.box('roof_plant', (8.0, 6.0, 2.5), (2.0, 2.0, h + 1.65), p.mat('grey')),
              c.box('parapet', (w + 0.2, d + 0.2, 0.8), (0, 0, h + 0.8), wall)]
    c.join('building', parts)


def build_school():
    """Sekolah dua lantai 40 × 10 m: selasar bertiang, atap genteng, tiang bendera."""
    w, d, h = 40.0, 10.0, 7.4
    wall = wall_paint((0.94, 0.92, 0.85))
    parts = [c.box('plinth', (w + 0.6, d + 4.0, 0.4), (0, -1.8, 0.2), p.mat('concrete')), block('walls', (w, d, h), 0.4, wall)]
    parts += windows(w, d, 2, 3.6, 2.1, win=(1.6, 1.4), spacing=4.0, sides='fb')
    # Covered corridor along the front, one column every 4 m.
    parts += [c.box('corridor_floor', (w, 0.15, 0.25), (0, -d / 2 - 1.7, 3.85), p.mat('concrete')),
              c.box('corridor_slab', (w, 3.4, 0.25), (0, -d / 2 - 1.7, 4.0), p.mat('concrete')),
              c.box('railing', (w, 0.08, 1.0), (0, -d / 2 - 3.35, 4.6), wall)]
    parts += [c.box('column', (0.35, 0.35, h), (x, -d / 2 - 3.2, h / 2 + 0.4), wall) for x in [i * 4.0 - w / 2 + 2 for i in range(10)]]
    c.join('walls', parts)
    gable_roof(w, d + 3.6, h + 0.4, 2.6, overhang=0.6).location.y -= 1.8
    c.join('flag', [
        c.cylinder('flagpole', 0.06, 9.0, (-w / 2 - 4, -d / 2 - 8, 4.5), p.mat('chrome'), vertices=8),
        c.box('flag_red', (0.02, 1.8, 0.6), (-w / 2 - 4, -d / 2 - 8 - 0.9, 8.4), c.material('merah', (0.75, 0.05, 0.05), roughness=0.6)),
        c.box('flag_white', (0.02, 1.8, 0.6), (-w / 2 - 4, -d / 2 - 8 - 0.9, 7.8), c.material('putih', (0.95, 0.95, 0.95), roughness=0.6)),
        c.box('flag_base', (1.2, 1.2, 0.3), (-w / 2 - 4, -d / 2 - 8, 0.15), p.mat('concrete')),
    ])


def build_campus():
    """Gedung kuliah 4 lantai, 45 × 18 m, dengan pintu masuk berkanopi."""
    w, d, floors, fh = 45.0, 18.0, 4, 3.8
    h = floors * fh
    wall = wall_paint((0.9, 0.88, 0.82))
    parts = [c.box('plinth', (w + 2, d + 2, 0.5), (0, 0, 0.25), p.mat('concrete')), block('walls', (w, d, h), 0.5, wall)]
    parts += windows(w, d, floors, fh, 2.3, win=(2.2, 1.6), spacing=3.6, sides='fblr')
    parts += [c.box('entrance', (10, 0.1, h - 1.0), (0, -d / 2 - 0.06, (h - 1.0) / 2 + 0.5), p.mat('window')),
              c.box('canopy', (14, 5.0, 0.4), (0, -d / 2 - 2.5, 4.5), wall)]
    parts += [c.box('column', (0.6, 0.6, 4.0), (x, -d / 2 - 4.6, 2.5), wall) for x in (-6, -2, 2, 6)]
    parts += [c.box('parapet', (w + 0.2, d + 0.2, 1.0), (0, 0, h + 1.0), wall)]
    c.join('building', parts)
    c.box('roof', (w - 0.4, d - 0.4, 0.2), (0, 0, h + 0.6), p.mat('roof_metal'))


def build_mall():
    """Pusat perbelanjaan 60 × 35 × 12 m dengan kanopi dan papan nama."""
    w, d, h = 60.0, 35.0, 12.0
    wall = wall_paint((0.85, 0.83, 0.78))
    parts = [c.box('plinth', (w + 4, d + 4, 0.4), (0, 0, 0.2), p.mat('concrete')), block('walls', (w, d, h), 0.4, wall)]
    parts += windows(w, d, 1, 0, 2.2, win=(0, 3.4), band=True, sides='f')
    parts += [c.box('entrance', (14, 0.1, 6.5), (0, -d / 2 - 0.1, 3.65), p.mat('window')),
              c.box('canopy', (24, 6.0, 0.5), (0, -d / 2 - 3.0, 7.3), p.mat('roof_metal')),
              c.box('sign_band', (w - 6, 0.3, 2.2), (0, -d / 2 - 0.2, h - 1.0), c.material('papan_mall', (0.7, 0.15, 0.25), roughness=0.5))]
    c.join('building', parts)
    c.text('sign', 'PUSAT BELANJA', 1.5, (0, -d / 2 - 0.4, h - 1.0), p.mat('white'), extrude=0.05)
    c.box('roof', (w - 1, d - 1, 0.3), (0, 0, h + 0.55), p.mat('roof_metal'))


def build_factory():
    """Pabrik 40 × 25 m dengan atap gigi gergaji, cerobong, dan pintu bongkar muat."""
    w, d, h = 40.0, 25.0, 8.0
    wall = wall_paint((0.75, 0.77, 0.74))
    parts = [c.box('plinth', (w + 2, d + 2, 0.4), (0, 0, 0.2), p.mat('concrete')), block('walls', (w, d, h), 0.4, wall)]
    parts += [c.box('loading_door', (5.0, 0.1, 5.0), (x, -d / 2 - 0.05, 2.9), p.mat('grey')) for x in (-12, 0, 12)]
    parts += windows(w, d, 1, 0, 6.2, win=(2.5, 1.2), spacing=5.0, sides='lr')
    c.join('walls', parts)
    # Sawtooth roof: north-light teeth across the depth.
    teeth, tooth = 5, d / 5
    roof = []
    for i in range(teeth):
        y0 = -d / 2 + i * tooth
        roof.append(c.prism('tooth', [(y0, h + 0.4), (y0 + tooth, h + 0.4), (y0 + tooth, h + 3.2)], w, p.mat('roof_metal')))
        roof.append(c.box('roof_glass', (w - 0.2, 0.05, 2.6), (0, y0 + tooth - 0.03, h + 1.8), p.mat('window')))
    c.join('roof', roof)
    c.join('chimney', [c.cylinder('chimney', 1.0, 22.0, (w / 2 - 4, d / 2 - 4, 11.0), p.mat('concrete'), vertices=16),
                       c.cylinder('chimney_band', 1.05, 1.0, (w / 2 - 4, d / 2 - 4, 20.0), c.material('merah', (0.75, 0.05, 0.05), roughness=0.6), vertices=16)])


def build_data_center():
    """Data center 28 × 25 × 10 m: sedikit jendela, unit pendingin di atap, genset di samping."""
    w, d, h = 28.0, 25.0, 10.0
    wall = wall_paint((0.24, 0.36, 0.38))
    parts = [c.box('plinth', (w + 2, d + 2, 0.4), (0, 0, 0.2), p.mat('concrete')), block('walls', (w, d, h), 0.4, wall),
             c.box('parapet', (w + 0.3, d + 0.3, 0.8), (0, 0, h + 0.8), c.material('atap_gelap', (0.09, 0.22, 0.27), roughness=0.6)),
             c.box('entrance', (6.0, 0.1, 3.2), (-6, -d / 2 - 0.06, 2.0), p.mat('window')),
             c.box('canopy', (8.0, 2.5, 0.3), (-6, -d / 2 - 1.25, 3.9), p.mat('roof_metal'))]
    parts += [c.box('slit', (0.6, 0.06, 4.0), (x, -d / 2 - 0.03, 6.0), c.material('kaca_biru', (0.25, 0.6, 0.65), roughness=0.1)) for x in (2, 5, 8, 11)]
    c.join('building', parts)
    units = []
    for i in range(4):
        for j in range(2):
            x, y = -9 + i * 6, -4 + j * 8
            units += [c.box('cooler', (4.0, 5.0, 1.6), (x, y, h + 1.2), p.mat('grey'))]
            units += [c.cylinder('fan', 0.8, 0.1, (x + dx, y + dy, h + 2.05), p.mat('dark'), vertices=12) for dx in (-1, 1) for dy in (-1.2, 1.2)]
    units += [c.box('generator', (3.0, 6.0, 2.4), (w / 2 + 3, y0, 1.6), p.mat('grey')) for y0 in (-6, 3)]
    c.join('equipment', units)
    c.text('sign', 'DATA CENTER', 1.1, (6.5, -d / 2 - 0.1, 8.6), p.mat('white'), extrude=0.05)


def build_tps3r():
    """TPS3R: hanggar terbuka 26 × 20 m, bak pemilahan, dan kontainer."""
    w, d, h = 26.0, 20.0, 6.0
    parts = [c.box('floor', (w + 2, d + 2, 0.3), (0, 0, 0.15), p.mat('concrete'))]
    parts += [c.box('column', (0.4, 0.4, h), (x, y, h / 2 + 0.3), p.mat('pole')) for x in (-w / 2, -w / 6, w / 6, w / 2) for y in (-d / 2, d / 2)]
    parts += [c.box('back_wall', (w, 0.3, 2.5), (0, d / 2, 1.55), p.mat('wall'))]
    # Sorting bays: low walls dividing organic, plastic, paper and residue.
    parts += [c.box('bay_wall', (0.3, 6.0, 1.5), (x, d / 2 - 3.2, 1.05), p.mat('concrete')) for x in (-9, -3, 3, 9)]
    c.join('structure', parts)
    roof = c.prism('roof', [(-d / 2 - 1, h + 0.3), (d / 2 + 1, h + 0.3), (0, h + 2.6)], w + 2, p.mat('roof_metal'))
    roof.name = 'roof'
    containers = []
    for i, color in enumerate([(0.13, 0.36, 0.2), (0.75, 0.55, 0.1), (0.15, 0.35, 0.6)]):
        x = -8 + i * 8
        mat = c.material(f'kontainer_{i}', color, roughness=0.6)
        containers += [c.box('container', (2.4, 5.5, 1.6), (x, -d / 2 - 4.5, 1.1), mat),
                       c.box('container_rim', (2.5, 5.6, 0.1), (x, -d / 2 - 4.5, 1.95), mat)]
    containers.append(c.box('waste_pile', (6.0, 4.0, 1.2), (-9, 5, 0.9), c.material('sampah', (0.4, 0.35, 0.28), roughness=1.0)))
    c.join('yard', containers)


def view(distance, z, height=None):
    return dict(target=(0, 0, z), distance=distance, height=height if height is not None else distance * 0.28, angle=-35)


ASSETS = [
    c.Asset('house', 'Rumah satu lantai', build_house, view(26, 2.5), tint=['dinding']),
    c.Asset('house-two-storey', 'Rumah dua lantai', build_house_two, view(27, 3.8), tint=['dinding']),
    c.Asset('shophouse', 'Ruko tiga pintu', build_shophouse, view(32, 4.5), tint=['dinding']),
    c.Asset('office', 'Gedung kantor', build_office, view(70, 16), tint=['dinding']),
    c.Asset('school', 'Sekolah', build_school, view(55, 4.5), tint=['dinding']),
    c.Asset('campus', 'Gedung kampus', build_campus, view(65, 7), tint=['dinding']),
    c.Asset('mall', 'Pusat perbelanjaan', build_mall, view(85, 6), tint=['dinding']),
    c.Asset('factory', 'Pabrik', build_factory, view(65, 7)),
    c.Asset('data-center', 'Data center', build_data_center, view(50, 5)),
    c.Asset('tps3r', 'TPS3R (pengolahan sampah)', build_tps3r, view(45, 3)),
]

if __name__ == '__main__':
    c.run('buildings', ASSETS, 'buildings', group_spacing=10, group_view=dict(target_z=5, distance=190, height=95, angle=-25))
