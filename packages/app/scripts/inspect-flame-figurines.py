"""Reimport colored hybrid-flame GLBs in Blender and verify geometry and structural vertex colors."""
import hashlib
import json
import math
import os
import struct
import sys
import bpy

assets = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
with open(os.path.join(assets, 'flame-figurines-manifest.json')) as source:
    manifest = json.load(source)
reports = []


def byte_color_roundtrip(value):
    """Blender BYTE_COLOR stores sRGB bytes and exposes decoded linear values."""
    encoded = value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055
    quantized = round(encoded * 255) / 255
    return quantized / 12.92 if quantized <= 0.04045 else ((quantized + 0.055) / 1.055) ** 2.4


for expected in manifest['assets']:
    path = os.path.join(assets, expected['file'])
    with open(path, 'rb') as source:
        binary = source.read()
    digest = hashlib.sha256(binary).hexdigest()
    assert digest == expected['sha256'], 'Export bytes changed since manifest'
    json_size = struct.unpack_from('<I', binary, 12)[0]
    gltf = json.loads(binary[20:20 + json_size])
    data_start = 20 + json_size + 8
    color_accessors = []
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            assert primitive['mode'] == 0, 'Study is expected to use glTF POINTS'
            color_accessors.append(gltf['accessors'][primitive['attributes']['COLOR_0']])
    raw_colors = []
    for accessor in color_accessors:
        assert accessor['componentType'] == 5126
        components = {'VEC3': 3, 'VEC4': 4}[accessor['type']]
        view = gltf['bufferViews'][accessor['bufferView']]
        start = data_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = view.get('byteStride', components * 4)
        raw_colors.extend(struct.unpack_from('<' + 'f' * components, binary, start + index * stride)[:3]
                          for index in range(accessor['count']))
    assert all(math.isfinite(c) and 0 <= c <= 1 for color in raw_colors for c in color)
    assert len(set(tuple(round(c, 3) for c in color) for color in raw_colors)) >= 3
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    coordinates = [(p.x, p.z, -p.y) for p in points]
    bounds = {key: [operation(p[axis] for p in coordinates) for axis in range(3)]
              for key, operation in [('min', min), ('max', max)]}
    assert len(points) == expected['points'] == len(raw_colors)
    assert sum(len(obj.data.polygons) for obj in objects) == 0
    assert all(abs(bounds[key][axis] - expected['bounds'][key][axis]) < 1e-5
               for key in bounds for axis in range(3))
    attributes = [attribute for obj in objects for attribute in list(obj.data.color_attributes)[:1]]
    colors = [tuple(value.color[:3]) for attribute in attributes
              for value in attribute.data]
    assert len(colors) == len(raw_colors), 'Vertex colors did not survive import'
    types = {attribute.data_type for attribute in attributes}
    assert len(types) == 1 and types <= {'BYTE_COLOR', 'FLOAT_COLOR'}
    quantizes = 'BYTE_COLOR' in types
    predicted = [tuple(byte_color_roundtrip(c) if quantizes else c for c in color) for color in raw_colors]
    assert all(abs(a - b) < 1e-5 for imported, reference in zip(colors, predicted)
               for a, b in zip(imported, reference)), 'Imported colors differ from the importer storage policy'
    max_color_difference = max(abs(a - b) for imported, raw in zip(colors, raw_colors)
                               for a, b in zip(imported, raw))
    materials = [material.name for obj in objects for material in obj.data.materials if material]
    assert materials, 'Point material missing after import'
    reports.append({'file': expected['file'], 'sha256': digest, 'looseVertices': len(points),
                    'triangles': 0, 'bounds': bounds, 'linearVertexColors': len(colors),
                    'importedColorStorage': sorted(types), 'maxColorDifference': max_color_difference,
                    'materials': materials})
report = {'loader': 'Blender glTF importer', 'version': list(bpy.app.version), 'checksPassed': True,
          'assets': reports, 'pointPolicy': 'POINTS import as colored loose vertices. Use a point renderer; these are not triangle surfaces.',
          'colorPolicy': 'GLBs retain FLOAT32 linear vertex colors. Blender BYTE_COLOR import quantizes through 8-bit sRGB; every imported channel is checked against that explicit transfer function. Live density tone mapping is separate.'}
with open(os.path.join(assets, 'flame-figurines-loader-report.json'), 'w') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print(json.dumps({'checksPassed': True, 'assets': len(reports), 'verticesAndColorsPerAsset': reports[0]['looseVertices']}))
