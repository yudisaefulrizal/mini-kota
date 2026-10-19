"""Perangkat kota cerdas.

The camera lens, the cabinet door and the gateway's LED side face Blender -Y (+Z in the
app). The CCTV arm reaches +X over the road.
"""
import math
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402


def build_cctv():
    """Bullet camera on a 1 m arm at 6 m, tilted 18° down towards approaching traffic."""
    top, reach = 5.9, 1.0
    c.join('pole', p.pole(6.1, radius=0.07, footing=0.26) + [
        c.box('arm', (reach, 0.06, 0.06), (reach / 2, 0, top), p.mat('pole')),
        c.box('mount', (0.06, 0.06, 0.16), (reach, 0, top - 0.08), p.mat('pole')),
        # Junction box for the cable and PoE connection, within reach of a ladder.
        c.box('junction_box', (0.22, 0.12, 0.3), (0, -0.1, 3.0), p.mat('grey')),
    ])
    tilt = math.radians(-18)
    cx, cy, cz = reach, -0.12, top - 0.24
    c.join('camera', [
        c.box('housing', (0.12, 0.34, 0.12), (cx, cy, cz), p.mat('white'), rotation=(tilt, 0, 0)),
        c.box('sunshield', (0.16, 0.4, 0.02), (cx, cy - 0.02, cz + 0.08), p.mat('white'), rotation=(tilt, 0, 0)),
        c.box('back_cap', (0.13, 0.03, 0.13), (cx, cy + 0.17, cz + 0.055), p.mat('dark'), rotation=(tilt, 0, 0)),
    ])
    ly, lz = cy - 0.17 * math.cos(tilt), cz + 0.17 * math.sin(tilt)
    c.cylinder('lens', 0.042, 0.03, (cx, ly - 0.01, lz), p.mat('glass'), rotation=(math.radians(90) + tilt, 0, 0), vertices=16)


def build_dome():
    """PTZ dome camera hanging from a short arm at 5 m; it can pan to watch every approach."""
    top, reach = 5.0, 0.6
    c.join('pole', p.pole(5.2, radius=0.07, footing=0.26) + [
        c.box('arm', (reach, 0.06, 0.06), (reach / 2, 0, top), p.mat('pole')),
        c.box('junction_box', (0.22, 0.12, 0.3), (0, -0.1, 3.0), p.mat('grey')),
    ])
    c.join('camera', [
        c.cylinder('pendant', 0.03, 0.18, (reach, 0, top - 0.09), p.mat('white'), vertices=10),
        c.cylinder('dome_base', 0.13, 0.12, (reach, 0, top - 0.24), p.mat('white'), vertices=20),
    ])
    c.sphere('lens_dome', 0.12, (reach, 0, top - 0.3), p.mat('glass'), scale=(1, 1, 0.85), segments=20, rings=10)


def build_controller():
    """Signal controller cabinet: plinth, two-door steel cabinet, roof overhang and vents."""
    w, d, h, base = 1.2, 0.6, 1.6, 0.15
    shell = [
        c.box('plinth', (w + 0.2, d + 0.2, base), (0, 0, base / 2), p.mat('concrete')),
        c.box('cabinet', (w, d, h), (0, 0, base + h / 2), p.mat('grey')),
        c.box('roof', (w + 0.08, d + 0.08, 0.04), (0, 0, base + h + 0.02), p.mat('grey')),
    ]
    front = -d / 2 - 0.006
    for x in (-w / 4, w / 4):
        shell += [
            c.box('door_seam', (0.01, 0.012, h - 0.12), (x + (w / 4 if x < 0 else -w / 4), front, base + h / 2), p.mat('dark')),
            c.box('handle', (0.03, 0.03, 0.14), (x + (0.2 if x < 0 else -0.2), front - 0.015, base + h / 2), p.mat('dark')),
        ]
        for i in range(4):
            shell.append(c.box('vent', (0.3, 0.012, 0.02), (x, front, base + h - 0.18 - i * 0.05), p.mat('dark')))
    shell.append(c.box('label_plate', (0.24, 0.012, 0.12), (-w / 4, front, base + h * 0.62), p.mat('white')))
    c.join('cabinet', shell)


