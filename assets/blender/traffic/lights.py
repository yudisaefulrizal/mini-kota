"""Lampu lalu lintas, dibangun dari komponen yang sama (kepala, tudung, tiang, timer).

A lamp name covers every object that starts with it: a light with two heads has
lamp_red and lamp_red_2, lit together. timer_display is the face the app paints with
the countdown. The pole stands on the left verge; arms reach right (+X) over the lanes.
"""
import math
import os
import sys

import bpy

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402

LAMP_OFF = {'red': (0.32, 0.05, 0.04), 'yellow': (0.38, 0.27, 0.04), 'green': (0.04, 0.28, 0.1)}
SIGNAL = {'lamp_red': '#ff3b2f', 'lamp_yellow': '#ffc23a', 'lamp_green': '#3ddc84'}


def lamp_mat(color):
    return c.material(f'lampu_{color}', LAMP_OFF[color], roughness=0.25)


def head(x, z, colors=('red', 'yellow', 'green'), suffix='', front=-0.2, spacing=0.32):
    """Vertical signal head centred at (x, front, z). Returns the non-lamp parts to join."""
    n = len(colors)
    height = spacing * n + 0.06
    parts = [
        c.box('housing', (0.34, 0.24, height), (x, front, z), p.mat('housing')),
        c.box('backplate', (0.56, 0.03, height + 0.18), (x, front + 0.135, z), p.mat('housing')),
    ]
    for i, color in enumerate(colors):
        lz = z + spacing * (n - 1) / 2 - i * spacing
        c.sphere(f'lamp_{color}{suffix}', 0.105, (x, front - 0.12, lz), lamp_mat(color), scale=(1, 0.35, 1))
        parts.append(c.hood('visor', 0.135, 0.22, (x, front - 0.23, lz), p.mat('housing')))
    return parts


def timer(x, z, front=-0.2):
    c.box('timer_display', (0.38, 0.01, 0.24), (x, front - 0.055, z), p.mat('screen'))
    return [c.box('timer_box', (0.46, 0.14, 0.32), (x, front + 0.02, z), p.mat('housing'))]


