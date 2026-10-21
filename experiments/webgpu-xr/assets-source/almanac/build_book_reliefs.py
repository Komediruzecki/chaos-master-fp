# Author two removable earned-page reliefs that follow the existing curved Almanac paper.
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_book import page_height, blender_point


MATERIALS = {}
BRIDGE_TARGET = [(0.12, 0.78), (0.37, 0.56), (0.63, 0.16), (0.88, 0.32)]
NOTE_NAMES = {'glasswake': ['C', 'E', 'G'], 'tideweave': ['D', 'F', 'B', 'A']}
ANCHORS = {}


def material(name, color, metal, roughness, specular=1, emissive=(0, 0, 0)):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = specular / 2
    bsdf.inputs['Emission Color'].default_value = (*emissive, 1)
    bsdf.inputs['Emission Strength'].default_value = 1
    MATERIALS[name] = mat


def empty(name, parent=None, point=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = blender_point(point)
    obj.empty_display_size = 0.025
    return obj


def mesh(name, points, faces, parent, materials, slots=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata([blender_point(point) for point in points], [], faces)
    for mat in materials:
        data.materials.append(MATERIALS[mat])
    for index, polygon in enumerate(data.polygons):
        polygon.material_index = slots[index] if slots else 0
        polygon.use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.delete(bm, geom=[vertex for vertex in bm.verts if not vertex.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def surface(x, z, height):
    return (x, page_height(x, z) + height, z)


def plaque(parent, center):
    """A gridded, paper-following plate with a distinct bevel instead of a flat slab."""
    nx, nz = 10, 2
    points = []
    for inset, height in [(0, 0.009), (0, 0.019), (0.006, 0.025)]:
        for ix in range(nx + 1):
            x = center - 0.46 + inset + (0.92 - 2 * inset) * ix / nx
            for iz in range(nz + 1):
                z = 0.49 + inset + (0.26 - 2 * inset) * iz / nz
                # Two tiny clipped corners make the rim read as a made object.
                if ix in (0, nx) and iz in (0, nz):
                    z += 0.009 if iz == 0 else -0.009
                points.append(surface(x, z, height))
    layer_size = (nx + 1) * (nz + 1)
    faces, slots = [], []
    for layer in (0, 2):
        for ix in range(nx):
            for iz in range(nz):
                at = layer * layer_size + ix * (nz + 1) + iz
                faces.append((at, at + 1, at + nz + 2, at + nz + 1))
                slots.append(0)
    perimeter = list(range(nz + 1))
    perimeter += [ix * (nz + 1) + nz for ix in range(1, nx + 1)]
    perimeter += [nx * (nz + 1) + iz for iz in range(nz - 1, -1, -1)]
    perimeter += [ix * (nz + 1) for ix in range(nx - 1, 0, -1)]
    for layer in (0, 1):
        for index, a in enumerate(perimeter):
            b = perimeter[(index + 1) % len(perimeter)]
            faces.append((layer * layer_size + a, layer * layer_size + b,
                          (layer + 1) * layer_size + b, (layer + 1) * layer_size + a))
            slots.append(1 if layer == 1 else 0)
    obj = mesh('Curved engraved plate', points, faces, parent,
               ['Relief | night enamel', 'Relief | satin silver'], slots)
    # Analytic surface normals keep the paper-following enamel continuous across
    # its coarse bands, while each perimeter bevel retains a deliberate facet.
    normals = [None] * len(obj.data.loops)
    for polygon in obj.data.polygons:
        top = all(abs(obj.data.vertices[index].co.z -
                      page_height(obj.data.vertices[index].co.x,
                                  -obj.data.vertices[index].co.y) - 0.025) < 1e-6
                  for index in polygon.vertices)
        bottom = all(abs(obj.data.vertices[index].co.z -
                         page_height(obj.data.vertices[index].co.x,
                                     -obj.data.vertices[index].co.y) - 0.009) < 1e-6
                     for index in polygon.vertices)
        polygon.use_smooth = top or bottom
        for index in polygon.loop_indices:
            normal = polygon.normal.copy()
            if top or bottom:
                point = obj.data.vertices[obj.data.loops[index].vertex_index].co
                x, z, step = point.x, -point.y, 0.0001
                dx = (page_height(x + step, z) - page_height(x - step, z)) / (2 * step)
                dz = (page_height(x, z + step) - page_height(x, z - step)) / (2 * step)
                normal = Vector((-dx, dz, 1)).normalized() * (1 if top else -1)
            normals[index] = normal
    obj.data.normals_split_custom_set(normals)
    return obj


def gem(parent, name, x, z, star=False):
    """Three shoulders and an eight-facet crown retain a legible light-catching profile."""
    points = []
    radius = 0.063 if star else 0.032
    for scale, height in [(0.92, 0.026), (1, 0.034), (0.63, 0.059)]:
        for index in range(8):
            angle = index * math.tau / 8
            reach = radius * scale * (0.36 if star and index % 2 else 1)
            points.append(surface(x + math.cos(angle) * reach,
                                  z + math.sin(angle) * reach, height))
    points.append(surface(x, z, 0.068))
    faces = [tuple(reversed(range(8)))]
    for layer in (0, 1):
        for index in range(8):
            next_index = (index + 1) % 8
            faces.append((layer * 8 + index, layer * 8 + next_index,
                          (layer + 1) * 8 + next_index, (layer + 1) * 8 + index))
    for index in range(8):
        faces.append((16 + index, 16 + (index + 1) % 8, 24))
    return mesh(name, points, faces, parent,
                ['Relief | burnished gold' if star else 'Relief | verdigris glass'])


def bezel(parent, name, x, z):
    points = []
    # Four loops create a closed thin ring with a bevel on both visible edges.
    for radius, height in [(0.075, 0.026), (0.075, 0.032),
                           (0.068, 0.036), (0.068, 0.026)]:
        for index in range(12):
            angle = index * math.tau / 12
            points.append(surface(x + math.cos(angle) * radius,
                                  z + math.sin(angle) * radius, height))
    faces = []
    for layer in range(4):
        for index in range(12):
            next_index = (index + 1) % 12
            faces.append((layer * 12 + index, layer * 12 + next_index,
                          ((layer + 1) % 4) * 12 + next_index,
                          ((layer + 1) % 4) * 12 + index))
    return mesh(name, points, faces, parent, ['Relief | satin silver'])


def tube(parent, name, coords, radius=0.004, height=0.031, sides=4):
    points = []
    for index, (x, z) in enumerate(coords):
        before = Vector(coords[max(0, index - 1)])
        after = Vector(coords[min(len(coords) - 1, index + 1)])
        tangent = (after - before).normalized()
        normal = (-tangent.y, tangent.x)
        for side in range(sides):
            angle = side * math.tau / sides
            px = x + normal[0] * radius * math.cos(angle)
            pz = z + normal[1] * radius * math.cos(angle)
            points.append(surface(px, pz, height + radius * math.sin(angle)))
    faces = [tuple(reversed(range(sides)))]
    for index in range(len(coords) - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            faces.append((index * sides + side, index * sides + next_side,
                          (index + 1) * sides + next_side, (index + 1) * sides + side))
    faces.append(tuple((len(coords) - 1) * sides + side for side in range(sides)))
    return mesh(name, points, faces, parent, ['Relief | satin silver'])


def engraving(parent, center):
    objects = []
    # A paired incision rule frames the achievement without introducing tiny text.
    for edge in (-1, 1):
        x = center + edge * 0.41
        objects.append(tube(parent, f'Engraved end rule {edge:+d}',
                            [(x, 0.565), (x, 0.675)], 0.0025))
    return objects


def relief(world):
    parent = empty(f'AlmanacEarned.{world}')
    parent['coordinate_contract'] = 'Book-local +Y up; use exactly the same root transform as AlmanacBook'
    parent['award_activity'] = 'glasswake-seals@1' if world == 'glasswake' else 'tideweave-trace@1'
    center = -0.69 if world == 'glasswake' else 0.69
    objects = [parent, plaque(parent, center), *engraving(parent, center)]
    coords = [(-0.99, 0.62), (-0.69, 0.62), (-0.39, 0.62)] if world == 'glasswake' else [
        (0.23 + u * 0.92, 0.49 + v * 0.26) for u, v in BRIDGE_TARGET]
    if world == 'tideweave':
        line = []
        for start, end in zip(coords, coords[1:]):
            line += [(start[0] + (end[0] - start[0]) * step / 4,
                      start[1] + (end[1] - start[1]) * step / 4) for step in range(4)]
        objects.append(tube(parent, 'Raised D-F-B-A melody ribbon', line + [coords[-1]],
                            0.007, 0.036, 6))
    ANCHORS[world] = {}
    for note, (x, z) in zip(NOTE_NAMES[world], coords):
        objects.append(gem(parent, f'Earned {note} | faceted ' + ('star' if world == 'glasswake' else 'note'),
                           x, z, world == 'glasswake'))
        if world == 'glasswake':
            objects.append(bezel(parent, f'Earned {note} | bevelled setting', x, z))
        point = surface(x, z, 0.068)
        ANCHORS[world][note] = list(point)
        objects.append(empty(f'EarnedNote.{note}', parent, point))
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
    return {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bytes': path.stat().st_size,
            'triangles': sum(len(obj.data.polygons) for obj in objects if obj.type == 'MESH'),
            'sourceMeshObjects': sum(obj.type == 'MESH' for obj in objects)}


def aim(obj, point):
    obj.rotation_euler = (Vector(blender_point(point)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_x, scene.render.resolution_y = 1000, 600
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.08, 0.08, 0.085, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    scene.view_settings.view_transform = 'AgX'
    for name, point, power, size in [('Large softbox', (-1, 3, 2), 220, 3),
                                     ('Edge strip', (2, 1.2, -1), 130, 2)]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.size = power, size
        obj = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(obj)
        obj.location = blender_point(point)
        aim(obj, (0, 0.2, 0.62))
    camera = bpy.data.objects.new('Relief inspection', bpy.data.cameras.new('Relief inspection'))
    bpy.context.collection.objects.link(camera)
    camera.location = blender_point((0.25, 2.35, 2.6))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 2.65
    aim(camera, (0, 0.2, 0.6))
    scene.camera = camera


def topology(objects):
    records = []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        record = {'name': obj.name, 'triangles': len(bm.faces),
                  'nonManifoldEdges': sum(not edge.is_manifold for edge in bm.edges),
                  'degenerateFaces': sum(face.calc_area() < 1e-12 for face in bm.faces),
                  'volume': bm.calc_volume(signed=True)}
        bm.free()
        assert not record['nonManifoldEdges'] and not record['degenerateFaces'], record
        assert record['volume'] > 0, record
        records.append(record)
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--runtime-dir', required=True, type=Path)
    parser.add_argument('--evidence-dir', required=True, type=Path)
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    for directory in (args.source_dir, args.runtime_dir, args.evidence_dir):
        if not directory.is_absolute():
            parser.error('All output directories must be absolute.')
        directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.preferences.filepaths.save_version = 0
    material('Relief | night enamel', (0.030, 0.029, 0.032), 0, 0.86, 0.35)
    material('Relief | satin silver', (0.90, 0.89, 0.86), 1, 0.36)
    material('Relief | burnished gold', (1, 0.77, 0.34), 1, 0.24)
    material('Relief | verdigris glass', (0.020, 0.20, 0.15), 0, 0.08, 1, (0.004, 0.03, 0.024))
    worlds = {world: relief(world) for world in NOTE_NAMES}
    records = [export(objects, args.runtime_dir / f'{world}-earned.glb')
               for world, objects in worlds.items()]
    assert sum(record['triangles'] for record in records) <= 1500, records
    source_topology = topology([obj for objects in worlds.values() for obj in objects])
    studio()
    source = args.source_dir / 'almanac-page-reliefs.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=True)
    manifest = {
        'name': 'Earned Almanac page reliefs', 'assetVersion': 2,
        'blenderVersion': bpy.app.version_string,
        'sourceScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'bookRecipeSha256': hashlib.sha256(Path(__file__).with_name('build_book.py').read_bytes()).hexdigest(),
        'sourceBlendSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'assets': records, 'materials': list(MATERIALS), 'textures': [],
        'palette': 'Night Almanac: gold Glasswake stars, verdigris Tideweave gems and silver path',
        'coordinates': {'up': '+Y', 'origin': 'AlmanacBook origin; no independent transform',
                        'surfaceOffsetRange': [0.009, 0.068],
                        'glasswakeBoundsXZ': [-1.15, -0.23, 0.49, 0.75],
                        'tideweaveBoundsXZ': [0.23, 1.15, 0.49, 0.75]},
        'anchors': ANCHORS, 'notes': NOTE_NAMES, 'tideweaveTraceTarget': BRIDGE_TARGET,
        'tideweaveMapping': {'x': '0.23 + u * 0.92', 'z': '0.49 + v * 0.26'},
        'visibility': 'Draw a world relief only when that world has a saved completion; no partial award',
        'limitations': ['Opaque factor materials; no image textures, refraction or animation',
                        'No collision or interaction geometry',
                        'Desktop authored scale; headset scale and performance untested'],
    }
    (args.runtime_dir / 'earned-reliefs.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.evidence_dir / 'source-topology.json').write_text(json.dumps(source_topology, indent=2) + '\n')
    if not args.no_render:
        bpy.context.scene.render.filepath = str(args.evidence_dir / 'source-reliefs.png')
        bpy.ops.render.render(write_still=True)
        for objects in worlds.values():
            for obj in objects:
                bpy.data.objects.remove(obj, do_unlink=True)
        for world in NOTE_NAMES:
            bpy.ops.import_scene.gltf(filepath=str(args.runtime_dir / f'{world}-earned.glb'))
        bpy.context.scene.render.filepath = str(args.evidence_dir / 'export-reliefs.png')
        bpy.ops.render.render(write_still=True)
        book = Path(__file__).resolve().parents[2] / 'public/models/almanac/almanac-book.glb'
        bpy.ops.import_scene.gltf(filepath=str(book))
        bpy.context.scene.camera.location = blender_point((0.15, 3.3, 3.8))
        bpy.context.scene.camera.data.ortho_scale = 3.3
        aim(bpy.context.scene.camera, (0, 0.2, 0))
        bpy.context.scene.render.filepath = str(args.evidence_dir / 'export-book-context.png')
        bpy.ops.render.render(write_still=True)
    print(json.dumps({'assets': records, 'source': str(source)}, indent=2))


if __name__ == '__main__':
    main()
