"""Shared helpers for every asset script. See assets/README.md for the conventions.

An asset script defines a list of `Asset` entries and calls `run(category, assets)`.
`run` builds each asset in a clean scene, exports it, renders a preview and records it
in public/models/manifest.json, which the app and the preview page read.
"""
import json
import math
import os
import sys
from dataclasses import dataclass, field

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
MODELS = os.path.join(ROOT, 'public', 'models')
SOURCES = os.path.join(ROOT, 'assets', 'sources')
PREVIEWS = os.path.join(ROOT, 'assets', 'previews')
MANIFEST = os.path.join(MODELS, 'manifest.json')

CATEGORIES = {
    'traffic': 'Lalu lintas',
    'devices': 'Perangkat',
    'vehicles': 'Kendaraan',
    'buildings': 'Gedung',
    'nature': 'Vegetasi',
    'street': 'Perabot jalan',
    'people': 'Orang',
}


@dataclass
class Asset:
    id: str                      # kebab-case; also the file name
    name: str                    # display name (Indonesian)
    build: object                # function that creates the objects
    view: dict = field(default_factory=dict)    # preview camera (see preview())
    parts: list = field(default_factory=list)   # named nodes the app controls
    lights: dict = field(default_factory=dict)  # lamp name prefix -> lit colour (hex)
    tint: list = field(default_factory=list)    # material names the app may recolour


# ---------------------------------------------------------------- scene setup

_materials = {}


def reset():
    _materials.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1.0


def material(name, color, roughness=0.6, metallic=0.0, emission=None):
    """Flat low-poly material; `emission` is (color, strength) for parts that glow."""
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission[0], 1)
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    _materials[name] = m
    return m


def _select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _finish(obj, name, mat):
    obj.name = name
    obj.data.name = name
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    _select(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


# ---------------------------------------------------------------- primitives

def box(name, size, location, mat=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.scale = size
    return _finish(obj, name, mat)


def cylinder(name, radius, depth, location, mat=None, rotation=(0, 0, 0), vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location,
                                        rotation=rotation, vertices=vertices)
    return _finish(bpy.context.active_object, name, mat)


def cone(name, radius1, radius2, depth, location, mat=None, rotation=(0, 0, 0), vertices=12):
    bpy.ops.mesh.primitive_cone_add(radius1=radius1, radius2=radius2, depth=depth, location=location,
                                    rotation=rotation, vertices=vertices)
    return _finish(bpy.context.active_object, name, mat)


def sphere(name, radius, location, mat=None, scale=(1, 1, 1), segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=segments, ring_count=rings)
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, name, mat)


def ico(name, radius, location, mat=None, scale=(1, 1, 1), subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, location=location, subdivisions=subdivisions)
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, name, mat)


def _mesh_object(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        mesh.materials.append(mat)
    _select(obj)
    return obj


def prism(name, outline, width, mat=None, x=0.0):
    """Side profile (y, z points, counter-clockwise seen from +X) extruded across X.
    Used for vehicle bodies and gable roofs."""
    n = len(outline)
    left = [(x - width / 2, y, z) for y, z in outline]
    right = [(x + width / 2, y, z) for y, z in outline]
    faces = [list(range(n))[::-1], [i + n for i in range(n)]]
    faces += [[i, (i + 1) % n, (i + 1) % n + n, i + n] for i in range(n)]
    return _mesh_object(name, left + right, faces, mat)


def flat_shape(name, outline, thickness, location, mat=None, rotation=(math.radians(90), 0, 0)):
    """Extruded 2D outline (x, y in metres), e.g. an arrow on a lamp face.
    The default rotation stands it up facing Blender -Y."""
    n = len(outline)
    verts = [(x, y, 0) for x, y in outline] + [(x, y, thickness) for x, y in outline]
    faces = [list(range(n))[::-1], [i + n for i in range(n)]]
    faces += [[i, (i + 1) % n, (i + 1) % n + n, i + n] for i in range(n)]
    obj = _mesh_object(name, verts, faces, mat)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


def hood(name, radius, depth, location, mat=None, open_angle=110, vertices=20):
    """Curved visor over a lamp: a tube along -Y with the bottom arc removed."""
    import bmesh
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location,
                                        rotation=(math.radians(90), 0, 0), vertices=vertices, end_fill_type='NOTHING')
    obj = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    limit = math.cos(math.radians(open_angle / 2))
    # Before the object rotation the tube runs along local Z, so "down" is local -Y.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if -v.co.y / radius > limit], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    solid = obj.modifiers.new('tebal', 'SOLIDIFY')
    solid.thickness = 0.012
    bpy.ops.object.modifier_apply(modifier=solid.name)
    return _finish(obj, name, mat)


def text(name, body, size, location, mat=None, extrude=0.004, align='CENTER'):
    """Flat 3D text facing Blender -Y, converted to a mesh so it exports to glTF."""
    bpy.ops.object.text_add(location=location, rotation=(math.radians(90), 0, 0))
    obj = bpy.context.active_object
    obj.data.body = body
    obj.data.size = size
    obj.data.extrude = extrude
    obj.data.align_x = align
    obj.data.align_y = 'CENTER'
    obj.data.resolution_u = 3
    bpy.ops.object.convert(target='MESH')
    return _finish(bpy.context.active_object, name, mat)


