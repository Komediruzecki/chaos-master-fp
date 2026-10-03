# Author the fixed-open celestial Almanac, export its runtime GLB, and render source/export evidence.
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parents[1]
OUTPUT = EXPERIMENT / "public/models/almanac"
EVIDENCE = EXPERIMENT.parents[1] / "webgpu-verify-out/book-asset"
TAU = math.tau
GROUPS = {}
MATERIALS = {}


def blender_point(point):
    """Design in runtime Y-up coordinates; Blender glTF converts Z-up on export."""
    x, y, z = point
    return (x, -z, y)


def material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_backface_culling = True
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if metallic < 0.05:
        bsdf.inputs["Specular IOR Level"].default_value = 0.18
    MATERIALS[name] = mat
    GROUPS[name] = ([], [], [])
    return mat


def geometry(mat, vertices, faces, smooth=True):
    out_verts, out_faces, out_smooth = GROUPS[mat]
    offset = len(out_verts)
    out_verts.extend(blender_point(v) for v in vertices)
    out_faces.extend(tuple(index + offset for index in face) for face in faces)
    out_smooth.extend([smooth] * len(faces))


def tube(mat, points, radius, sides=4, closed=False):
    points = [Vector(p) for p in points]
    if closed and (points[0] - points[-1]).length < 1e-7:
        points = points[:-1]
    vertices = []
    for index, point in enumerate(points):
        before = points[(index - 1) % len(points)] if closed or index else point
        after = points[(index + 1) % len(points)] if closed or index < len(points) - 1 else point
        tangent = (after - before).normalized()
        normal = tangent.cross(Vector((0, 1, 0)))
        if normal.length < 0.01:
            normal = tangent.cross(Vector((0, 0, 1)))
        normal.normalize()
        bitangent = tangent.cross(normal).normalized()
        for step in range(sides):
            angle = TAU * step / sides
            vertices.append(point + radius * (math.cos(angle) * normal + math.sin(angle) * bitangent))
    faces = []
    for index in range(len(points) if closed else len(points) - 1):
        next_index = (index + 1) % len(points)
        for side in range(sides):
            faces.append((index * sides + side, index * sides + (side + 1) % sides,
                          next_index * sides + (side + 1) % sides, next_index * sides + side))
    if not closed:
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple((len(points) - 1) * sides + side for side in range(sides)))
    geometry(mat, vertices, faces)


def page_height(x, z):
    t = max(0, min(1, (abs(x) - 0.035) / 1.29))
    return 0.143 + 0.146 * math.sin(math.pi * t) * math.exp(-0.45 * t) - 0.057 * math.exp(-12 * t) + 0.006 * math.cos(z * 2.8)


def lower_height(x, z):
    t = max(0, min(1, (abs(x) - 0.035) / 1.29))
    return -0.015 + 0.056 * math.sin(math.pi * t) - 0.022 * math.exp(-12 * t)


def corner_z(x, z, width, depth, radius):
    # Rounded outer corners retain a square binding edge at the gutter.
    if abs(x) > width - radius and abs(z) > depth - radius:
        tx = (abs(x) - (width - radius)) / radius
        return math.copysign(depth - radius + radius * math.sqrt(max(0, 1 - tx * tx)), z)
    return z


def surface_volume(side, mat_top, mat_side, top, bottom, width=1.325, depth=0.875, nx=36, nz=8):
    vertices = []
    for layer in (top, bottom):
        for ix in range(nx + 1):
            x = side * (0.035 + (width - 0.035) * ix / nx)
            for iz in range(nz + 1):
                z = -depth + 2 * depth * iz / nz
                z = corner_z(x, z, width, depth, 0.025)
                vertices.append((x, layer(x, z), z))
    stride = nz + 1
    size = (nx + 1) * stride
    faces_top, faces_side = [], []
    for ix in range(nx):
        for iz in range(nz):
            a = ix * stride + iz
            face = (a, a + 1, a + stride + 1, a + stride)
            faces_top.append(face if side > 0 else tuple(reversed(face)))
            underside = tuple(i + size for i in reversed(face))
            faces_side.append(underside if side > 0 else tuple(reversed(underside)))
    boundary = list(range(stride))
    boundary += [ix * stride + nz for ix in range(1, nx + 1)]
    boundary += [nx * stride + iz for iz in range(nz - 1, -1, -1)]
    boundary += [ix * stride for ix in range(nx - 1, 0, -1)]
    for i, a in enumerate(boundary):
        b = boundary[(i + 1) % len(boundary)]
        face = (a, a + size, b + size, b)
        faces_side.append(face if side > 0 else tuple(reversed(face)))
    geometry(mat_top, vertices, faces_top)
    geometry(mat_side, vertices, faces_side)


