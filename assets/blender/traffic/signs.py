"""Rambu lalu lintas pada tiang.

The board follows the white text sign commonly seen on Indonesian roads; it has not
been checked against the official sign regulation (Permenhub on traffic signs).
"""
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402


def build_left_turn():
    white = c.material('papan_putih', (0.92, 0.93, 0.9), roughness=0.4)
    black = c.material('tulisan_hitam', (0.02, 0.02, 0.02), roughness=0.5)
    width, height, z = 1.0, 0.5, 2.35   # plate size and centre height (m)
    c.join('pole', p.pole(2.7, radius=0.045, footing=0.2) + [
        c.box('clamp_top', (0.08, 0.06, 0.04), (0, -0.04, z + 0.15), p.mat('pole')),
        c.box('clamp_bottom', (0.08, 0.06, 0.04), (0, -0.04, z - 0.15), p.mat('pole')),
    ])
    c.box('plate', (width, 0.02, height), (0, -0.08, z), white)
    front, border = -0.092, 0.025
    face = [
        c.box('border_top', (width - 0.04, 0.004, border), (0, front, z + height / 2 - 0.035), black),
        c.box('border_bottom', (width - 0.04, 0.004, border), (0, front, z - height / 2 + 0.035), black),
        c.box('border_left', (border, 0.004, height - 0.07), (-width / 2 + 0.035, front, z), black),
        c.box('border_right', (border, 0.004, height - 0.07), (width / 2 - 0.035, front, z), black),
        c.text('text_top', 'BELOK KIRI', 0.1, (0.08, front, z + 0.07), black),
        c.text('text_bottom', 'JALAN TERUS', 0.1, (0.08, front, z - 0.075), black),
    ]
    arrow = [(0.07, -0.025), (-0.01, -0.025), (-0.01, -0.07), (-0.09, 0), (-0.01, 0.07), (-0.01, 0.025), (0.07, 0.025)]
    face.append(c.flat_shape('arrow', arrow, 0.004, (-0.36, front + 0.004, z), black))
    c.join('face', face)


ASSETS = [
    c.Asset('sign-left-turn', 'Rambu belok kiri jalan terus', build_left_turn, dict(target=(0, 0, 1.8), distance=4.2, height=0.4, angle=-20)),
]

if __name__ == '__main__':
    c.run('traffic', ASSETS, 'signs')