def seg(a, b, w):
    """Thick line from a to b as a 2D quad outline."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length * w / 2, dx / length * w / 2
    return [(a[0] + nx, a[1] + ny), (a[0] - nx, a[1] - ny), (b[0] - nx, b[1] - ny), (b[0] + nx, b[1] + ny)]


def circle(cx, cy, r, n=12):
    return [(cx + r * math.cos(i * 2 * math.pi / n), cy + r * math.sin(i * 2 * math.pi / n)) for i in range(n)]


def figure(name, x, front, z, walking, material, k=1.35):
    """Pedestrian silhouette on a lamp face, joined into one lamp part."""
    y = front - 0.135
    pieces = [c.flat_shape('kepala', circle((0.012 if walking else 0) * k, 0.085 * k, 0.022 * k), 0.01, (x, y, z), material)]
    if walking:
        limbs = [((0.008, 0.06), (-0.004, -0.01), 0.032), ((-0.004, -0.01), (-0.045, -0.09), 0.02),
                 ((-0.004, -0.01), (0.04, -0.09), 0.02), ((0.004, 0.05), (-0.04, 0.0), 0.016), ((0.004, 0.05), (0.045, 0.01), 0.016)]
    else:
        limbs = [((0, 0.06), (0, -0.01), 0.04), ((-0.012, -0.01), (-0.012, -0.09), 0.02), ((0.012, -0.01), (0.012, -0.09), 0.02),
                 ((-0.032, 0.055), (-0.034, 0.0), 0.014), ((0.032, 0.055), (0.034, 0.0), 0.014)]
    for a, b, w in limbs:
        pieces.append(c.flat_shape('anggota', seg((a[0] * k, a[1] * k), (b[0] * k, b[1] * k), w * k), 0.01, (x, y, z), material))
    return c.join(name, pieces)


def single_pole():
    c.join('pole', p.pole(4.1) + [p.bracket(0, 3.9), p.bracket(0, 3.2), p.bracket(0, 2.75)])
    c.join('head', head(0, 3.55) + timer(0, 2.75))


def build_single():
    single_pole()


def build_arm():
    """Cantilever: 6.2 m pole, 5 m arm over the lanes; overhead head plus one on the pole."""
    arm_z, reach = 5.9, 5.0
    c.join('pole', p.pole(6.2, radius=0.095, footing=0.36) + [
        c.box('arm', (reach, 0.14, 0.16), (reach / 2, 0, arm_z), p.mat('pole')),
        c.box('brace', (2.02, 0.08, 0.08), (0.85, 0, arm_z - 0.55), p.mat('pole'), rotation=(0, -math.atan2(1.1, 1.7), 0)),
        c.box('hanger', (0.08, 0.08, 0.2), (4.3, -0.04, arm_z - 0.16), p.mat('pole')),
        c.box('hanger_timer', (0.08, 0.08, 0.2), (3.45, -0.04, arm_z - 0.16), p.mat('pole')),
        p.bracket(0, 3.75), p.bracket(0, 3.05),
    ])
    c.join('head', head(4.3, arm_z - 0.8, front=-0.16) + timer(3.45, arm_z - 0.38, front=-0.16) + head(0, 3.4, suffix='_2'))


def build_arrow(side='right'):
    """Single pole plus a turn arrow beside the green lamp (right side for a right turn)."""
    single_pole()
    sign = 1 if side == 'right' else -1
    x, z, front = 0.36 * sign, 3.55 - 0.32, -0.2
    c.join('head_arrow', [
        c.box('housing_arrow', (0.34, 0.24, 0.36), (x, front, z), p.mat('housing')),
        c.box('backplate_arrow', (0.2, 0.03, 0.5), (x + 0.08 * sign, front + 0.135, z), p.mat('housing')),
        c.cylinder('arrow_disc', 0.105, 0.02, (x, front - 0.125, z), p.mat('housing'), rotation=(math.radians(90), 0, 0)),
        c.hood('visor', 0.135, 0.22, (x, front - 0.23, z), p.mat('housing')),
    ])
    arrow = [(-0.07, -0.02), (0.01, -0.02), (0.01, -0.055), (0.075, 0), (0.01, 0.055), (0.01, 0.02), (-0.07, 0.02)]
    if sign < 0:
        arrow = [(-px, py) for px, py in reversed(arrow)]
    c.flat_shape(f'lamp_arrow_{side}', arrow, 0.012, (x, front - 0.135, z), lamp_mat('green'))


def build_pedestrian():
    """3 m pole, two square aspects with figures, and a countdown."""
    front, top, bottom = -0.2, 2.75, 2.42
    c.join('pole', p.pole(3.0, radius=0.06, footing=0.22) + [p.bracket(0, top), p.bracket(0, bottom), p.bracket(0, 2.05)])
    parts = [c.box('housing', (0.32, 0.22, 0.7), (0, front, (top + bottom) / 2), p.mat('housing'))]
    for z in (top, bottom):
        parts += [c.box('window', (0.26, 0.01, 0.28), (0, front - 0.115, z), p.mat('screen')),
                  c.box('visor_top', (0.3, 0.16, 0.02), (0, front - 0.19, z + 0.15), p.mat('housing'))]
    c.join('head', parts + timer(0, 2.05))
    figure('lamp_ped_red', 0, front, top, False, lamp_mat('red'))
    figure('lamp_ped_green', 0, front, bottom, True, lamp_mat('green'))


def build_warning():
    """Flashing amber: one lamp facing each way on a short pole."""
    c.join('pole', p.pole(3.4, radius=0.06, footing=0.22) + [p.bracket(0, 3.15)])
    front = head(0, 3.15, colors=('yellow',))
    rear = head(0, 3.15, colors=('yellow',), suffix='_2')
    c.rotate_about_z(rear + [bpy.data.objects['lamp_yellow_2']], math.pi)
    c.join('head', front + rear)


SINGLE = dict(target=(0, 0, 2.6), distance=6, height=0.6, angle=-25)
ASSETS = [
    c.Asset('traffic-light', 'Lampu lalu lintas · tiang tunggal', build_single, SINGLE,
            parts=['lamp_red', 'lamp_yellow', 'lamp_green', 'timer_display'], lights=SIGNAL),
    c.Asset('traffic-light-arm', 'Lampu lalu lintas · tiang lengan', build_arm,
            dict(target=(2.2, 0, 3.6), distance=10, height=0.6, angle=-25),
            parts=['lamp_red', 'lamp_yellow', 'lamp_green', 'lamp_red_2', 'lamp_yellow_2', 'lamp_green_2', 'timer_display'], lights=SIGNAL),
    c.Asset('traffic-light-arrow-right', 'Lampu lalu lintas · panah kanan', lambda: build_arrow('right'), SINGLE,
            parts=['lamp_red', 'lamp_yellow', 'lamp_green', 'lamp_arrow_right', 'timer_display'], lights={**SIGNAL, 'lamp_arrow_right': '#3ddc84'}),
    c.Asset('traffic-light-arrow-left', 'Lampu lalu lintas · panah kiri', lambda: build_arrow('left'), SINGLE,
            parts=['lamp_red', 'lamp_yellow', 'lamp_green', 'lamp_arrow_left', 'timer_display'], lights={**SIGNAL, 'lamp_arrow_left': '#3ddc84'}),
    c.Asset('pedestrian-light', 'Lampu pejalan kaki', build_pedestrian, dict(target=(0, 0, 2.3), distance=4.2, height=0.5, angle=-25),
            parts=['lamp_ped_red', 'lamp_ped_green', 'timer_display'], lights={'lamp_ped_red': '#ff3b2f', 'lamp_ped_green': '#3ddc84'}),
    c.Asset('warning-light', 'Lampu kuning kedip', build_warning, dict(target=(0, 0, 2.3), distance=4.2, height=0.5, angle=-25),
            parts=['lamp_yellow', 'lamp_yellow_2'], lights={'lamp_yellow': '#ffc23a'}),
]

if __name__ == '__main__':
    c.run('traffic', ASSETS, 'lights', group_spacing=3.0, group_view=dict(target_z=2.5, distance=16, height=4, angle=-15))