def join(name, objects):
    """Merge parts into one object to keep draw calls low in the app."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def rotate_about_z(objects, angle):
    """Turn objects around the world Z axis (the asset's vertical centre line)."""
    for o in objects:
        x, y = o.location.x, o.location.y
        o.location.x = x * math.cos(angle) - y * math.sin(angle)
        o.location.y = x * math.sin(angle) + y * math.cos(angle)
        o.rotation_euler.z += angle
        _select(o)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


# ---------------------------------------------------------------- output

def triangles():
    return sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)


def bounds():
    from mathutils import Vector
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    # Blender X/Y/Z -> width, depth, height in metres.
    return [round(hi.x - lo.x, 2), round(hi.y - lo.y, 2), round(hi.z - lo.z, 2)]


def export(asset, category):
    for folder in (os.path.join(MODELS, category), os.path.join(SOURCES, category)):
        os.makedirs(folder, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(MODELS, category, f'{asset.id}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_yup=True, export_extras=True, export_apply=True)
    bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCES, category, f'{asset.id}.blend'))
    missing = [p for p in asset.parts if not any(o.name.startswith(p) for o in bpy.data.objects)]
    if missing:
        raise RuntimeError(f'{asset.id}: named parts missing: {missing}')
    entry = {
        'id': asset.id, 'name': asset.name, 'category': category,
        'file': f'models/{category}/{asset.id}.glb',
        'size': bounds(), 'triangles': triangles(),
        'parts': asset.parts, 'lights': asset.lights, 'tint': asset.tint,
    }
    print(f'EXPORTED {path} ({entry["triangles"]} triangles, {entry["size"]} m)')
    return entry


def write_manifest(entries):
    """Merge entries into the manifest, ordered by category then build order."""
    data = {'categories': CATEGORIES, 'assets': []}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            data['assets'] = json.load(f).get('assets', [])
    ids = {e['id'] for e in entries}
    kept = [a for a in data['assets'] if a['id'] not in ids]
    order = list(CATEGORIES)
    merged = kept + entries
    merged.sort(key=lambda a: order.index(a['category']))
    data['assets'] = merged
    os.makedirs(MODELS, exist_ok=True)
    with open(MANIFEST, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def light_up(lights):
    """Preview only: make lamp parts (objects named with a lamp prefix) glow."""
    for obj in bpy.data.objects:
        for prefix, colour in lights.items():
            if obj.type == 'MESH' and obj.name.startswith(prefix):
                rgb = tuple(int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
                for mat in obj.data.materials:
                    node = mat.node_tree.nodes.get('Principled BSDF')
                    node.inputs['Emission Color'].default_value = (*rgb, 1)
                    node.inputs['Emission Strength'].default_value = 6


def preview(path, target=(0, 0, 2), distance=7.0, height=2.5, angle=-35, size=(800, 800), lens=50):
    """Cycles render from the front-left (the asset front is -Y) for review."""
    from mathutils import Vector
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('preview')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.86, 0.9, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(material('preview_ground', (0.78, 0.82, 0.76), 1.0))
    bpy.ops.object.light_add(type='SUN', location=(4, -4, 10))
    sun = bpy.context.active_object
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
    a = math.radians(angle)
    bpy.ops.object.camera_add(location=(target[0] + distance * math.sin(a), target[1] - distance * math.cos(a), target[2] + height))
    cam = bpy.context.active_object
    cam.data.lens = lens
    cam.data.clip_end = 1000
    cam.rotation_euler = Vector((target[0] - cam.location.x, target[1] - cam.location.y, target[2] - cam.location.z)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'PREVIEW {path}')


def preview_group(category, name, entries, spacing, view):
    """Every asset of a script on a grid, lamps lit, for a quick overview."""
    reset()
    cols = max(1, math.ceil(math.sqrt(len(entries) * 2.2)))
    cell_w = max(e['size'][0] for e in entries) + spacing
    cell_d = max(e['size'][1] for e in entries) + spacing
    rows = math.ceil(len(entries) / cols)
    for i, entry in enumerate(entries):
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, category, f'{entry["id"]}.glb'))
        col, row = i % cols, i // cols
        for o in bpy.context.selected_objects:
            if o.parent is None:
                o.location.x += (col - (cols - 1) / 2) * cell_w
                o.location.y += (row - (rows - 1) / 2) * cell_d
        light_up(entry['lights'])
    # Frame the whole grid: distance from its width and the 45 mm lens field of view.
    half_fov = math.atan(18 / 45)
    tallest = max(e['size'][2] for e in entries)
    distance = max(cols * cell_w, rows * cell_d * 1.8, tallest * 2.2) / (2 * math.tan(half_fov)) * 0.85
    preview(os.path.join(PREVIEWS, category, f'_{name}.png'), size=(1600, 900), lens=45,
            target=(0, 0, view.get('target_z', 2)), distance=distance, height=distance * 0.55, angle=-20)


def args():
    """Arguments after `--` on the Blender command line: asset ids to rebuild."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def run(category, assets, group_name, group_spacing=3.0, group_view=None):
    only = args()
    entries = []
    for asset in assets:
        if only and asset.id not in only:
            continue
        reset()
        asset.build()
        entries.append(export(asset, category))
        light_up(asset.lights)
        preview(os.path.join(PREVIEWS, category, f'{asset.id}.png'), **asset.view)
    write_manifest(entries)
    if not only and group_view:
        preview_group(category, group_name, entries, group_spacing, group_view)