def build_gateway():
    """Industrial edge box on a 3.6 m pole: two antennas and a status LED row."""
    z, box_y = 3.1, -0.2
    c.join('pole', p.pole(3.6, radius=0.06, footing=0.22) + [
        c.box('bracket_top', (0.06, 0.12, 0.06), (0, -0.06, z + 0.12), p.mat('pole')),
        c.box('bracket_bottom', (0.06, 0.12, 0.06), (0, -0.06, z - 0.12), p.mat('pole')),
    ])
    c.join('gateway', [
        c.box('enclosure', (0.42, 0.16, 0.34), (0, box_y, z), p.mat('dark')),
        c.box('fin_top', (0.46, 0.18, 0.02), (0, box_y, z + 0.18), p.mat('grey')),
        c.box('label', (0.18, 0.006, 0.06), (-0.08, box_y - 0.083, z - 0.08), p.mat('white')),
        c.cylinder('antenna_base_l', 0.02, 0.04, (-0.14, box_y, z + 0.21), p.mat('grey'), vertices=8),
        c.cylinder('antenna_l', 0.012, 0.42, (-0.14, box_y, z + 0.44), p.mat('dark'), vertices=8),
        c.cylinder('antenna_base_r', 0.02, 0.04, (0.14, box_y, z + 0.21), p.mat('grey'), vertices=8),
        c.cylinder('antenna_r', 0.012, 0.3, (0.14, box_y, z + 0.38), p.mat('dark'), vertices=8),
        c.box('cable', (0.03, 0.03, 0.4), (0.12, box_y + 0.03, z - 0.36), p.mat('dark')),
    ])
    c.join('led', [c.box(f'led_{i}', (0.025, 0.008, 0.025), (0.05 + i * 0.045, box_y - 0.083, z + 0.07), p.mat('led')) for i in range(4)])


def build_bin_sensor():
    """Area waste container (± 1.3 × 1 m) on wheels; ultrasonic module and antenna on the lid."""
    w, d, h = 1.3, 1.0, 1.05
    body = [
        c.box('container', (w, d, h), (0, 0, 0.15 + h / 2), p.mat('green_bin')),
        c.box('rim', (w + 0.06, d + 0.06, 0.06), (0, 0, 0.15 + h), p.mat('green_bin')),
        c.box('lid', (w + 0.02, d + 0.1, 0.05), (0, 0.02, 0.15 + h + 0.055), p.mat('green_bin')),
        c.box('handle_bar', (w * 0.6, 0.04, 0.04), (0, -d / 2 - 0.05, 0.15 + h - 0.1), p.mat('dark')),
    ]
    for x in (-w / 2 + 0.15, w / 2 - 0.15):
        for y in (-d / 2 + 0.15, d / 2 - 0.15):
            body.append(c.cylinder('wheel', 0.075, 0.06, (x, y, 0.075), p.mat('tyre'), rotation=(0, math.radians(90), 0), vertices=12))
    c.join('bin', body)
    top = 0.15 + h + 0.08
    # The ultrasonic transducer looks down through the lid; the module sits on top.
    c.join('sensor', [
        c.box('sensor_box', (0.18, 0.14, 0.07), (0, -0.1, top + 0.035), p.mat('white')),
        c.cylinder('antenna', 0.01, 0.22, (0.07, -0.1, top + 0.18), p.mat('dark'), vertices=8),
    ])
    c.box('sensor_led', (0.025, 0.008, 0.02), (-0.05, -0.172, top + 0.04), p.mat('led'))


ASSETS = [
    c.Asset('cctv', 'Kamera CCTV · bullet', build_cctv, dict(target=(0.4, 0, 3.6), distance=8.5, height=0.8, angle=-30)),
    c.Asset('cctv-dome', 'Kamera CCTV · dome PTZ', build_dome, dict(target=(0.3, 0, 3.2), distance=7.5, height=0.8, angle=-30)),
    c.Asset('controller', 'Kabinet pengendali simpang', build_controller, dict(target=(0, 0, 0.9), distance=3.8, height=0.6, angle=-30)),
    c.Asset('gateway', 'Gateway edge', build_gateway, dict(target=(0, 0, 2.6), distance=3.6, height=0.7, angle=-30), parts=['led']),
    c.Asset('bin-sensor', 'Tempat sampah + sensor ultrasonik', build_bin_sensor, dict(target=(0, 0, 0.8), distance=3.6, height=0.9, angle=-30),
            parts=['sensor', 'sensor_led']),
]

if __name__ == '__main__':
    c.run('devices', ASSETS, 'devices', group_spacing=3.2, group_view=dict(target_z=2.4, distance=15, height=3.5, angle=-15))