def page_line(mat, coords, radius=0.0016, offset=0.0025, closed=False):
    tube(mat, [(x, page_height(x, z) + offset, z) for x, z in coords], radius, closed=closed)


def rounded_border(side, x0, x1, z0, z1, radius=0.05):
    points = []
    for cx, cz, start in [(x1 - radius, z1 - radius, 0), (x0 + radius, z1 - radius, 90),
                          (x0 + radius, z0 + radius, 180), (x1 - radius, z0 + radius, 270)]:
        for i in range(9):
            angle = math.radians(start + i * 90 / 8)
            points.append((side * (cx + radius * math.cos(angle)), cz + radius * math.sin(angle)))
    # Long border edges follow the curved page instead of cutting through its arch.
    dense = []
    for i, point in enumerate(points):
        next_point = points[(i + 1) % len(points)]
        steps = max(1, math.ceil(math.dist(point, next_point) / 0.04))
        dense.extend((point[0] + (next_point[0] - point[0]) * j / steps,
                      point[1] + (next_point[1] - point[1]) * j / steps) for j in range(steps))
    return dense


def star(x, z, size, mat="Brass | engraving"):
    for angle in (0, math.pi / 2):
        page_line(mat, [(x + size * math.cos(angle) * k, z + size * math.sin(angle) * k) for k in (-1, 0, 1)], 0.0012)
    points = [(x + size * 0.28 * math.cos(TAU * i / 12), z + size * 0.28 * math.sin(TAU * i / 12)) for i in range(12)]
    page_line("Brass | polished", points, 0.0013, closed=True)


