"""Kendaraan.

Front faces Blender -Y (+Z in the app). The driver's left is +X, so indicator_left sits
on the +X side. Named parts: headlight, brake_light, indicator_left (front and rear),
indicator_right. The `paint` material may be recoloured per vehicle by the app.
"""
import math
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402

LIGHTS = {'headlight': '#fff4d0', 'brake_light': '#ff3b2f', 'indicator_left': '#ffa516', 'indicator_right': '#ffa516'}

def lamp_materials():
    return {
        'headlight': c.material('lampu_depan', (0.85, 0.85, 0.8), roughness=0.15),
        'brake_light': c.material('lampu_rem', (0.45, 0.04, 0.04), roughness=0.2),
        'indicator': c.material('lampu_sein', (0.6, 0.35, 0.05), roughness=0.2),
    }


def wheel(x, y, radius, width):
    return [
        c.cylinder('tyre', radius, width, (x, y, radius), p.mat('tyre'), rotation=(0, math.radians(90), 0), vertices=16),
        c.cylinder('hub', radius * 0.55, width + 0.02, (x, y, radius), p.mat('chrome'), rotation=(0, math.radians(90), 0), vertices=12),
    ]


def lights(front_y, rear_y, half_w, head_z, rear_z, size=0.3):
    """Headlights, brake lights and four indicators at the corners."""
    m = lamp_materials()
    c.join('headlight', [c.box('headlight_l', (size, 0.04, 0.12), (sx * (half_w - size / 2 - 0.08), front_y - 0.01, head_z), m['headlight']) for sx in (1, -1)])
    c.join('brake_light', [c.box('brake_l', (size * 0.8, 0.04, 0.18), (sx * (half_w - size / 2 - 0.05), rear_y + 0.01, rear_z), m['brake_light']) for sx in (1, -1)])
    for side, sx in (('left', 1), ('right', -1)):
        c.box(f'indicator_{side}_front', (0.1, 0.04, 0.07), (sx * (half_w - 0.05), front_y - 0.012, head_z - 0.12), m['indicator'])
        c.box(f'indicator_{side}_rear', (0.1, 0.04, 0.07), (sx * (half_w - 0.05), rear_y + 0.012, rear_z - 0.15), m['indicator'])


def build_car():
    """MPV-style car, 4.4 × 1.75 × 1.6 m (a common family car on Indonesian roads)."""
    w, paint = 1.75, p.paint('paint', (0.55, 0.12, 0.08))
    c.join('body', [
        c.prism('lower', [(-2.2, 0.3), (2.2, 0.3), (2.2, 1.02), (-1.15, 1.02), (-2.0, 0.88), (-2.2, 0.72)], w, paint),
        c.prism('roof', [(-0.36, 1.5), (1.97, 1.5), (1.9, 1.6), (-0.25, 1.6)], w - 0.06, paint),
        c.box('pillar_b', (w - 0.07, 0.12, 0.5), (0, 0.75, 1.26), paint),
        c.box('mirror_l', (0.14, 0.08, 0.1), (w / 2 + 0.05, -1.05, 1.1), paint),
        c.box('mirror_r', (0.14, 0.08, 0.1), (-w / 2 - 0.05, -1.05, 1.1), paint),
    ])
    c.prism('glass', [(-1.15, 1.0), (2.12, 1.0), (1.93, 1.52), (-0.32, 1.52)], w - 0.1, p.mat('glass'))
    trim = [
        c.box('bumper_front', (w + 0.02, 0.12, 0.22), (0, -2.22, 0.42), p.mat('dark')),
        c.box('bumper_rear', (w + 0.02, 0.12, 0.22), (0, 2.22, 0.42), p.mat('dark')),
        c.box('plate_front', (0.42, 0.02, 0.12), (0, -2.29, 0.45), p.mat('white')),
        c.box('plate_rear', (0.42, 0.02, 0.12), (0, 2.29, 0.5), p.mat('white')),
    ]
    for x in (w / 2 - 0.1, -w / 2 + 0.1):
        for y in (-1.4, 1.4):
            trim += wheel(x, y, 0.32, 0.22)
    c.join('trim', trim)
    lights(-2.2, 2.2, w / 2, 0.62, 0.85)


