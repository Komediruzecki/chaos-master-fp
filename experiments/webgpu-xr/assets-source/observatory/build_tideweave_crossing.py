# Author Tideweave's open mineral reeds, note resonator and earned bridge inlay as closed Blender solids.
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


sys.dont_write_bytecode = True
MATERIALS = {}
GROUPS = {}
FEATURES = []
TRACE_CLEARANCE = {'min': [-1.22, 0.48, -4.8], 'max': [1.22, 1.78, -4.3]}
ANCHORS = {
    'TraceCentre': [0, 1.12, -4.6],
    'BridgeMouth': [0, 0, -3.7],
    'FarLanding': [0, 0, -10],
    'ReedWest': [-1.86, 0, -5.65],
    'ReedEast': [1.86, 0, -5.95],
    'ArrivalCrown': [0, 1.28, -10.7],
}


def bp(point):
    """Model in runtime +Y up, then export through Blender's standard glTF axis conversion."""
    x, y, z = point
    return (x, -z, y)


def aim(obj, point):
    obj.rotation_euler = (Vector(bp(point)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def material(name, rgb, metal, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = roughness
    MATERIALS[name] = mat


def geo(name, mat, vertices, faces, smooth=False):
    """Batch by material so separate authored solids do not become separate runtime draws."""
    verts, polys, shading = GROUPS.setdefault(mat, ([], [], []))
    offset = len(verts)
    vertices = [tuple(point) for point in vertices]
    verts.extend(bp(point) for point in vertices)
    polys.extend(tuple(offset + index for index in face) for face in faces)
    shading.extend([smooth] * len(faces))
    FEATURES.append({'name': name, 'material': mat,
                     'min': [min(point[axis] for point in vertices) for axis in range(3)],
                     'max': [max(point[axis] for point in vertices) for axis in range(3)]})


def tube(name, mat, points, radii, sides=8, ellipse=1):
    """A transported elliptical sweep with closed caps and a deliberately blunt, finite tip."""
    points = [Vector(point) for point in points]
    if isinstance(radii, (int, float)):
        radii = [radii] * len(points)
    vertices = []
    previous = None
    for index, point in enumerate(points):
        before, after = points[max(0, index - 1)], points[min(len(points) - 1, index + 1)]
        tangent = (after - before).normalized()
        normal = previous - tangent * previous.dot(tangent) if previous is not None else Vector((0, 0, 0))
        if normal.length < 0.01:
            reference = Vector((0, 0, 1)) if abs(tangent.y) > 0.9 else Vector((0, 1, 0))
            normal = tangent.cross(reference)
        normal.normalize()
        previous = normal
        bitangent = tangent.cross(normal).normalized()
        for corner in range(sides):
            angle = corner * math.tau / sides
            vertices.append(point + radii[index] * (normal * math.cos(angle) + bitangent * math.sin(angle) * ellipse))
    faces = [tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + index for index in range(sides))]
    for index in range(len(points) - 1):
        for corner in range(sides):
            following = (corner + 1) % sides
            faces.append((index * sides + corner, index * sides + following,
                          (index + 1) * sides + following, (index + 1) * sides + corner))
    geo(name, mat, vertices, faces, True)


def bezier(a, b, c, d, steps=18):
    return [tuple((1 - t) ** 3 * a[axis] + 3 * (1 - t) ** 2 * t * b[axis]
                  + 3 * (1 - t) * t * t * c[axis] + t ** 3 * d[axis]
                  for axis in range(3)) for t in (index / steps for index in range(steps + 1))]


def reed(name, side, z, height, root_x, lean, material_name='Tideweave | mineral'):
    path = bezier((side * root_x, -0.32, z + 0.3),
                  (side * (root_x - 0.18), height * 0.26, z + 0.10),
                  (side * (root_x + lean), height * 0.72, z - 0.16),
                  (side * (root_x + lean * 0.72), height, z - 0.48), 22)
    radii = [0.095 * (1 - index / 22) ** 0.65 + 0.012 for index in range(23)]
    tube(name, material_name, path, radii, 8, 0.62)
    # A raised alloy vein follows the front face without replacing the broad mineral silhouette.
    tube(name + ' | vein', 'Tideweave | aged brass',
         [(x, y, pz + 0.057 * (1 - index / 22) + 0.018) for index, (x, y, pz) in enumerate(path)],
         [0.012 * (1 - index / 22) + 0.005 for index in range(23)], 6)
    for branch in range(2):
        start = Vector(path[9 + branch * 5])
        end = (side * (root_x + lean + 0.43 + branch * 0.13),
               height * (0.66 + branch * 0.29), z - 0.23 - branch * 0.49)
        arm = bezier(start, (start.x + side * 0.36, start.y + 0.12, start.z - 0.08),
                     (end[0] + side * 0.12, end[1] - 0.23, end[2] + 0.18), end, 12)
        tube(name + f' | fork {branch + 1}', 'Tideweave | porcelain', arm,
             [0.041 * (1 - index / 12) + 0.009 for index in range(13)], 8, 0.72)
    return path


def pedestal(name, x, z, radius=0.28, height=0.10):
    # Eight chamfered facets belong to a deliberately low contact plinth, not a floating reed tip.
    rings = [(radius * 0.83, -0.32), (radius, -0.27), (radius, height - 0.035), (radius * 0.84, height)]
    vertices = [(x + r * math.cos(index * math.tau / 8), y,
                 z + r * math.sin(index * math.tau / 8)) for r, y in rings for index in range(8)]
    faces = [tuple(reversed(range(8))), tuple(24 + index for index in range(8))]
    for layer in range(3):
        for index in range(8):
            following = (index + 1) % 8
            faces.append((layer * 8 + index, layer * 8 + following,
                          (layer + 1) * 8 + following, (layer + 1) * 8 + index))
    geo(name, 'Tideweave | mineral', vertices, faces)


def crossing():
    for side in (-1, 1):
        for index, (z, h, x, lean) in enumerate([
            (-5.65, 2.50, 1.86, 0.32), (-7.30, 2.90, 2.05, 0.42),
            (-8.85, 2.44, 2.12, 0.30), (-10.30, 1.88, 1.88, 0.14),
        ]):
            # Stagger the two banks so the composition feels grown rather than mirrored.
            z += -0.30 if side > 0 else 0
            h *= 0.94 if side > 0 else 1
            pedestal(f'Root socket {side:+d}.{index}', side * x, z + 0.3)
            path = reed(f'Mineral reed {side:+d}.{index}', side, z, h, x, lean)
            if index < 3:
                # Two independent tensioned strings, framed outside the active melody plane.
                for strand in range(2):
                    a = Vector(path[7 + strand * 2])
                    b = Vector(path[18 + strand * 2])
                    offset = 0.16 + strand * 0.10
                    tube(f'Tension string {side:+d}.{index}.{strand}', 'Tideweave | patinated bronze',
                         [(a.x + side * offset, a.y, a.z + 0.04),
                          (b.x + side * offset, b.y, b.z + 0.04)], 0.009, 6)
        # Long bank bones visually bind the separate root sockets; the walkable centre remains empty.
        for strand in range(2):
            points = [(side * (1.61 + 0.11 * math.sin(t * math.tau + strand * math.pi)),
                       -0.12 + 0.045 * math.cos(t * math.tau + strand * math.pi),
                       -4.82 - t * 5.75) for t in (index / 44 for index in range(45))]
            tube(f'Bank root {side:+d}.{strand}', 'Tideweave | patinated bronze', points, 0.025, 6)
    # A broad, open fan rises behind the arrival platform. No arch closes over the trace sightline.
    for index in range(7):
        x = (index - 3) * 0.30
        height = 0.78 + 0.70 * (1 - abs(index - 3) / 4)
        path = bezier((x * 0.27, -0.18, -10.75), (x * 0.36, 0.22, -10.84),
                      (x * 1.08, height * 0.82, -11.10), (x, height, -11.24), 14)
        tube(f'Arrival fan | blade {index + 1}', 'Tideweave | porcelain', path,
             [0.047 * math.sin(math.pi * (step / 14) * 0.84 + 0.16) + 0.008 for step in range(15)], 8, 0.56)
        tube(f'Arrival fan | rib {index + 1}', 'Tideweave | aged brass',
             [(px, py, pz + 0.025) for px, py, pz in path], 0.008, 6)
    pedestal('Arrival fan | root socket', 0, -10.75, 0.26, 0.04)


def resonator():
    """A small tuning fork, with the empty centre reserved for the runtime light/response bead."""
    for side in (-1, 1):
        path = bezier((side * 0.008, -0.17, 0), (side * 0.085, -0.09, -0.014),
                      (side * 0.057, 0.065, -0.008), (side * 0.027, 0.17, 0), 16)
        tube(f'Note reed | porcelain tine {side:+d}', 'Tideweave | porcelain', path,
             [0.008 + 0.015 * math.sin(math.pi * index / 16) for index in range(17)], 8, 0.75)
        frame = bezier((0, -0.19, -0.018), (side * 0.105, -0.12, -0.025),
                       (side * 0.095, 0.07, -0.025), (side * 0.045, 0.13, -0.025), 16)
        tube(f'Note reed | open cradle {side:+d}', 'Tideweave | aged brass', frame, 0.008, 6)
    tube('Note reed | central string', 'Tideweave | patinated bronze',
         [(0, -0.12, -0.025), (0, 0.13, -0.025)], 0.0045, 6)


def bridge_weave():
    # Each weave lives only on its earned segment. It does not pre-draw the unearned bridge.
    for side in (-1, 1):
        for strand in range(2):
            points = [(side * (0.61 + 0.055 * math.sin(t * math.tau + strand * math.pi)),
                       0.024 + 0.010 * math.cos(t * math.tau + strand * math.pi),
                       -0.46 + t * 0.92) for t in (index / 22 for index in range(23))]
            tube(f'Earned weave {side:+d}.{strand}', 'Tideweave | aged brass', points, 0.012, 6)
        for index in range(3):
            z = -0.30 + index * 0.30
            path = bezier((side * 0.54, 0.019, z - 0.11), (side * 0.40, 0.021, z - 0.035),
                          (side * 0.43, 0.021, z + 0.035), (side * 0.54, 0.019, z + 0.11), 8)
            tube(f'Earned feather {side:+d}.{index}', 'Tideweave | porcelain', path, 0.011, 6, 0.70)


def make_objects(name, anchors):
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    parent['coordinate_contract'] = 'Runtime +Y up, forward -Z, identity world placement unless stated in manifest'
    objects = [parent]
    for mat, (vertices, faces, smooth) in GROUPS.items():
        mesh = bpy.data.meshes.new(name + ' | ' + mat)
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(MATERIALS[mat])
        for polygon, shading in zip(mesh.polygons, smooth):
            polygon.use_smooth = shading
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name + ' | ' + mat, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        objects.append(obj)
    for key, point in anchors.items():
        obj = bpy.data.objects.new(key, None)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        obj.location = bp(point)
        obj.empty_display_size = 0.08
        objects.append(obj)
    return objects


def export(objects, path):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                             export_yup=True, export_apply=True, export_extras=True,
                             export_animations=False, export_cameras=False, export_lights=False,
                             export_materials='EXPORT', export_normals=True, export_texcoords=False)
    return {'file': path.name, 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'triangles': sum(len(obj.data.polygons) for obj in objects if obj.type == 'MESH'),
            'materialGroups': sum(obj.type == 'MESH' for obj in objects)}


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.035, 0.05, 0.065, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.42
    scene.view_settings.view_transform = 'AgX'
    for name, position, energy, colour, size in [
        ('Warm edge', (-3, 5, -1), 1300, (1, 0.84, 0.65), 5),
        ('Cool reed rim', (4, 5, -10), 1900, (0.48, 0.9, 0.88), 4),
        ('Soft sky', (0, 7, -6), 1400, (0.73, 0.83, 1), 6),
    ]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.color, light.shape, light.size = energy, colour, 'DISK', size
        obj = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(obj)
        obj.location = bp(position)
        aim(obj, (0, 0.8, -7))
    data = bpy.data.cameras.new('Tideweave evidence camera')
    camera = bpy.data.objects.new('Tideweave evidence camera', data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera


def camera_view(eye, target, width, height, vertical_fov=0.9):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = width, height
    camera = scene.camera
    camera.location = bp(eye)
    camera.data.sensor_fit = 'VERTICAL'
    camera.data.sensor_height = 32
    camera.data.lens = 32 / (2 * math.tan(vertical_fov / 2))
    aim(camera, target)


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
    material('Tideweave | mineral', (0.085, 0.18, 0.19), 0.03, 0.67)
    material('Tideweave | porcelain', (0.58, 0.62, 0.56), 0, 0.40)
    material('Tideweave | aged brass', (0.38, 0.25, 0.11), 0.78, 0.44)
    material('Tideweave | patinated bronze', (0.12, 0.31, 0.28), 0.78, 0.47)
    records, all_objects, groups = [], [], {}
    for slug, name, recipe, anchors, maximum in [
        ('tideweave-crossing', 'TideweaveCrossing', crossing, ANCHORS, 18000),
        ('tideweave-resonator', 'TideweaveResonator', resonator, {'ResponseCentre': [0, 0, 0]}, 1500),
        ('tideweave-bridge-weave', 'TideweaveBridgeWeave', bridge_weave, {'Walkplane': [0, 0, 0]}, 3000),
    ]:
        GROUPS.clear()
        FEATURES.clear()
        recipe()
        objects = make_objects(name, anchors)
        record = export(objects, args.runtime_dir / (slug + '.glb'))
        assert record['triangles'] <= maximum, record
        record['features'] = [dict(feature) for feature in FEATURES]
        records.append(record)
        all_objects.extend(objects)
        groups[slug] = objects
    # Source records contain all three reusable parts; only the crossing is shown by default.
    for slug in ['tideweave-resonator', 'tideweave-bridge-weave']:
        for obj in groups[slug]:
            obj.hide_render = True
            obj.hide_set(True)
    studio()
    camera_view((0, 0.94, -1.57), (0, 0.6, -4.6), 1440, 950)
    source = args.source_dir / 'tideweave-crossing.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    manifest = {
        'name': 'Tideweave reed crossing, note resonator and earned bridge weave', 'assetVersion': 1,
        'blenderVersion': bpy.app.version_string,
        'authoring': 'Authored closed Blender solids; no provider mesh, image texture or paid generation',
        'sourceScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'sourceBlendSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'assets': records, 'materials': list(MATERIALS), 'textures': [], 'anchors': ANCHORS,
        'coordinates': {'up': '+Y', 'forward': '-Z', 'worldPlacement': [0, 0, 0]},
        'traceClearance': TRACE_CLEARANCE,
        'resonator': {'origin': 'centre', 'axis': '+Y', 'worldScale': 1,
                      'placement': 'Runtime places one reused mesh at each note anchor'},
        'bridgeWeave': {'origin': 'bridge segment centre', 'worldScale': 1,
                        'placement': 'Runtime draws only with the corresponding earned bridge module'},
        'limitations': ['Opaque factors only; the existing runtime adds shared mineral/metal surface detail',
                        'Render meshes, no physical colliders, navigation or rigid body interaction',
                        'Studio lights are evidence only; runtime and physical headset appearance are separate gates'],
    }
    (args.runtime_dir / 'tideweave-crossing.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if not args.no_render:
        render(args.evidence_dir / 'source-trace-factor-1440x950.png')
        for obj in all_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(args.runtime_dir / 'tideweave-crossing.glb'))
        render(args.evidence_dir / 'export-trace-factor-1440x950.png')
        clay = bpy.data.materials.new('Evidence only | neutral clay')
        clay.use_nodes = True
        clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.28, 0.28, 0.28, 1)
        clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
        bpy.context.view_layer.material_override = clay
        render(args.evidence_dir / 'export-trace-clay-1440x950.png')
        camera_view((6, 6, -0.7), (0, 0.6, -7.3), 1440, 1050, 0.8)
        render(args.evidence_dir / 'export-inspection-clay.png')
        bpy.context.view_layer.material_override = None
        render(args.evidence_dir / 'export-inspection-factor.png')
    print(json.dumps({key: value for key, value in manifest.items() if key != 'assets'}, indent=2))
    print(json.dumps([{key: value for key, value in record.items() if key != 'features'} for record in records], indent=2))


if __name__ == '__main__':
    main()