def book_geometry():
    for side in (-1, 1):
        # Leather wrapped boards and a separated page block produce a readable silhouette.
        surface_volume(side, "Leather | midnight", "Leather | midnight",
                       lambda x, z: lower_height(x, z) - 0.009,
                       lambda x, z: lower_height(x, z) - 0.071,
                       width=1.4, depth=0.95, nx=40)
        surface_volume(side, "Paper | blue black", "Page edges | antique gold", page_height, lower_height)
        # An individual top leaf with a small rolled edge and double gilded folio edge.
        for inset, radius, mat in [(0.0, 0.0022, "Brass | polished"), (0.014, 0.001, "Brass | engraving")]:
            border = rounded_border(side, 0.044 + inset, 1.323 - inset, -0.873 + inset, 0.873 - inset, 0.027)
            page_line(mat, border, radius, offset=0.0012, closed=True)

        # Closely spaced, physically separated edge ridges reveal individual folios in side view.
        for layer in range(1, 13):
            fraction = layer / 14
            edge = []
            for i in range(43):
                x = side * (0.046 + (1.322 - 0.046) * i / 42)
                edge.append((x, -0.878))
            edge.extend((side * 1.328, -0.878 + 1.756 * i / 24) for i in range(1, 25))
            edge.extend((side * (1.322 - (1.322 - 0.046) * i / 42), 0.878) for i in range(1, 43))
            tube("Page seams | bronze", [(x, lower_height(x, z) * (1 - fraction) + page_height(x, z) * fraction, z) for x, z in edge], 0.0017, sides=3)

        # Leather piping sits outside the page block and follows each curved board.
        border = rounded_border(side, 0.05, 1.38, -0.926, 0.926, 0.04)
        tube("Brass | engraving", [(x, lower_height(x, z) - 0.015, z) for x, z in border], 0.006, sides=6, closed=True)
        border = rounded_border(side, 0.064, 1.345, -0.907, 0.907, 0.04)
        tube("Leather | midnight", [(x, lower_height(x, z) - 0.003, z) for x, z in border], 0.008, sides=6, closed=True)

        # An etched double rectangular frame; all strokes are shaped to the paper curvature.
        for inset, mat, radius in [(0, "Brass | polished", 0.0022), (0.025, "Brass | engraving", 0.0013)]:
            page_line(mat, rounded_border(side, 0.11 + inset, 1.25 - inset, -0.792 + inset, 0.792 - inset, 0.05), radius, closed=True)

        # Four corner cartouches use interlocking spirals and pointed leaf ribs.
        for outer in (False, True):
            for front in (-1, 1):
                anchor_x = 1.195 if outer else 0.167
                inward_x = -1 if outer else 1
                anchor_z = front * 0.733
                inward_z = -front
                for scale in (1, 0.61):
                    coords = []
                    for i in range(31):
                        t = i / 30
                        angle = t * TAU * 1.28
                        r = (0.075 * (1 - t) + 0.005) * scale
                        x = anchor_x + inward_x * (0.08 * scale + r * math.cos(angle))
                        z = anchor_z + inward_z * (0.08 * scale + r * math.sin(angle))
                        coords.append((side * x, z))
                    page_line("Brass | polished", coords, 0.0015)
                for leaf in range(3):
                    a = (leaf + 1) * math.pi / 8
                    length = 0.18
                    coords = []
                    for i in range(17):
                        t = i / 16
                        cross = math.sin(t * math.pi) * 0.022
                        dx = length * t * math.cos(a) - cross * math.sin(a)
                        dz = length * t * math.sin(a) + cross * math.cos(a)
                        coords.append((side * (anchor_x + inward_x * dx), anchor_z + inward_z * dz))
                    for i in range(16, -1, -1):
                        t = i / 16
                        cross = -math.sin(t * math.pi) * 0.022
                        dx = length * t * math.cos(a) - cross * math.sin(a)
                        dz = length * t * math.sin(a) + cross * math.cos(a)
                        coords.append((side * (anchor_x + inward_x * dx), anchor_z + inward_z * dz))
                    page_line("Brass | engraving", coords, 0.0013, closed=True)

        # Page-mounted celestial instrument dial, under the live fractal dock.
        cx = side * 0.69
        for rx, rz, mat in [(0.41, 0.41, "Brass | engraving"), (0.445, 0.445, "Brass | polished"), (0.47, 0.47, "Brass | engraving")]:
            page_line(mat, [(cx + rx * math.cos(TAU * i / 100), rz * math.sin(TAU * i / 100)) for i in range(100)], 0.0014, closed=True)
        for i in range(48):
            angle = TAU * i / 48
            r0 = 0.434 if i % 4 == 0 else 0.447
            page_line("Brass | polished", [(cx + r * math.cos(angle), r * math.sin(angle)) for r in (r0, 0.465)], 0.0011)
        # Distinct orbital rosettes printed as recessed-looking low-relief fine metal.
        for angle in ((0, 0.65, 1.3) if side < 0 else (0.35, 1.2, 2.05)):
            coords = []
            for i in range(96):
                t = TAU * i / 96
                u, v = 0.36 * math.cos(t), 0.15 * math.sin(t)
                coords.append((cx + u * math.cos(angle) - v * math.sin(angle), u * math.sin(angle) + v * math.cos(angle)))
            page_line("Brass | engraving", coords, 0.0009, closed=True)
        # Seven small star charts and a lower inscription rule leave room for runtime labels.
        for i in range(7):
            x = side * (0.34 + i * 0.113)
            star(x, -0.637, 0.012 if i in (0, 6) else 0.009)
        page_line("Brass | engraving", [(side * (0.36 + i * 0.036), 0.657) for i in range(20)], 0.0012)
        star(side * 0.69, 0.657, 0.016, "Brass | polished")

        # Applied cover corner guards are solid, hand-shaped pieces beyond the page perimeter.
        for front in (-1, 1):
            coords = [(side * 1.255, front * 0.938), (side * 1.377, front * 0.938),
                      (side * 1.389, front * 0.925), (side * 1.389, front * 0.8)]
            tube("Brass | polished", [(x, lower_height(x, z) - 0.005, z) for x, z in coords], 0.011, sides=8)
            diagonal = [(side * (1.28 + i * 0.098 / 20), front * (0.933 - i * 0.112 / 20)) for i in range(21)]
            tube("Brass | engraving", [(x, lower_height(x, z) - 0.006, z) for x, z in diagonal], 0.006, sides=6)

    # A flexible, rounded binding spans the two boards below the deep exposed gutter.
    vertices, faces = [], []
    for iz in range(9):
        z = -0.945 + iz * 1.89 / 8
        for ix in range(17):
            t = ix / 16
            x = -0.13 + 0.26 * t
            y = -0.059 - 0.075 * math.sin(math.pi * t)
            vertices.append((x, y, z))
    for iz in range(8):
        for ix in range(16):
            a = iz * 17 + ix
            faces.append((a, a + 17, a + 18, a + 1))
    geometry("Leather | midnight", vertices, faces)
    # Binding thread bridges make the dark central valley unmistakably a real book.
    for z in (-0.868, 0.868):
        for i in range(15):
            x = -0.045 + i * 0.006
            mat = "Brass | engraving" if i % 2 else "Thread | sea green"
            tube(mat, [(x - 0.002, 0.072, z - 0.006), (x, 0.082, z), (x + 0.002, 0.066, z + 0.006)], 0.003, sides=5)
    # A narrow ribbon drops naturally from the gutter at the fore-edge.
    vertices, faces = [], []
    for i in range(13):
        t = i / 12
        z = 0.2 + 0.91 * t
        y = 0.083 - 0.2 * max(0, (t - 0.73) / 0.27) ** 1.2
        x = 0.009 + 0.05 * math.sin(t * math.pi * 0.65)
        vertices.extend([(x - 0.023, y, z), (x + 0.023, y, z)])
    for i in range(12):
        faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
    geometry("Thread | sea green", vertices, faces)