def build_minibus():
    """Minibus, 5.4 × 1.9 × 2.3 m: the shared moving vehicle (up to 10 people)."""
    w, paint = 1.9, p.paint('paint', (0.1, 0.42, 0.62))
    pillars = [c.box(f'pillar_{i}', (w - 0.05, 0.1, 0.85), (0, y, 1.52), paint) for i, y in enumerate((-1.55, -0.3, 0.95, 2.62))]
    c.join('body', [
        c.prism('lower', [(-2.7, 0.32), (2.7, 0.32), (2.7, 1.12), (-2.5, 1.12), (-2.7, 0.92)], w, paint),
        c.prism('roof', [(-2.4, 1.93), (2.7, 1.93), (2.7, 2.3), (-2.25, 2.3)], w, paint),
        c.box('mirror_l', (0.14, 0.08, 0.16), (w / 2 + 0.06, -2.3, 1.45), paint),
        c.box('mirror_r', (0.14, 0.08, 0.16), (-w / 2 - 0.06, -2.3, 1.45), paint),
    ] + pillars)
    c.prism('glass', [(-2.52, 1.1), (2.66, 1.1), (2.66, 1.95), (-2.36, 1.95)], w - 0.08, p.mat('glass'))
    trim = [
        c.box('bumper_front', (w + 0.02, 0.12, 0.24), (0, -2.72, 0.45), p.mat('dark')),
        c.box('bumper_rear', (w + 0.02, 0.12, 0.24), (0, 2.72, 0.45), p.mat('dark')),
        c.box('plate_front', (0.42, 0.02, 0.12), (0, -2.79, 0.5), p.mat('white')),
        c.box('plate_rear', (0.42, 0.02, 0.12), (0, 2.79, 0.55), p.mat('white')),
        c.box('stripe', (w + 0.012, 4.6, 0.08), (0, 0.15, 0.95), p.mat('white')),
    ]
    for x in (w / 2 - 0.12, -w / 2 + 0.12):
        for y in (-1.85, 1.75):
            trim += wheel(x, y, 0.36, 0.24)
    c.join('trim', trim)
    lights(-2.7, 2.7, w / 2, 0.72, 0.95)


def build_garbage_truck():
    """Compactor garbage truck, 7.2 × 2.3 × 3.1 m: orange cab, green body, dual rear axles."""
    w, paint = 2.3, p.paint('paint', (0.85, 0.5, 0.1))
    body_green = c.material('bak_hijau', (0.2, 0.36, 0.2), roughness=0.6)
    c.join('cab', [
        c.prism('cab', [(-3.6, 0.55), (-1.75, 0.55), (-1.75, 2.65), (-3.33, 2.65), (-3.6, 1.6)], w - 0.1, paint),
        c.box('visor', (w - 0.08, 0.3, 0.06), (0, -3.4, 2.62), paint),
        c.box('mirror_l', (0.08, 0.1, 0.4), (w / 2 + 0.12, -3.3, 1.9), p.mat('dark')),
        c.box('mirror_r', (0.08, 0.1, 0.4), (-w / 2 - 0.12, -3.3, 1.9), p.mat('dark')),
    ])
    c.join('glass', [
        c.prism('windshield', [(-3.63, 1.66), (-3.52, 1.66), (-3.29, 2.52), (-3.4, 2.52)], w - 0.3, p.mat('glass')),
        c.box('side_l', (0.012, 0.8, 0.6), ((w - 0.1) / 2 + 0.006, -2.55, 2.05), p.mat('glass')),
        c.box('side_r', (0.012, 0.8, 0.6), (-(w - 0.1) / 2 - 0.006, -2.55, 2.05), p.mat('glass')),
    ])
    c.join('body', [
        c.prism('compactor', [(-1.6, 0.95), (3.0, 0.95), (3.0, 3.0), (-1.45, 3.1), (-1.6, 2.95)], w, body_green),
        c.prism('hopper', [(3.0, 0.75), (3.6, 0.95), (3.6, 2.6), (3.0, 2.9)], w - 0.1, body_green),
        c.box('rib_1', (w + 0.04, 0.08, 2.0), (0, -0.2, 1.97), p.mat('dark')),
        c.box('rib_2', (w + 0.04, 0.08, 2.0), (0, 1.3, 1.97), p.mat('dark')),
    ])
    trim = [
        c.box('chassis', (1.0, 7.0, 0.3), (0, 0, 0.75), p.mat('dark')),
        c.box('bumper_front', (w, 0.15, 0.3), (0, -3.65, 0.6), p.mat('dark')),
        c.box('bumper_rear', (w - 0.2, 0.12, 0.2), (0, 3.62, 0.6), p.mat('dark')),
        c.box('plate_front', (0.5, 0.02, 0.14), (0, -3.735, 0.62), p.mat('white')),
    ]
    for x in (w / 2 - 0.2, -w / 2 + 0.2):
        trim += wheel(x, -2.85, 0.5, 0.32)
        for y in (1.55, 2.6):
            trim += wheel(x, y, 0.5, 0.32)
            trim += wheel(x - math.copysign(0.34, x), y, 0.5, 0.3)
    c.join('trim', trim)
    lights(-3.6, 3.62, w / 2, 0.95, 1.0, size=0.34)
    c.box('beacon', (0.3, 0.15, 0.12), (0, -2.4, 2.71), lamp_materials()['indicator'])


ASSETS = [
    c.Asset('car', 'Mobil penumpang', build_car, dict(target=(0, 0, 0.8), distance=7, height=1.6, angle=-35), parts=list(LIGHTS), lights=LIGHTS, tint=['paint']),
    c.Asset('minibus', 'Minibus pengantar', build_minibus, dict(target=(0, 0, 1.1), distance=8.5, height=1.8, angle=-35), parts=list(LIGHTS), lights=LIGHTS, tint=['paint']),
    c.Asset('garbage-truck', 'Truk sampah', build_garbage_truck, dict(target=(0, 0, 1.4), distance=11, height=2.2, angle=-35), parts=list(LIGHTS), lights=LIGHTS, tint=['paint']),
]

if __name__ == '__main__':
    c.run('vehicles', ASSETS, 'vehicles', group_spacing=4.0, group_view=dict(target_z=1.0, distance=19, height=6, angle=-25))
