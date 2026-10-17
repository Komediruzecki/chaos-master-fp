# Author the modular observatory terrace in Blender, then inspect fresh GLB imports.
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


TAU = math.tau
MATERIALS = {}
GROUPS = {}


def bp(point):
    """Design in runtime Y-up coordinates; glTF exporter converts Blender Z-up."""
    x, y, z = point
    return (x, -z, y)


def material(name, rgb, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if metal < 0.05:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    MATERIALS[name] = mat


def geo(mat, vertices, faces, smooth=False):
    verts, polys, shading = GROUPS.setdefault(mat, ([], [], []))
    offset = len(verts)
    verts.extend(bp(v) for v in vertices)
    polys.extend(tuple(offset + i for i in f) for f in faces)
    shading.extend([smooth] * len(faces))


def loft(mat, loops, smooth=False):
    n = len(loops[0])
    verts = [point for loop in loops for point in loop]
    faces = [tuple(reversed(range(n))), tuple((len(loops) - 1) * n + i for i in range(n))]
    for layer in range(len(loops) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append((layer * n + i, layer * n + j, (layer + 1) * n + j, (layer + 1) * n + i))
    geo(mat, verts, faces, smooth)


def circle(radius, y, count=64, centre=(0, 0), phase=0):
    return [(centre[0] + radius * math.sin(TAU * i / count + phase), y,
             centre[1] + radius * math.cos(TAU * i / count + phase)) for i in range(count)]


def disc(mat, radius, top, bottom, count=64, centre=(0, 0), bevel=0.035):
    loft(mat, [circle(radius - bevel, bottom, count, centre),
               circle(radius, bottom + bevel, count, centre),
               circle(radius, top - bevel, count, centre),
               circle(radius - bevel, top, count, centre)])


def tube(mat, points, radius, sides=6, closed=False):
    points = [Vector(p) for p in points]
    vertices = []
    previous_normal = None
    for i, point in enumerate(points):
        before = points[(i - 1) % len(points)] if closed or i else point
        after = points[(i + 1) % len(points)] if closed or i < len(points) - 1 else point
        tangent = (after - before).normalized()
        # Transport the frame so a nearly vertical rib cannot flip at its apex.
        normal = previous_normal - tangent * previous_normal.dot(tangent) if previous_normal is not None else Vector((0, 0, 0))
        if normal.length < 0.01:
            reference = Vector((0, 0, 1)) if abs(tangent.y) > 0.9 else Vector((0, 1, 0))
            normal = tangent.cross(reference)
        normal.normalize()
        previous_normal = normal
        bitangent = tangent.cross(normal).normalized()
        for j in range(sides):
            a = TAU * j / sides
            vertices.append(point + radius * (math.cos(a) * normal + math.sin(a) * bitangent))
    faces = []
    for i in range(len(points) if closed else len(points) - 1):
        ni = (i + 1) % len(points)
        for j in range(sides):
            nj = (j + 1) % sides
            faces.append((i * sides + j, i * sides + nj, ni * sides + nj, ni * sides + j))
    if not closed:
        faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + j for j in range(sides))])
    geo(mat, vertices, faces, True)


def ring(mat, radius, y, thickness, centre=(0, 0), count=96):
    tube(mat, circle(radius, y, count, centre), thickness, 6, True)


def rect_loop(width, depth, y, centre=(0, 0), chamfer=0.1):
    chamfer = min(chamfer, width / 3, depth / 3)
    x, z = width / 2, depth / 2
    return [(centre[0] + a, y, centre[1] + b) for a, b in
            [(-x + chamfer, -z), (x - chamfer, -z), (x, -z + chamfer),
             (x, z - chamfer), (x - chamfer, z), (-x + chamfer, z),
             (-x, z - chamfer), (-x, -z + chamfer)]]


def slab(mat, width, depth, top, bottom, centre=(0, 0), bevel=0.03):
    loft(mat, [rect_loop(width - bevel * 2, depth - bevel * 2, bottom, centre),
               rect_loop(width, depth, bottom + bevel, centre),
               rect_loop(width, depth, top - bevel, centre),
               rect_loop(width - bevel * 2, depth - bevel * 2, top, centre)])


def arc(mat, radius, y, a0, a1, thickness, count=40):
    tube(mat, [(radius * math.sin(a0 + (a1 - a0) * i / count), y,
                radius * math.cos(a0 + (a1 - a0) * i / count)) for i in range(count + 1)], thickness)