def create_asset_objects():
    objects = []
    root = bpy.data.objects.new("AlmanacBook", None)
    bpy.context.collection.objects.link(root)
    root["asset_version"] = 1
    root["design_units"] = "metre-equivalent scene units; 2.8 wide"
    for name, (vertices, faces, smoothing) in GROUPS.items():
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        mesh.materials.append(MATERIALS[name])
        for polygon, smooth in zip(mesh.polygons, smoothing):
            polygon.use_smooth = smooth
        # UVs are a durable authoring contract, even though this first version uses no maps.
        uv = mesh.uv_layers.new(name="UVMap")
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                uv.data[loop_index].uv = ((vertex.x + 1.4) / 2.8, (vertex.y + 0.95) / 1.9)
        triangulate = obj.modifiers.new("Frozen export triangulation", "TRIANGULATE")
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        objects.append(obj)
    for name, point in [("OrbDockLeft", (-0.69, 0.67, 0)), ("OrbDockRight", (0.69, 0.67, 0)),
                        ("PageLabelLeft", (-0.69, page_height(-0.69, 0.565) + 0.008, 0.565)),
                        ("PageLabelRight", (0.69, page_height(0.69, 0.565) + 0.008, 0.565))]:
        anchor = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(anchor)
        anchor.parent = root
        anchor.location = blender_point(point)
        anchor.empty_display_size = 0.1
        anchor["role"] = "runtime attachment point"
        objects.append(anchor)
    return root, objects


