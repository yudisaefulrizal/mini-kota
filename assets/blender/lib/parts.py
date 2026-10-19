"""Shared palette and street parts, so every category uses the same colours and poles."""
import common as c

# One palette for the whole city (linear RGB). Change a colour here to restyle every asset.
PALETTE = {
    'pole': ((0.22, 0.29, 0.26), dict(roughness=0.5, metallic=0.3)),
    'concrete': ((0.62, 0.62, 0.58), dict(roughness=0.9)),
    'housing': ((0.03, 0.04, 0.035), dict(roughness=0.45)),
    'screen': ((0.015, 0.015, 0.015), dict(roughness=0.3)),
    'white': ((0.88, 0.89, 0.86), dict(roughness=0.4)),
    'grey': ((0.55, 0.6, 0.57), dict(roughness=0.5, metallic=0.2)),
    'dark': ((0.04, 0.05, 0.045), dict(roughness=0.4)),
    'glass': ((0.05, 0.09, 0.12), dict(roughness=0.08, metallic=0.4)),
    'tyre': ((0.02, 0.02, 0.02), dict(roughness=0.8)),
    'chrome': ((0.6, 0.62, 0.62), dict(roughness=0.25, metallic=0.8)),
    'wall': ((0.88, 0.86, 0.8), dict(roughness=0.85)),
    'wall_warm': ((0.86, 0.74, 0.58), dict(roughness=0.85)),
    'roof_tile': ((0.5, 0.2, 0.12), dict(roughness=0.8)),
    'roof_metal': ((0.42, 0.47, 0.5), dict(roughness=0.5, metallic=0.4)),
    'window': ((0.18, 0.3, 0.34), dict(roughness=0.15, metallic=0.3)),
    'wood': ((0.32, 0.2, 0.11), dict(roughness=0.7)),
    'leaf': ((0.16, 0.36, 0.14), dict(roughness=0.8)),
    'leaf_light': ((0.3, 0.48, 0.18), dict(roughness=0.8)),
    'bark': ((0.25, 0.17, 0.1), dict(roughness=0.9)),
    'green_bin': ((0.13, 0.36, 0.2), dict(roughness=0.6)),
    'led': ((0.1, 0.6, 0.25), dict(roughness=0.3, emission=((0.2, 1, 0.45), 2.5))),
}


def mat(key):
    color, options = PALETTE[key]
    return c.material(key, color, **options)


def paint(name, color):
    """A named, recolourable material (the app may tint it per instance)."""
    return c.material(name, color, roughness=0.35, metallic=0.25)


def pole(height, radius=0.075, footing=0.28):
    """Steel pole on a round concrete footing; origin at ground level."""
    return [
        c.cylinder('footing', footing, 0.15, (0, 0, 0.075), mat('concrete'), vertices=12),
        c.cylinder('shaft', radius, height - 0.15, (0, 0, 0.15 + (height - 0.15) / 2), mat('pole'), vertices=12),
        c.cylinder('cap', radius * 1.2, 0.06, (0, 0, height + 0.03), mat('pole'), vertices=12),
    ]


def bracket(x, z, length=0.2):
    """Short arm from the pole to equipment in front of it (towards -Y)."""
    return c.box('bracket', (0.08, length, 0.08), (x, -length / 2, z), mat('pole'))