def curb():
    profile = [(4.055, 0), (4.19, 0), (4.21, 0.02), (4.21, 0.09),
               (4.19, 0.11), (4.075, 0.11), (4.055, 0.09)]
    loops = []
    for i in range(97):
        a = -2.64 + 5.28 * i / 96
        loops.append([(r * math.sin(a), y, r * math.cos(a)) for r, y in profile])
    loft('Basalt | blue', loops)
    arc('Brass | bright', 4.08, 0.112, -2.64, 2.64, 0.013, 96)


def bay():
    # The forward edge is clipped so the bridge mouth has an exact contact datum.
    points = [(4.2 * math.sin(TAU * i / 96), 4.2 * math.cos(TAU * i / 96)) for i in range(96)]
    outline = [p for p in points if p[1] > -3.7]
    edge_x = math.sqrt(4.2 ** 2 - 3.7 ** 2)
    insert = next(i for i, p in enumerate(outline) if p[0] < 0)
    outline[insert:insert] = [(edge_x, -3.7), (-edge_x, -3.7)]
    loft('Basalt | blue', [[(x * scale, y, z if z == -3.7 else z * scale) for x, z in outline]
                           for scale, y in [(0.985, -0.34), (1, -0.29), (1, -0.05), (0.988, 0)]])
    # Deliberate stone sectors and open seams remain readable without texture maps.
    for i in range(14):
        a0, a1 = -2.55 + i * 5.10 / 14 + 0.012, -2.55 + (i + 1) * 5.10 / 14 - 0.012
        polygon = [(r * math.sin(a0 + (a1 - a0) * k / 6), y, r * math.cos(a0 + (a1 - a0) * k / 6))
                   for r, y, steps in [(3.91, 0.012, range(7)), (1.57, 0.012, range(6, -1, -1))]
                   for k in steps]
        geo('Slate | inset' if i % 3 else 'Basalt | blue', polygon, [tuple(range(len(polygon)))])
    ring('Brass | muted', 1.51, 0.016, 0.016)
    arc('Brass | muted', 3.96, 0.025, -2.63, 2.63, 0.022, 100)
    arc('Brass | bright', 4.15, -0.105, -2.65, 2.65, 0.014, 100)
    curb()
    for x in (-0.82, 0.82):
        tube('Brass | bright', [(x, 0.016, -1.65), (x, 0.016, -3.7)], 0.016)
    # Two long rails open the sightline toward the worlds and bridge.
    for side in (-1, 1):
        rail = []
        for i in range(41):
            t = i / 40
            a = side * (0.47 + 2.05 * t)
            rail.append((4.01 * math.sin(a), 0.58 + 0.26 * math.sin(math.pi * t), 4.01 * math.cos(a)))
        tube('Brass | muted', rail, 0.065, 8)
        tube('Brass | bright', [(x, y + 0.045, z) for x, y, z in rail], 0.018, 6)
        for i in range(7):
            t = i / 6
            a = side * (0.49 + 2.0 * t)
            x, z = 4.01 * math.sin(a), 4.01 * math.cos(a)
            h = 0.58 + 0.26 * math.sin(math.pi * t)
            sweep = []
            for j in range(13):
                u = j / 12
                bend = side * 0.11 * math.sin(math.pi * u)
                sweep.append((x + bend * math.cos(a), 0.035 + (h - 0.035) * u, z - bend * math.sin(a)))
            tube('Basalt | blue', sweep, 0.067, 6)
            tube('Brass | muted', [(px + 0.035 * math.sin(a), py, pz + 0.035 * math.cos(a)) for px, py, pz in sweep], 0.016, 5)
        # Each side has one broad swept structural rib, readable as architecture.
        rib = []
        for j in range(33):
            u = j / 32
            a = side * (1.0 + 1.08 * u)
            rib.append((3.96 * math.sin(a), 0.1 + 1.28 * math.sin(math.pi * u), 3.96 * math.cos(a)))
        tube('Brass | muted', rib, 0.052, 8)
    # Seven broad survey markers, more like instruments than tiny ornaments.
    for i in range(7):
        a = -2.36 + 4.72 * i / 6
        centre = (3.50 * math.sin(a), 3.50 * math.cos(a))
        disc('Basalt | blue', 0.16, 0.16, 0.008, 12, centre, 0.025)
        disc('Brass | bright', 0.13, 0.185, 0.15, 12, centre, 0.008)
        disc('Enamel | tide', 0.085, 0.194, 0.179, 12, centre, 0.004)
    # Low lectern; root has a separate mount so book art stays replaceable.
    centre = (0, -0.1)
    slab('Brass | muted', 1.55, 1.08, 0.12, 0.015, centre)
    loft('Basalt | blue', [rect_loop(1.36, 0.91, 0.11, centre, 0.16),
                           rect_loop(1.03, 0.65, 0.48, centre, 0.16),
                           rect_loop(1.75, 1.12, 0.77, centre, 0.16)])
    slab('Brass | muted', 2.0, 1.37, 0.815, 0.74, centre, 0.02)
    slab('Slate | inset', 1.91, 1.28, 0.85, 0.798, centre, 0.012)
    for side in (-1, 1):
        tube('Brass | bright', [(side * 0.65, 0.13, 0.32), (side * 0.48, 0.48, 0.2), (side * 0.82, 0.76, 0.42)], 0.018)


