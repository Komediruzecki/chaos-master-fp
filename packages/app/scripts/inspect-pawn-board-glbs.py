"""Fresh Blender glTF reimport checks and optional PBR/clay previews of the exported bytes."""
import json
import os
import sys
import hashlib
import bpy
from mathutils import Vector

assets = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
filenames = [f'fractal-pawn-{form}-{side}.glb' for form in ['echo', 'lattice'] for side in ['frost', 'ember']]
filenames.append('fractal-pawn-board.glb')
render = '--render' in sys.argv
results = []


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def load(filename):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(assets, filename))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']


for filename in filenames:
    clear()
    objects = load(filename)
    blender_positions = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    # Blender is Z-up; report the imported geometry back in the GLB's Y-up frame.
    positions = [Vector((point.x, point.z, -point.y)) for point in blender_positions]
    loose = 0
    for obj in objects:
        used = {index for polygon in obj.data.polygons for index in polygon.vertices}
        loose += sum(vertex.index not in used for vertex in obj.data.vertices)
    materials = []
    for obj in objects:
        for material in obj.data.materials:
            bsdf = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None) if material and material.use_nodes else None
            materials.append({'name': material.name if material else None,
                              'ior': bsdf.inputs['IOR'].default_value if bsdf else None,
                              'transmission': bsdf.inputs['Transmission Weight'].default_value if bsdf else None,
                              'embeddedImageNodes': sum(node.type == 'TEX_IMAGE' for node in material.node_tree.nodes) if material and material.use_nodes else 0})
    with open(os.path.join(assets, filename), 'rb') as source:
        digest = hashlib.sha256(source.read()).hexdigest()
    report = {'file': filename, 'sha256': digest, 'meshObjects': len(objects),
              'vertices': len(positions), 'triangles': sum(len(obj.data.polygons) for obj in objects),
              'loosePointVertices': loose, 'bounds': {'min': [min(p[axis] for p in positions) for axis in range(3)],
                                                     'max': [max(p[axis] for p in positions) for axis in range(3)]},
              'materials': materials}
    if 'board' not in filename:
        assert loose == 24000, f'{filename}: native POINTS missing from glTF import'
        assert report['triangles'] == 3072, f'{filename}: shell triangle mismatch'
        assert any(m['transmission'] and m['transmission'] > 0.95 for m in materials), f'{filename}: transmission lost'
        assert any(m['ior'] and abs(m['ior'] - 1.45) < 0.001 for m in materials), f'{filename}: IOR lost'
    else:
        assert report['triangles'] == 780
    assert abs(report['bounds']['min'][1]) < 1e-6
    results.append(report)

loader_report = {'loader': 'Blender glTF importer', 'version': list(bpy.app.version),
                 'checksPassed': True, 'assets': results,
                 'pointPolicy': 'POINTS import as 24000 loose mesh vertices. Blender does not render loose vertices directly.',
                 'previewPolicy': 'Optional inspection renders display those imported POINTS as instanced emissive 0.0035 m sphere glyphs; GLBs remain unchanged.'}
with open(os.path.join(assets, 'pawn-board-loader-report.json'), 'w') as output:
    json.dump(loader_report, output, indent=2)
    output.write('\n')

if render:
    clear()
    board = load('fractal-pawn-board.glb')
    for index, filename in enumerate(filenames[:-1]):
        objects = load(filename)
        for obj in objects:
            obj.location += Vector(((index - 1.5) * 1.6, 0, 0.515))
            bpy.context.view_layer.update()
            used = {vertex for polygon in obj.data.polygons for vertex in polygon.vertices}
            points = [vertex.co.copy() for vertex in obj.data.vertices if vertex.index not in used]
            if not points:
                continue
            mesh = bpy.data.meshes.new(f'{filename} inspection glyph source')
            mesh.from_pydata(points, [], [])
            cloud = bpy.data.objects.new(f'{filename} POINTS display glyphs', mesh)
            bpy.context.collection.objects.link(cloud)
            cloud.matrix_world = obj.matrix_world.copy()
            material = bpy.data.materials.new(f'{filename} inspection point emission')
            material.use_nodes = True
            bsdf = material.node_tree.nodes.get('Principled BSDF')
            tint = (0.3, 0.82, 0.92, 1) if 'frost' in filename else (1, 0.34, 0.09, 1)
            bsdf.inputs['Base Color'].default_value = tint
            bsdf.inputs['Emission Color'].default_value = tint
            bsdf.inputs['Emission Strength'].default_value = 1.2
            group = bpy.data.node_groups.new(f'{filename} inspection point display', 'GeometryNodeTree')
            group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
            group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
            entry = group.nodes.new('NodeGroupInput')
            exit_node = group.nodes.new('NodeGroupOutput')
            sphere = group.nodes.new('GeometryNodeMeshIcoSphere')
            sphere.inputs['Radius'].default_value = 0.0035
            sphere.inputs['Subdivisions'].default_value = 1
            surface = group.nodes.new('GeometryNodeSetMaterial')
            surface.inputs['Material'].default_value = material
            instance = group.nodes.new('GeometryNodeInstanceOnPoints')
            group.links.new(sphere.outputs['Mesh'], surface.inputs['Geometry'])
            group.links.new(surface.outputs['Geometry'], instance.inputs['Instance'])
            group.links.new(entry.outputs['Geometry'], instance.inputs['Points'])
            group.links.new(instance.outputs['Instances'], exit_node.inputs['Geometry'])
            cloud.modifiers.new('Explicit POINTS inspection glyphs', 'NODES').node_group = group
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 8
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.world.color = (0.07, 0.09, 0.12)
    scene.view_settings.view_transform = 'AgX'
    for name, position, power, size, colour in [
        ('Key', (2, -3, 7), 2600, 5, (0.72, 0.88, 1)),
        ('Rim', (-4, 3, 4), 2200, 4, (0.2, 0.6, 1)),
        ('Warm fill', (4, 1, 3), 1400, 3, (1, 0.63, 0.3)),
    ]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.size, light.color = power, size, colour
        obj = bpy.data.objects.new(name, light)
        bpy.context.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.objects.new('Inspection camera', bpy.data.cameras.new('Inspection camera'))
    bpy.context.collection.objects.link(camera)
    camera.location = (7.5, -9, 5.8)
    camera.rotation_euler = (Vector((0, 0, 1.1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 70
    scene.camera = camera
    scene.render.filepath = os.path.join(assets, 'pawn-board-glb-pbr-inspection.png')
    bpy.ops.render.render(write_still=True)
    clay = bpy.data.materials.new('Neutral clay inspection')
    clay.use_nodes = True
    bsdf = clay.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.42, 0.46, 0.5, 1)
    bsdf.inputs['Roughness'].default_value = 0.65
    scene.view_layers[0].material_override = clay
    scene.render.filepath = os.path.join(assets, 'pawn-board-glb-clay-inspection.png')
    bpy.ops.render.render(write_still=True)

print(json.dumps({'loader': loader_report['loader'], 'version': loader_report['version'], 'checksPassed': True,
                  'assets': len(results), 'loosePoints': [item['loosePointVertices'] for item in results]}))