def aim(obj, point):
    obj.rotation_euler = (Vector(blender_point(point)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def setup_studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.color = (0.035, 0.035, 0.035)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.065, 0.095, 0.13, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.22
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name, position, power, color, size in [
        ("Key softbox", (-2.6, 4.5, 2), 520, (1, 0.79, 0.53), 4),
        ("Blue rim", (1.6, 2.8, -2.8), 740, (0.36, 0.63, 1), 3),
        ("Front fill", (0, 1.8, 4), 190, (0.77, 0.9, 1), 3),
    ]:
        lamp = bpy.data.lights.new(name, 'AREA')
        lamp.energy = power
        lamp.color = color
        lamp.shape = 'DISK'
        lamp.size = size
        obj = bpy.data.objects.new(name, lamp)
        bpy.context.collection.objects.link(obj)
        obj.location = blender_point(position)
        aim(obj, (0, 0.1, 0))
    camera_data = bpy.data.cameras.new("Book presentation camera")
    camera = bpy.data.objects.new("Book presentation camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = blender_point((0.22, 2.8, 3.7))
    camera_data.type = 'PERSP'
    camera_data.lens = 48
    aim(camera, (0, 0.1, 0))
    scene.camera = camera
    # The studio floor is presentation evidence only and never part of the exported asset.
    bpy.ops.mesh.primitive_plane_add(size=200, location=blender_point((0, -0.15, 0)))
    floor = bpy.context.object
    floor.name = "Studio floor - not exported"
    mat = bpy.data.materials.new("Studio charcoal")
    mat.diffuse_color = (0.009, 0.015, 0.025, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = mat.diffuse_color
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.5
    floor.data.materials.append(mat)


def render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    material("Leather | midnight", (0.012, 0.018, 0.022), 0.02, 0.64)
    material("Paper | blue black", (0.009, 0.016, 0.021), 0.02, 0.9)
    material("Page edges | antique gold", (0.24, 0.14, 0.052), 0.45, 0.65)
    material("Page seams | bronze", (0.055, 0.032, 0.018), 0.2, 0.78)
    material("Brass | polished", (0.67, 0.39, 0.12), 0.87, 0.26)
    material("Brass | engraving", (0.28, 0.17, 0.066), 0.68, 0.45)
    material("Thread | sea green", (0.008, 0.051, 0.055), 0.03, 0.82)
    book_geometry()
    root, objects = create_asset_objects()
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in objects:
        obj.select_set(True)
    glb = OUTPUT / 'almanac-book.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_materials='EXPORT', export_normals=True, export_texcoords=True)
    setup_studio()
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'almanac-book.blend'), compress=True)
    manifest = {
        "name": "Irchiinnuss fixed-open Almanac",
        "assetVersion": 1,
        "authoring": "Authored procedural Blender geometry; no external generated mesh or texture",
        "blenderVersion": bpy.app.version_string,
        "sourceScript": "assets-source/almanac/build_book.py",
        "sourceBlend": "assets-source/almanac/almanac-book.blend",
        "sourceScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "sourceBlendSha256": hashlib.sha256((HERE / 'almanac-book.blend').read_bytes()).hexdigest(),
        "runtimeAsset": "public/models/almanac/almanac-book.glb",
        "sha256": hashlib.sha256(glb.read_bytes()).hexdigest(),
        "bytes": glb.stat().st_size,
        "triangles": sum(len(obj.data.polygons) for obj in objects if obj.type == 'MESH'),
        "materials": list(MATERIALS),
        "textures": [],
        "coordinates": {"up": "+Y", "front": "+Z", "width": 2.8, "coverDepth": 1.9, "ribbonFront": 1.11, "root": [0, 0, 0]},
        "anchors": {"OrbDockLeft": [-0.69, 0.67, 0], "OrbDockRight": [0.69, 0.67, 0]},
        "orbRadius": 0.34,
        "limitations": ["Fixed spread; no page turning or collision mesh", "Material factors only; no leather grain or roughness maps", "Lettering supplied by runtime"],
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if not args.no_render:
        render(EVIDENCE / 'source-final.png')
        clay = bpy.data.materials.new('Neutral clay audit')
        clay.diffuse_color = (0.38, 0.38, 0.38, 1)
        clay.use_nodes = True
        clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = clay.diffuse_color
        clay.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
        bpy.context.view_layer.material_override = clay
        render(EVIDENCE / 'source-clay.png')
        bpy.context.view_layer.material_override = None
        # Delete authoring asset and import the delivery GLB; lights/camera remain identical.
        for obj in [root, *objects]:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        render(EVIDENCE / 'export-final.png')
        camera = bpy.context.scene.camera
        camera.location = blender_point((2.6, 0.95, 3.5))
        aim(camera, (0, 0.08, 0))
        render(EVIDENCE / 'export-side.png')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