def bridge():
    slab('Basalt | blue', 1.6, 1.0, -0.015, -0.19, bevel=0.025)
    slab('Slate | inset', 1.43, 0.94, 0, -0.04, bevel=0.008)
    for side in (-1, 1):
        slab('Brass | muted', 0.07, 1.0, 0.022, -0.12, (side * 0.765, 0), 0.009)
        tube('Enamel | tide', [(side * 0.57, 0.012, -0.48), (side * 0.48, 0.012, 0), (side * 0.57, 0.012, 0.48)], 0.018)
    # A three-strand score mark joins to adjacent segments without texture seams.
    for x in (-0.105, 0, 0.105):
        tube('Brass | bright', [(x, 0.008, -0.5), (x, 0.008, 0.5)], 0.009, 5)


def landing():
    disc('Basalt | blue', 1.35, 0, -0.28, 64)
    disc('Slate | inset', 1.23, 0.013, -0.015, 64, bevel=0.007)
    ring('Brass | muted', 1.29, 0.012, 0.025)
    ring('Brass | bright', 0.91, 0.023, 0.012, count=64)
    for i in range(7):
        a = TAU * i / 7
        tube('Enamel | tide', [(r * math.sin(a), 0.023, r * math.cos(a)) for r in (1.03, 1.17)], 0.022)
    disc('Brass | muted', 0.40, 0.09, 0.01, 32, bevel=0.015)
    disc('Slate | inset', 0.35, 0.10, 0.08, 32, bevel=0.006)


def make_objects(name, anchors):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root['coordinate_contract'] = '+Y up, forward -Z, support top Y=0'
    objects = [root]
    for mat, (vertices, faces, smooth) in GROUPS.items():
        mesh = bpy.data.meshes.new(name + ' | ' + mat)
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(MATERIALS[mat])
        for poly, flag in zip(mesh.polygons, smooth):
            poly.use_smooth = flag
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name + ' | ' + mat, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        objects.append(obj)
    for name, point in anchors.items():
        anchor = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(anchor)
        anchor.parent = root
        anchor.location = bp(point)
        anchor.empty_display_size = 0.12
        objects.append(anchor)
    return root, objects


