"""Orang (pejalan kaki), 1,65 m. Feet at the origin, facing Blender -Y (+Z in the app).
The `baju` (shirt) and `celana` (trousers) materials may be recoloured per person.

The figure is rigged for walking: each leg (`leg_l`, `leg_r`, with its shoe) and arm (`arm_l`,
`arm_r`) is its own part with its origin at the hip or shoulder, and the pose is stored as the
part's rotation about X instead of being baked into the mesh. The app swings these parts to
animate steps (src/traffic/view.js); the three assets differ only in their resting pose.
Positive angles swing a limb backwards (towards +Y)."""
import math
import os
import sys

import bpy

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as c  # noqa: E402
import parts as p  # noqa: E402

HIP = 0.82          # hip height (m); legs are this long, so feet touch the ground at rest
SHOULDER = HIP + 0.56
ARM = 0.56
LIMBS = ['leg_l', 'leg_r', 'arm_l', 'arm_r']


def limb(name, objects, pivot, angle):
    """Join `objects` into one part whose origin is `pivot`, posed by `angle` (degrees) about X."""
    obj = c.join(name, objects) if len(objects) > 1 else objects[0]
    obj.name = obj.data.name = name
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.scene.cursor.location = pivot
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.context.scene.cursor.location = (0, 0, 0)
    obj.rotation_euler = (math.radians(angle), 0, 0)
    return obj


def body(stride=0.0, arm_swing=0.0, carry=False):
    """Low-poly figure; `stride` and `arm_swing` are the resting pose in degrees."""
    skin = c.material('kulit', (0.62, 0.42, 0.3), roughness=0.7)
    shirt = c.material('baju', (0.75, 0.38, 0.25), roughness=0.8)
    pants = c.material('celana', (0.15, 0.2, 0.3), roughness=0.8)
    hair = c.material('rambut', (0.05, 0.04, 0.03), roughness=0.8)
    for side, sign in (('l', 1), ('r', -1)):
        x = sign * 0.09
        leg = c.box(f'leg_{side}', (0.13, 0.15, HIP), (x, 0, HIP / 2), pants)
        shoe = c.box(f'shoe_{side}', (0.12, 0.24, 0.07), (x, -0.04, 0.035), p.mat('dark'))
        # Left leg back, right leg forward when striding.
        limb(f'leg_{side}', [leg, shoe], (x, 0, HIP), stride * sign)
    c.box('torso', (0.38, 0.22, 0.56), (0, 0, HIP + 0.3), shirt)
    for side, sign in (('l', 1), ('r', -1)):
        x = sign * 0.25
        arm = c.box(f'arm_{side}', (0.1, 0.11, ARM), (x, 0, SHOULDER - ARM / 2), shirt)
        hand = c.box(f'hand_{side}', (0.08, 0.09, 0.08), (x, 0, SHOULDER - ARM - 0.03), skin)
        pieces = [arm, hand]
        angle = -arm_swing * sign              # arms swing against the legs
        if carry and sign > 0:
            # The bag hangs from the left hand and swings with that arm.
            pieces.append(c.ico('bag', 0.16, (x + 0.05, -0.02, SHOULDER - ARM - 0.2),
                                c.material('kantong_sampah', (0.12, 0.13, 0.12), roughness=0.6), scale=(1, 0.9, 1.2)))
            angle = -8
        limb(f'arm_{side}', pieces, (x, 0, SHOULDER), angle)
    c.join('head', [c.box('neck', (0.1, 0.1, 0.08), (0, 0, HIP + 0.62), skin), c.sphere('head', 0.12, (0, 0, HIP + 0.78), skin, segments=10, rings=6),
                    c.sphere('hair', 0.125, (0, 0.02, HIP + 0.82), hair, scale=(1, 1, 0.7), segments=10, rings=6)])


VIEW = dict(target=(0, 0, 0.9), distance=3.2, height=0.3)
ASSETS = [
    c.Asset('person', 'Pejalan kaki · berdiri', lambda: body(), dict(VIEW, angle=-30), parts=LIMBS, tint=['baju', 'celana']),
    c.Asset('person-walking', 'Pejalan kaki · berjalan', lambda: body(stride=22, arm_swing=20), dict(VIEW, angle=-60),
            parts=LIMBS, tint=['baju', 'celana']),
    c.Asset('person-carrying-bag', 'Warga membawa kantong sampah', lambda: body(stride=18, arm_swing=15, carry=True),
            dict(VIEW, angle=-40), parts=LIMBS, tint=['baju', 'celana']),
]

if __name__ == '__main__':
    c.run('people', ASSETS, 'people', group_spacing=1.0, group_view=dict(target_z=0.9))
