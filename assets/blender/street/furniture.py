"""Perabot jalan. Front faces Blender -Y (+Z in the app); the street light arm reaches +X
over the road. Named part: lamp (street light)."""
import math
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402


def build_street_light():
    """Lampu PJU 9 m dengan lengan 2 m ke arah jalan."""
    top, reach = 8.8, 2.0
    c.join('pole', p.pole(9.0, radius=0.09, footing=0.3) + [
        c.box('arm', (reach, 0.08, 0.08), (reach / 2, 0, top), p.mat('pole'), rotation=(0, math.radians(-6), 0)),
        c.box('panel', (0.3, 0.12, 0.4), (0, -0.1, 2.5), p.mat('grey')),
    ])
    c.join('head', [c.box('housing', (0.75, 0.32, 0.12), (reach + 0.25, 0, top + 0.12), p.mat('grey'))])
    c.box('lamp', (0.6, 0.24, 0.02), (reach + 0.25, 0, top + 0.05), c.material('lampu_jalan', (0.8, 0.78, 0.7), roughness=0.2))


def build_bus_stop():
    """Halte: atap, panel belakang, bangku, dan papan nama."""
    w, d, h = 6.0, 2.0, 2.7
    parts = [c.box('floor', (w + 0.4, d + 0.4, 0.15), (0, 0, 0.075), p.mat('concrete')),
             c.box('roof', (w + 0.6, d + 0.8, 0.12), (0, -0.2, h), p.mat('roof_metal')),
             c.box('back_panel', (w, 0.06, 1.8), (0, d / 2 - 0.1, 1.2), p.mat('glass')),
             c.box('bench', (w - 1.0, 0.45, 0.06), (0, d / 2 - 0.45, 0.5), p.mat('wood'))]
    parts += [c.box('post', (0.1, 0.1, h), (x, y, h / 2), p.mat('pole')) for x in (-w / 2, w / 2) for y in (d / 2 - 0.1, -d / 2 + 0.2)]
    parts += [c.box('bench_leg', (0.06, 0.4, 0.45), (x, d / 2 - 0.45, 0.25), p.mat('pole')) for x in (-2, 0, 2)]
    parts += [c.box('sign', (1.4, 0.06, 0.45), (-w / 2 + 0.9, -d / 2 - 0.15, h + 0.35), c.material('papan_halte', (0.1, 0.35, 0.65), roughness=0.5))]
    c.join('shelter', parts)
    c.text('label', 'HALTE', 0.28, (-w / 2 + 0.9, -d / 2 - 0.19, h + 0.35), p.mat('white'), extrude=0.01)


def build_bench():
    """Bangku taman kayu dengan kaki besi."""
    c.join('bench', [
        c.box('seat', (1.8, 0.45, 0.05), (0, 0, 0.45), p.mat('wood')),
        c.box('back', (1.8, 0.05, 0.4), (0, 0.22, 0.75), p.mat('wood')),
    ] + [c.box('leg', (0.06, 0.45, 0.45), (x, 0, 0.22), p.mat('pole')) for x in (-0.8, 0.8)]
      + [c.box('back_leg', (0.06, 0.05, 0.75), (x, 0.24, 0.4), p.mat('pole')) for x in (-0.8, 0.8)])


ASSETS = [
    c.Asset('street-light', 'Lampu jalan (PJU)', build_street_light, dict(target=(1, 0, 5), distance=14, height=0.5, angle=-25),
            parts=['lamp'], lights={'lamp': '#fff1c4'}),
    c.Asset('bus-stop', 'Halte', build_bus_stop, dict(target=(0, 0, 1.4), distance=10, height=1.6, angle=-30)),
    c.Asset('bench', 'Bangku taman', build_bench, dict(target=(0, 0, 0.5), distance=3.6, height=0.8, angle=-30)),
]

if __name__ == '__main__':
    c.run('street', ASSETS, 'furniture', group_spacing=3, group_view=dict(target_z=2.5))
