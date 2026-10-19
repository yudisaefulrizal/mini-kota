"""Vegetasi: pohon dan semak. Origin at the base of the trunk."""
import math
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402


def build_shade_tree():
    """Pohon peneduh (seperti angsana): batang 3 m, tajuk lebar dari beberapa gumpalan."""
    c.join('trunk', [
        c.cylinder('trunk', 0.22, 3.4, (0, 0, 1.7), p.mat('bark'), vertices=8),
        c.cylinder('branch_l', 0.1, 1.6, (-0.6, 0, 3.4), p.mat('bark'), rotation=(0, math.radians(-35), 0), vertices=6),
        c.cylinder('branch_r', 0.1, 1.6, (0.6, 0.2, 3.5), p.mat('bark'), rotation=(math.radians(-15), math.radians(35), 0), vertices=6),
    ])
    blobs = [((0, 0, 4.6), 2.3), ((-1.4, 0.4, 4.1), 1.6), ((1.5, -0.3, 4.2), 1.7), ((0.3, 1.2, 4.0), 1.5), ((-0.2, -1.2, 4.3), 1.5)]
    c.join('crown', [c.ico('crown', r, loc, p.mat('leaf') if i % 2 == 0 else p.mat('leaf_light'), scale=(1, 1, 0.75)) for i, (loc, r) in enumerate(blobs)])


def build_column_tree():
    """Glodokan tiang: pohon ramping dan tinggi yang umum ditanam di tepi jalan."""
    c.cylinder('trunk', 0.15, 1.6, (0, 0, 0.8), p.mat('bark'), vertices=8)
    layers = []
    for i in range(6):
        z = 1.4 + i * 1.25
        r = 1.15 - i * 0.12
        layers.append(c.cone('layer', r, r * 0.35, 1.7, (0, 0, z + 0.85), p.mat('leaf') if i % 2 else p.mat('leaf_light'), vertices=10))
    c.join('crown', layers)


def build_palm():
    """Pohon palem: batang sedikit melengkung, pelepah menjuntai."""
    trunk = []
    for i in range(6):
        trunk.append(c.cylinder('segment', 0.2 - i * 0.012, 1.3, (i * 0.08, 0, 0.65 + i * 1.25), p.mat('bark'),
                                rotation=(0, math.radians(4), 0), vertices=8))
    c.join('trunk', trunk)
    top = (0.45, 0, 7.7)
    fronds = [c.ico('crown_core', 0.45, top, p.mat('leaf'))]
    for i in range(8):
        a = i * math.tau / 8
        frond = c.box('frond', (2.6, 0.5, 0.06), (top[0] + math.cos(a) * 1.25, top[1] + math.sin(a) * 1.25, top[2] - 0.35),
                      p.mat('leaf_light') if i % 2 else p.mat('leaf'), rotation=(0, math.radians(18), a))
        fronds.append(frond)
    c.join('crown', fronds)


def build_shrub():
    """Semak rendah untuk taman dan median jalan."""
    c.join('shrub', [c.ico('shrub', r, loc, p.mat('leaf') if i % 2 else p.mat('leaf_light'), scale=(1, 1, 0.7))
                     for i, (loc, r) in enumerate([((0, 0, 0.45), 0.6), ((0.5, 0.2, 0.35), 0.45), ((-0.45, -0.1, 0.35), 0.45)])])


ASSETS = [
    c.Asset('tree-shade', 'Pohon peneduh', build_shade_tree, dict(target=(0, 0, 3), distance=14, height=1.5, angle=-30)),
    c.Asset('tree-column', 'Glodokan tiang', build_column_tree, dict(target=(0, 0, 4.5), distance=15, height=1.0, angle=-30)),
    c.Asset('tree-palm', 'Pohon palem', build_palm, dict(target=(0, 0, 4.5), distance=15, height=1.0, angle=-30)),
    c.Asset('shrub', 'Semak', build_shrub, dict(target=(0, 0, 0.4), distance=4, height=1.2, angle=-30)),
]

if __name__ == '__main__':
    c.run('nature', ASSETS, 'vegetation', group_spacing=3, group_view=dict(target_z=3))
