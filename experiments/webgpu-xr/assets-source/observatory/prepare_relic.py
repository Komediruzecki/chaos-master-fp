# Prepare the untextured Meshy seed donor for the opaque WebGPU study renderer.
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


TASK_ID = '01a14734-8023-71cb-9b11-96d1d797e726'


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def material(name, colour, metal, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    mat.diffuse_color = (*colour, 1)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--donor', required=True, type=Path)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--runtime-dir', required=True, type=Path)
    parser.add_argument('--evidence-dir', required=True, type=Path)
    parser.add_argument('--no-render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    for path in (args.source_dir, args.runtime_dir, args.evidence_dir):
        path.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.import_scene.gltf(filepath=str(args.donor))
    imported = list(bpy.context.selected_objects)
    meshes = [o for o in imported if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('The donor has no geometry.')
    for mesh in meshes:
        for mat in mesh.data.materials:
            if mat and mat.use_nodes and any(n.type == 'TEX_IMAGE' for n in mat.node_tree.nodes):
                raise RuntimeError('This recipe is only for an untextured donor; texture found.')
        matrix = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = matrix
    bpy.ops.object.select_all(action='DESELECT')
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    donor = bpy.context.object
    donor.name = 'Celestial seed | preserved normalized donor'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in imported:
        if obj != donor and obj.name in bpy.data.objects and obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    bounds_min = Vector([min(v.co[i] for v in donor.data.vertices) for i in range(3)])
    bounds_max = Vector([max(v.co[i] for v in donor.data.vertices) for i in range(3)])
    height = bounds_max.z - bounds_min.z
    centre = (bounds_min + bounds_max) * 0.5
    for vertex in donor.data.vertices:
        vertex.co = (vertex.co - Vector((centre.x, centre.y, bounds_min.z))) / height
    donor.data.update()
    donor_count = sum(len(p.vertices) - 2 for p in donor.data.polygons)
    donor['provider_task_id'] = TASK_ID
    donor['source_glb_sha256'] = hashlib.sha256(args.donor.read_bytes()).hexdigest()
    donor['normalization'] = 'Height1.0; centred XZ; tip/baseY0 in exported glTF'
    delivery = donor.copy()
    delivery.data = donor.data.copy()
    delivery.name = 'CelestialSeed'
    bpy.context.collection.objects.link(delivery)
    bpy.ops.object.select_all(action='DESELECT')
    delivery.select_set(True)
    bpy.context.view_layer.objects.active = delivery
    decimate = delivery.modifiers.new('Silhouette reduction to fourteen thousand triangles', 'DECIMATE')
    decimate.decimate_type = 'COLLAPSE'
    decimate.ratio = min(1, 14000 / donor_count)
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    # Collapse can move extrema slightly; the runtime attachment contract is exact.
    lo = Vector([min(v.co[i] for v in delivery.data.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in delivery.data.vertices) for i in range(3)])
    midpoint = (lo + hi) * 0.5
    for vertex in delivery.data.vertices:
        vertex.co = (vertex.co - Vector((midpoint.x, midpoint.y, lo.z))) / (hi.z - lo.z)
    delivery.data.update()
    final_count = sum(len(p.vertices) - 2 for p in delivery.data.polygons)
    teal = material('Relic | patinated teal bronze', (0.064, 0.21, 0.19), 0.60, 0.38)
    clay = material('Relic | neutral clay audit', (0.30, 0.30, 0.30), 0.0, 0.7)
    for obj in (donor, delivery):
        obj.data.materials.clear()
        obj.data.materials.append(teal)
    donor.hide_render = True
    donor.hide_set(True)
    anchor = bpy.data.objects.new('RelicBase', None)
    bpy.context.collection.objects.link(anchor)
    anchor.parent = delivery
    anchor.empty_display_size = 0.06
    anchor.select_set(True)
    glb = args.runtime_dir / 'celestial-seed.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.075, 0.11, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for name, position, energy, colour, size in [
        ('Relic key', (-1.5, -1.8, 2.0), 160, (1, 0.78, 0.53), 2),
        ('Relic rim', (1, 0.8, 1.5), 180, (0.44, 0.73, 1), 1.6),
        ('Relic fill', (0.2, -2, 0.7), 75, (0.70, 0.9, 1), 1.2),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, colour, 'DISK', size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = position
        aim(obj, (0, 0, 0.5))
    camera_data = bpy.data.cameras.new('Relic same-view audit camera')
    camera = bpy.data.objects.new('Relic same-view audit camera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (1.2, -2.3, 0.95)
    camera_data.lens = 72
    aim(camera, (0, 0, 0.5))
    scene.camera = camera
    blend = args.source_dir / 'celestial-seed.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    manifest = {'name': 'Celestial seed relic', 'assetVersion': 1,
                'provider': 'Meshy text-to-3d preview', 'providerTaskId': TASK_ID,
                'providerCredits': 20, 'sourceGlbSha256': hashlib.sha256(args.donor.read_bytes()).hexdigest(),
                'sourceTriangles': donor_count, 'runtimeTriangles': final_count,
                'runtimeBytes': glb.stat().st_size, 'runtimeSha256': hashlib.sha256(glb.read_bytes()).hexdigest(),
                'sourceBlendSha256': hashlib.sha256(blend.read_bytes()).hexdigest(),
                'sourceScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'blenderVersion': bpy.app.version_string,
                'coordinates': {'up': '+Y', 'height': 1.0, 'baseY': 0, 'centredXZ': True, 'root': 'CelestialSeed'},
                'materials': ['Relic | patinated teal bronze'], 'textures': [],
                'derivative': 'Untextured donor normalized and Blender Collapse reduced; one authored opaque factor material',
                'preservedFeatures': ['Tapering seed silhouette', 'Broad spiral blade', 'Open negative spaces through the middle'],
                'limitations': ['Decorative render asset, no collision or skeletal animation',
                                'Pointed base needs a mount or deliberate floating placement',
                                'Material factors are not texture bakes or a weathered surface treatment',
                                'Desktop and headset visual acceptance remain separate from Blender inspection']}
    (args.runtime_dir / 'celestial-seed.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if not args.no_render:
        scene.view_layers[0].material_override = clay
        delivery.hide_render = True
        donor.hide_render = False
        donor.hide_set(False)
        render(args.evidence_dir / 'relic-donor-clay.png')
        donor.hide_render = True
        donor.hide_set(True)
        bpy.data.objects.remove(delivery, do_unlink=True)
        bpy.data.objects.remove(anchor, do_unlink=True)
        bpy.ops.import_scene.gltf(filepath=str(glb))
        render(args.evidence_dir / 'relic-export-clay.png')
        scene.view_layers[0].material_override = None
        render(args.evidence_dir / 'relic-export-material.png')
        camera.location = (-1.4, 2.1, 0.85)
        aim(camera, (0, 0, 0.5))
        render(args.evidence_dir / 'relic-export-reverse.png')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
