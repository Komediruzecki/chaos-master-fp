# Author the open Glasswake caldera as closed bevelled solids, then inspect fresh GLB imports.
import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_observatory import bp, aim


LAYOUT_SEED = 73129
MATERIALS = {}
ANCHORS = {
    'SealCenter': [0, 1.45, 0],
    'ToneStar.C': [0, 2.36, 0.15],
    'ToneStar.E': [-0.7880831174438392, 0.995, 0.15],
    'ToneStar.G': [0.7880831174438392, 0.995, 0.15],
    'ListenerMark': [0, 0, 1.9],
}
VIEWPORTS = [(1440, 950), (820, 900), (390, 844), (844, 390)]


def material(name, rgb, roughness):
    """Keep the normal dielectric specular factor; the older kit helper lowers it."""
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = roughness
    MATERIALS[name] = mat
    return mat


def root(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    return obj


def mesh_object(name, vertices, faces, parent, slots, face_slots=None, smooth=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([bp(v) for v in vertices], [], faces)
    for mat in slots:
        mesh.materials.append(MATERIALS[mat])
    for index, polygon in enumerate(mesh.polygons):
        polygon.material_index = face_slots[index] if face_slots else 0
        polygon.use_smooth = smooth[index] if smooth else False
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def hex_loop(x, z, radius, y, angle=math.pi / 6):
    return [(x + radius * math.cos(angle + i * math.tau / 6), y,
             z + radius * math.sin(angle + i * math.tau / 6)) for i in range(6)]


def column(name, parent, x, z, radius, bottom, top, bevel=0.018,
           bottom_bevel=False, porcelain=False, angle=math.pi / 6, recess=False):
    """Each column is one closed solid; six side facets remain deliberately flat."""
    bevel = min(bevel, radius / 4, (top - bottom) / 4)
    loops = [hex_loop(x, z, radius - (bevel if bottom_bevel else 0), bottom, angle)]
    if bottom_bevel:
        loops.append(hex_loop(x, z, radius, bottom + bevel, angle))
    loops.extend([hex_loop(x, z, radius, top - bevel, angle),
                  hex_loop(x, z, radius - bevel, top, angle)])
    if recess:
        loops.extend([hex_loop(x, z, radius * 0.52, top, angle),
                      hex_loop(x, z, radius * 0.52, top - 0.02, angle)])
    vertices = [point for loop in loops for point in loop]
    faces = [tuple(reversed(range(6)))]
    face_slots = [0]
    smooth = [False]
    for layer in range(len(loops) - 1):
        for i in range(6):
            j = (i + 1) % 6
            faces.append((layer * 6 + i, layer * 6 + j,
                          (layer + 1) * 6 + j, (layer + 1) * 6 + i))
            face_slots.append(1 if layer >= len(loops) - (4 if recess else 2) else 0)
            # Flat broad sides, gently interpolated bevel strips. Caps stay flat.
            smooth.append(layer == len(loops) - (4 if recess else 2))
    faces.append(tuple((len(loops) - 1) * 6 + i for i in range(6)))
    face_slots.append(1)
    smooth.append(False)
    slots = ['Porcelain | bone', 'Porcelain | bone'] if porcelain else [
        'Obsidian | gloss', 'Obsidian | worn']
    return mesh_object(name, vertices, faces, parent, slots, face_slots, smooth)


def tipped_column(name, parent, x, z, radius, bottom, tip, angle):
    loops = [hex_loop(x, z, radius, bottom, angle),
             hex_loop(x, z, radius * 0.94, bottom + 0.025, angle)]
    vertices = [p for loop in loops for p in loop] + [(x, tip, z)]
    faces = [tuple(reversed(range(6)))]
    for i in range(6):
        j = (i + 1) % 6
        faces.extend([(i, j, 6 + j, 6 + i), (6 + i, 6 + j, 12)])
    return mesh_object(name, vertices, faces, parent, ['Obsidian | gloss'])


def stack(name, parent, x, z, height, radius, rng, pointed=False):
    objects = []
    tip_height = 0.22 if pointed else 0
    drums = max(1, min(3, math.ceil(height / 1.1)))
    base = 0.024
    drum_height = (height - tip_height - base - 0.012 * (drums - 1)) / drums
    for index in range(drums):
        dx, dz = rng.uniform(-0.006, 0.006), rng.uniform(-0.006, 0.006)
        angle = math.pi / 6 + rng.uniform(-0.025, 0.025)
        y = base + index * (drum_height + 0.012)
        objects.append(column(f'{name} | drum {index + 1}', parent, x + dx, z + dz,
                              radius * (1 - index * 0.018), y, y + drum_height,
                              0.015, True, angle=angle))
    if pointed:
        objects.append(tipped_column(f'{name} | crown', parent, x + dx, z + dz,
                                     radius * (1 - (drums - 1) * 0.018),
                                     height - tip_height, height, angle))
    return objects


def slab(name, parent, center_z, width=2.1, depth=0.42):
    x, z, b = width / 2, depth / 2, 0.03
    outline = [(-x + b, -z), (x - b, -z), (x, -z + b), (x, z - b),
               (x - b, z), (-x + b, z), (-x, z - b), (-x, -z + b)]
    loops = [[(px * scale, y, center_z + pz * scale) for px, pz in outline]
             for y, scale in [(-0.45, 0.98), (-0.42, 1), (-0.03, 1), (0, 0.98)]]
    vertices = [p for loop in loops for p in loop]
    faces = [tuple(reversed(range(8))), tuple(24 + i for i in range(8))]
    for layer in range(3):
        for i in range(8):
            j = (i + 1) % 8
            faces.append((layer * 8 + i, layer * 8 + j,
                          (layer + 1) * 8 + j, (layer + 1) * 8 + i))
    return mesh_object(name, vertices, faces, parent,
                       ['Obsidian | worn', 'Obsidian | gloss'],
                       [1, 0] + [1] * 24)


def chamber():
    parent = root('GlasswakeChamber')
    parent['coordinate_contract'] = 'Runtime +Y up, origin floor below SealCenter; place at [0,0,-4.6]'
    objects = [parent]
    rng = random.Random(LAYOUT_SEED)
    # A staggered hex lattice creates the broken island and supports both outer stacks.
    for row in range(-7, 7):
        z = row * 0.368
        for col in range(-8, 9):
            x = col * 0.425 + (row % 2) * 0.2125
            radial = math.hypot(x, z)
            edge = 2.3 + 0.13 * math.sin(math.atan2(z, x) * 5 + 0.7)
            body = radial <= edge
            west = ((x + 3.02) / 0.68) ** 2 + ((z + 1.15) / 1.42) ** 2 <= 1
            east = ((x - 2.85) / 0.76) ** 2 + ((z + 1.45) / 1.18) ** 2 <= 1
            wings = abs(x) > 2.6 and abs(x) < 3.4 and 0.85 < z < 1.9
            if not (body or west or east or wings):
                continue
            if abs(x) < 1.19 and 0.65 < z < 2.25:
                continue
            top = rng.uniform(-0.02, 0.015)
            if radial > 1.75 and abs(x) > 1.55:
                top += rng.uniform(0, 0.09)
            bottom = -0.42 - max(0, radial - 1.3) * rng.uniform(0.12, 0.3)
            objects.append(column(f'Causeway | {row:+03d}.{col:+03d}', parent,
                                  x, z, 0.235, bottom, top, 0.018))
    for index, z in enumerate([0.89, 1.322, 1.754]):
        objects.append(slab(f'Listener slab | {index + 1}', parent, z))
    west = [
        (-3.25, -2.02, 3.20, 0.25), (-2.75, -2.23, 2.70, 0.245),
        (-3.25, -1.48, 2.95, 0.25), (-2.75, -1.69, 2.05, 0.24),
        (-3.25, -0.94, 2.40, 0.245), (-2.75, -1.15, 1.35, 0.24),
        (-3.25, -0.40, 1.70, 0.24), (-2.75, -0.61, 1.00, 0.24),
        (-2.75, -0.07, 0.70, 0.24),
    ]
    east = [
        (3.13, -2.13, 3.00, 0.25), (2.63, -2.34, 2.75, 0.245),
        (3.13, -1.59, 2.45, 0.25), (2.63, -1.80, 2.15, 0.24),
        (3.13, -1.05, 1.85, 0.245), (2.63, -1.26, 1.45, 0.24),
        (3.13, -0.51, 1.10, 0.24), (2.63, -0.72, 0.90, 0.24),
        (2.34, -2.05, 1.20, 0.22), (1.86, -2.26, 0.44, 0.22),
        (1.86, -1.78, 0.32, 0.22), (1.38, -2.04, 0.20, 0.22),
    ]
    for label, entries in [('West', west), ('East', east)]:
        for index, (x, z, h, r) in enumerate(entries):
            objects.extend(stack(f'{label} stack | {index + 1:02d}', parent,
                                 x, z, h, r, rng, pointed=index in (0, 1)))
    for side in (-1, 1):
        for index, (x, z, h) in enumerate([
            (3.12, 1.16, 1.1), (3.12, 1.65, 0.85), (2.67, 1.4, 0.55),
            (2.67, 1.89, 0.42), (3.12, 2.12, 0.62),
        ]):
            objects.extend(stack(f'Outcrop {side:+d} | {index + 1}', parent,
                                 side * x, z, h, 0.21, rng))
    objects.append(column('Sounding flower | recessed heart', parent, 0, 0,
                          0.21, -0.04, 0.13, 0.02, porcelain=True, recess=True))
    for index in range(6):
        angle = index * math.tau / 6
        objects.append(column(f'Sounding flower | petal {index + 1}', parent,
                              math.cos(angle) * 0.4, math.sin(angle) * 0.4,
                              0.21, -0.055, 0.1, 0.02, porcelain=True))
    for name, position in ANCHORS.items():
        obj = root(name)
        obj.parent = parent
        obj.location = bp(position)
        obj.empty_display_size = 0.08
        objects.append(obj)
    return parent, objects


def tone_star():
    parent = root('GlasswakeToneStar')
    loops = [hex_loop(0, 0, 0.045, -0.02), hex_loop(0, 0, 0.05, -0.015),
             hex_loop(0, 0, 0.05, 0.015), hex_loop(0, 0, 0.045, 0.02)]
    vertices = [(0, -0.085, 0)] + [p for loop in loops for p in loop] + [(0, 0.085, 0)]
    faces = []
    for i in range(6):
        j = (i + 1) % 6
        faces.append((0, j + 1, i + 1))
        for layer in range(3):
            faces.append((1 + layer * 6 + i, 1 + layer * 6 + j,
                          1 + (layer + 1) * 6 + j, 1 + (layer + 1) * 6 + i))
        faces.append((19 + i, 19 + j, 25))
    obj = mesh_object('Frost | double-pointed note', vertices, faces, parent, ['Glass | frost'])
    return parent, [parent, obj]


def export(objects, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_extras=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_materials='EXPORT', export_normals=True, export_texcoords=False,
    )
    return {
        'file': path.name, 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'triangles': sum(len(obj.data.polygons) for obj in objects if obj.type == 'MESH'),
        'sourceMeshObjects': sum(obj.type == 'MESH' for obj in objects),
    }


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.04, 0.05, 0.075, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.38
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name, position, energy, color, size in [
        ('Warm edge', (-4, 5, 3), 1700, (1, 0.81, 0.61), 5),
        ('Cool edge', (5, 4, -3), 2000, (0.52, 0.68, 1), 4),
        ('Soft face', (0, 5, 6), 1000, (0.85, 0.9, 1), 5),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = bp(position)
        aim(obj, (0, 0.8, 0))
    data = bpy.data.lights.new('Core studio bounce', 'POINT')
    data.energy, data.color, data.shadow_soft_size = 65, (1, 0.75, 0.46), 0.52
    obj = bpy.data.objects.new('Core studio bounce', data)
    bpy.context.collection.objects.link(obj)
    obj.location = bp((0, 1.45, 0))
    data = bpy.data.cameras.new('Glasswake evidence camera')
    camera = bpy.data.objects.new('Glasswake evidence camera', data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera


def runtime_camera(width, height):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = width, height
    aspect = width / height
    target_y = 0.25 if aspect < 0.8 else 0.78 if aspect < 1.1 else 0.48 if aspect > 1.9 else 0.92
    fov = 2 * math.atan(math.tan(0.9 / 2) * max(1, 1.12 / aspect, 1.6 if aspect > 1.9 else 1))
    camera = scene.camera
    camera.location = bp((0, target_y + math.sin(0.03) * 4.25, math.cos(0.03) * 4.25))
    camera.data.sensor_fit = 'VERTICAL'
    camera.data.sensor_height = 32
    camera.data.lens = 32 / (2 * math.tan(fov / 2))
    aim(camera, (0, target_y, 0))


def inspection_camera():
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1440, 1050
    scene.camera.location = bp((7.2, 5.1, 8.3))
    scene.camera.data.sensor_fit = 'HORIZONTAL'
    scene.camera.data.lens = 45
    aim(scene.camera, (0, 0.55, -0.1))


def proxies():
    group = root('Evidence only | seal and core proxies')
    objects = [group]
    # These references mark silhouettes, not the shipping glass material or live fractal.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.52,
                                       location=bp((0, 1.45, 0)))
    orb = bpy.context.object
    orb.name = 'Evidence only | core silhouette'
    orb.parent = group
    orb.data.materials.append(MATERIALS['Porcelain | bone'])
    for poly in orb.data.polygons:
        poly.use_smooth = True
    objects.append(orb)
    for index in range(3):
        loops = []
        for cell in range(9):
            u = cell / 8
            angle = math.pi / 2 + index * math.tau / 3 + (u - 0.5) * 1.54
            width = 0.06 + 0.16 * math.sin(math.pi * u)
            loops.append([(math.cos(angle) * (0.91 + side * width),
                           1.45 + math.sin(angle) * (0.91 + side * width), depth)
                          for side, depth in [(-1, 0.10), (1, 0.10), (1, 0.045), (-1, 0.045)]])
        vertices = [p for loop in loops for p in loop]
        faces = [(3, 2, 1, 0), tuple(32 + j for j in range(4))]
        for layer in range(8):
            for i in range(4):
                j = (i + 1) % 4
                faces.append((layer * 4 + i, layer * 4 + j, (layer + 1) * 4 + j, (layer + 1) * 4 + i))
        objects.append(mesh_object(f'Evidence only | petal {index + 1}', vertices, faces,
                                   group, ['Glass | frost']))
    return objects


def render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--runtime-dir', required=True, type=Path)
    parser.add_argument('--evidence-dir', required=True, type=Path)
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for directory in (args.source_dir, args.runtime_dir, args.evidence_dir):
        if not directory.is_absolute():
            parser.error('Output directories must be absolute admitted run paths.')
        directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.preferences.filepaths.save_version = 0
    material('Obsidian | gloss', (0.020, 0.019, 0.023), 0.22)
    material('Obsidian | worn', (0.045, 0.042, 0.046), 0.58)
    material('Porcelain | bone', (0.56, 0.52, 0.44), 0.40)
    material('Glass | frost', (0.80, 0.82, 0.82), 0.15)
    chamber_root, chamber_objects = chamber()
    star_root, star_objects = tone_star()
    chamber_record = export(chamber_objects, args.runtime_dir / 'glasswake-chamber.glb')
    star_record = export(star_objects, args.runtime_dir / 'glasswake-tone-star.glb')
    assert chamber_record['triangles'] <= 12000, chamber_record
    assert star_record['triangles'] <= 64, star_record
    for obj in star_objects:
        obj.hide_render = True
        obj.hide_set(True)
    studio()
    runtime_camera(1440, 950)
    source = args.source_dir / 'glasswake-chamber.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    manifest = {
        'name': 'Glasswake Caldera and tone star', 'assetVersion': 1,
        'blenderVersion': bpy.app.version_string, 'layoutSeed': LAYOUT_SEED,
        'authoring': 'Authored closed Blender solids; no provider geometry or image textures',
        'sourceScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'helperScriptSha256': hashlib.sha256(Path(__file__).with_name('build_observatory.py').read_bytes()).hexdigest(),
        'sourceBlendSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'assets': [chamber_record, star_record], 'materials': list(MATERIALS),
        'textures': [], 'anchors': ANCHORS,
        'coordinates': {'up': '+Y', 'origin': 'floor below seal', 'worldPlacement': [0, 0, -4.6]},
        'protectedShardVolumeWorld': {'min': [-1.45, 0.14, -5.35], 'max': [1.45, 2.85, -4.05]},
        'toneStar': {'height': 0.17, 'radius': 0.05, 'axis': '+Y', 'origin': 'centre'},
        'limitations': ['Opaque factors only; no textures, refraction, collision or traversal',
                        'Stage appears only in the Glasswake encounter',
                        'Studio lighting and proxy solids are evidence, not runtime appearance',
                        'Physical headset reach, scale, comfort and performance remain untested'],
    }
    (args.runtime_dir / 'glasswake-chamber.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if not args.no_render:
        render(args.evidence_dir / 'source-factor-1440x950.png')
        for obj in chamber_objects + star_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(args.runtime_dir / 'glasswake-chamber.glb'))
        imported_chamber = list(bpy.context.selected_objects)
        render(args.evidence_dir / 'export-factor-1440x950.png')
        reference = proxies()
        render(args.evidence_dir / 'export-factor-proxies-1440x950.png')
        clay = material('Evidence only | neutral clay', (0.28, 0.28, 0.28), 0.7)
        bpy.context.view_layer.material_override = clay
        for width, height in VIEWPORTS:
            runtime_camera(width, height)
            render(args.evidence_dir / f'export-clay-proxies-{width}x{height}.png')
        for obj in reference:
            bpy.data.objects.remove(obj, do_unlink=True)
        inspection_camera()
        render(args.evidence_dir / 'export-clay-inspect.png')
        bpy.context.view_layer.material_override = None
        render(args.evidence_dir / 'export-factor-inspect.png')
        for obj in imported_chamber:
            obj.hide_render = True
        bpy.ops.import_scene.gltf(filepath=str(args.runtime_dir / 'glasswake-tone-star.glb'))
        bpy.context.scene.render.resolution_x = 800
        bpy.context.scene.render.resolution_y = 900
        bpy.context.scene.camera.location = bp((0.20, 0.13, 0.28))
        bpy.context.scene.camera.data.lens = 65
        aim(bpy.context.scene.camera, (0, 0, 0))
        render(args.evidence_dir / 'export-factor-tone-star.png')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
