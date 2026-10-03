"""Reimport each figurine-study GLB in Blender and verify its sampled geometry against the manifest."""
import hashlib
import json
import os
import sys
import bpy

assets = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
with open(os.path.join(assets, 'figurine-studies-manifest.json')) as source:
    manifest = json.load(source)
reports = []
for expected in manifest['assets']:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    path = os.path.join(assets, expected['file'])
    with open(path, 'rb') as source:
        digest = hashlib.sha256(source.read()).hexdigest()
    assert digest == expected['sha256'], 'Export bytes changed since manifest'
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    # Blender is Z-up. Convert imported positions back to glTF's Y-up frame.
    coordinates = [(point.x, point.z, -point.y) for point in points]
    bounds = {key: [operation(p[axis] for p in coordinates) for axis in range(3)]
              for key, operation in [('min', min), ('max', max)]}
    assert len(points) == expected['points']
    assert sum(len(obj.data.polygons) for obj in objects) == 0
    assert all(abs(bounds[key][axis] - expected['bounds'][key][axis]) < 1e-5
               for key in bounds for axis in range(3))
    materials = [material.name for obj in objects for material in obj.data.materials if material]
    assert materials, 'Point material missing after import'
    reports.append({'file': expected['file'], 'sha256': digest, 'looseVertices': len(points),
                    'triangles': 0, 'bounds': bounds, 'materials': materials})
report = {'loader': 'Blender glTF importer', 'version': list(bpy.app.version), 'checksPassed': True,
          'assets': reports, 'pointPolicy': 'POINTS import as loose vertices. Use a point renderer or instance display glyphs to see them; these are not triangle surfaces.'}
with open(os.path.join(assets, 'figurine-studies-loader-report.json'), 'w') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print(json.dumps({'checksPassed': True, 'assets': len(reports), 'pointsPerAsset': reports[0]['looseVertices']}))