def aim(obj, point):
    obj.rotation_euler = (Vector(bp(point)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.055, 0.08, 0.13, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name, position, energy, colour, size in [
        ('Warm key', (-4, 8, 4), 1800, (1, 0.78, 0.52), 7),
        ('Cool rim', (4, 5, -6), 2200, (0.35, 0.64, 1), 5),
        ('Front fill', (0, 5, 7), 1100, (0.72, 0.87, 1), 6),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = bp(position)
        aim(obj, (0, 0, -2))
    data = bpy.data.cameras.new('Observatory evidence camera')
    obj = bpy.data.objects.new('Observatory evidence camera', data)
    bpy.context.collection.objects.link(obj)
    obj.location = bp((8.7, 8.4, 10.8))
    data.type, data.lens = 'PERSP', 42
    aim(obj, (0, 0, -2.4))
    scene.camera = obj


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
        directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.preferences.filepaths.save_version = 0
    material('Basalt | blue', (0.039, 0.064, 0.083), 0.03, 0.77)
    material('Slate | inset', (0.052, 0.112, 0.121), 0.03, 0.64)
    material('Brass | muted', (0.24, 0.145, 0.063), 0.78, 0.46)
    material('Brass | bright', (0.55, 0.33, 0.115), 0.86, 0.31)
    material('Enamel | tide', (0.17, 0.47, 0.44), 0.03, 0.39)
    assets = [
        ('observation-bay', 'ObservationBay', bay,
         {'BookMount': [0, 0.85, -0.1], 'BridgeMouth': [0, 0, -3.7],
          'WorldLeft': [-2.8, 3, -5.8], 'WorldRight': [2.8, 3, -5.8]}),
        ('bridge-segment', 'BridgeSegment', bridge,
         {'Entry': [0, 0, 0.5], 'Exit': [0, 0, -0.5]}),
        ('far-landing', 'FarLanding', landing, {'RelicMount': [0, 0.1, 0]}),
    ]
    records = []
    roots = []
    all_objects = []
    for slug, name, build, anchors in assets:
        GROUPS.clear()
        build()
        root, objects = make_objects(name, anchors)
        roots.append(root)
        all_objects.extend(objects)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        path = args.runtime_dir / (slug + '.glb')
        bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                                  export_yup=True, export_apply=True, export_extras=True,
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  export_materials='EXPORT', export_normals=True, export_texcoords=False)
        records.append({'file': path.name, 'root': name, 'bytes': path.stat().st_size,
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'triangles': sum(len(o.data.polygons) for o in objects if o.type == 'MESH'),
                        'materialGroups': sum(o.type == 'MESH' for o in objects), 'anchors': anchors})
    # Studio arrangement is only evidence; every module exports at its own origin.
    roots[1].location = bp((0, 0, -4.2))
    bridge_objects = [o for o in all_objects if o.parent == roots[1]]
    for i in range(1, 5):
        root = bpy.data.objects.new('Bridge display instance ' + str(i), None)
        bpy.context.collection.objects.link(root)
        root.location = bp((0, 0, -4.2 - i))
        all_objects.append(root)
        for original in bridge_objects:
            duplicate = original.copy()
            duplicate.parent = root
            bpy.context.collection.objects.link(duplicate)
            all_objects.append(duplicate)
    roots[2].location = bp((0, 0, -10))
    studio()
    source = args.source_dir / 'observatory-kit.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    manifest = {'name': 'Irchiinnuss observatory terrace kit', 'assetVersion': 1,
                'blenderVersion': bpy.app.version_string, 'authoring': 'Authored Blender geometry; no provider mesh or textures',
                'sourceScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'sourceBlendSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'coordinates': {'up': '+Y', 'forward': '-Z', 'floorTop': 0, 'units': 'metre-oriented study units'},
                'materials': list(MATERIALS), 'textures': [], 'assets': records,
                'placement': {'bay': [0, 0, 0], 'bridgeSegmentCentres': [[0, 0, -4.2 - i] for i in range(5)],
                              'farLanding': [0, 0, -10], 'bridgeFootprint': [1.6, 1.0],
                              'bridgeSlabThickness': 0.19, 'bridgeWalkplaneY': 0,
                              'landingRadius': 1.35, 'camera': [0, 2.2, 5.8], 'cameraTarget': [0, 1.4, -3.5]},
                'limitations': ['Opaque factor materials only, no surface texture bakes',
                                'Render meshes, no collision or traversal implementation',
                                'GLB carries no animation; runtime places bridge and worlds',
                                'Studio lighting does not certify browser or headset appearance']}
    (args.runtime_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if not args.no_render:
        render(args.evidence_dir / 'source-kit.png')
        for obj in all_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        imports = []
        for record in records:
            positions = [[0, 0, 0]] if record['root'] == 'ObservationBay' else (
                manifest['placement']['bridgeSegmentCentres'] if record['root'] == 'BridgeSegment' else [[0, 0, -10]])
            for position in positions:
                bpy.ops.import_scene.gltf(filepath=str(args.runtime_dir / record['file']))
                imported = list(bpy.context.selected_objects)
                imports.extend(imported)
                for obj in imported:
                    if obj.parent is None:
                        obj.location += Vector(bp(position))
        render(args.evidence_dir / 'export-kit.png')
        clay = bpy.data.materials.new('Neutral clay audit')
        clay.use_nodes = True
        clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.28, 0.28, 0.28, 1)
        clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
        bpy.context.view_layer.material_override = clay
        render(args.evidence_dir / 'export-clay.png')
        bpy.context.view_layer.material_override = None
        camera = bpy.context.scene.camera
        camera.location = bp((0, 2.2, 5.8))
        camera.data.lens = 24
        aim(camera, (0, 1.4, -3.5))
        render(args.evidence_dir / 'export-runtime-camera.png')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
