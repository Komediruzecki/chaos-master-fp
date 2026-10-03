"""Fresh Blender imports of the blue-branch GLBs, checked against their actual bytes."""
import hashlib
import json
import math
import os
import struct
import sys
import bpy

assets = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
filenames = [f'fractal-pawn-blue-branch-{side}.glb' for side in ['frost', 'ember']]
reports = []


def linear_to_srgb(value):
    return value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


def imported_color_reference(raw_colors, storage):
    """Use the installed converter, not exact pow at byte-rounding thresholds.

    The glTF importer writes FLOAT32 linear colors with foreach_set('color').
    Blender's SIMD sRGB approximation can choose the adjoining byte code near
    a rounding threshold. An independent POINT attribute checks this conversion
    without accepting a larger tolerance on the imported GLB colors themselves.
    https://github.com/blender/blender/blob/main/source/blender/blenlib/intern/math_color.cc
    """
    if storage == 'FLOAT_COLOR':
        return [tuple(color[:3]) for color in raw_colors]
    probe = bpy.data.meshes.new('Independent BYTE_COLOR transfer reference')
    try:
        probe.vertices.add(len(raw_colors))
        attribute = probe.color_attributes.new('Raw linear reference', 'BYTE_COLOR', 'POINT')
        attribute.data.foreach_set('color', [value for color in raw_colors for value in color])
        return [tuple(value.color[:3]) for value in attribute.data]
    finally:
        bpy.data.meshes.remove(probe)


def imported_material_factor(socket):
    """A linked texture's socket default is unused; inspect its multiplier."""
    if not socket.is_linked:
        return socket.default_value
    node = socket.links[0].from_node
    assert node.type == 'MATH' and node.operation == 'MULTIPLY', 'Material factor graph changed'
    constants = [value.default_value for value in list(node.inputs)[:2] if not value.is_linked]
    assert len(constants) == 1, 'Material factor missing'
    return constants[0]


for filename in filenames:
    path = os.path.join(assets, filename)
    with open(path, 'rb') as source:
        binary = source.read()
    json_size = struct.unpack_from('<I', binary, 12)[0]
    gltf = json.loads(binary[20:20 + json_size])
    data_start = 20 + json_size + 8

    def read_float_attribute(index):
        accessor = gltf['accessors'][index]
        assert accessor['componentType'] == 5126
        components = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
        view = gltf['bufferViews'][accessor['bufferView']]
        start = data_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = view.get('byteStride', components * 4)
        return [struct.unpack_from('<' + 'f' * components, binary, start + index * stride)
                for index in range(accessor['count'])]

    primitives = [primitive for mesh in gltf['meshes'] for primitive in mesh['primitives']]
    points = [primitive for primitive in primitives if primitive.get('mode', 4) == 0]
    surfaces = [primitive for primitive in primitives if primitive.get('mode', 4) == 4]
    assert len(points) == 1 and len(surfaces) == 1, 'Expected one native core and one hollow shell'
    raw_colors = read_float_attribute(points[0]['attributes']['COLOR_0'])
    raw_positions = [p for primitive in primitives for p in read_float_attribute(primitive['attributes']['POSITION'])]
    raw_point_positions = read_float_attribute(points[0]['attributes']['POSITION'])
    raw_normals = read_float_attribute(surfaces[0]['attributes']['NORMAL'])
    if 'indices' in surfaces[0]:
        accessor = gltf['accessors'][surfaces[0]['indices']]
        view = gltf['bufferViews'][accessor['bufferView']]
        start = data_start + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        scalar = {5121: 'B', 5123: 'H', 5125: 'I'}[accessor['componentType']]
        stride = view.get('byteStride', struct.calcsize(scalar))
        raw_normals = [raw_normals[struct.unpack_from('<' + scalar, binary, start + n * stride)[0]]
                       for n in range(accessor['count'])]
    expected_triangles = sum(gltf['accessors'][primitive.get('indices', primitive['attributes']['POSITION'])]['count'] // 3
                             for primitive in surfaces)
    assert all(math.isfinite(c) and 0 <= c <= 1 for color in raw_colors for c in color)
    assert len(set(tuple(round(c, 3) for c in color[:3]) for color in raw_colors)) >= 3
    glass = gltf['materials'][surfaces[0]['material']]
    assert abs(glass['extensions']['KHR_materials_ior']['ior'] - 1.5) < 1e-6
    assert glass['extensions']['KHR_materials_transmission']['transmissionFactor'] > 0.95
    assert glass['pbrMetallicRoughness']['metallicFactor'] == 0
    assert 0 < glass['pbrMetallicRoughness']['roughnessFactor'] <= 0.08
    assert len(gltf['images']) >= 3 and all('bufferView' in image for image in gltf['images'])

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    core_objects = [obj for obj in objects if not obj.data.polygons]
    imported_positions = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    imported_core_positions = [obj.matrix_world @ vertex.co for obj in core_objects for vertex in obj.data.vertices]
    coordinates = [(p.x, p.z, -p.y) for p in imported_positions]
    core_coordinates = [(p.x, p.z, -p.y) for p in imported_core_positions]
    assert len(core_coordinates) == len(raw_colors) == len(raw_point_positions)
    assert all(abs(a - b) < 1e-5 for imported, raw in zip(core_coordinates, raw_point_positions)
               for a, b in zip(imported, raw)), 'Imported point positions changed'
    assert sum(len(obj.data.polygons) for obj in objects) == expected_triangles
    imported_normals = [obj.matrix_world.to_3x3() @ value.vector
                        for obj in objects if obj.data.polygons for value in obj.data.corner_normals]
    normal_coordinates = [(n.x, n.z, -n.y) for n in imported_normals]
    assert len(normal_coordinates) == len(raw_normals), 'Imported shell corner normals missing'
    max_normal_difference = max(abs(a - b) for imported, raw in zip(normal_coordinates, raw_normals)
                                for a, b in zip(imported, raw))
    # Blender's custom loop-normal storage can quantize the authored direction.
    assert max_normal_difference < 0.003, 'Authored smooth glass normals lost during import'
    bounds = {key: [operation(p[axis] for p in coordinates) for axis in range(3)]
              for key, operation in [('min', min), ('max', max)]}
    assert all(abs(bounds[key][axis] - operation(p[axis] for p in raw_positions)) < 1e-5
               for key, operation in [('min', min), ('max', max)] for axis in range(3))
    assert abs(bounds['min'][1]) < 1e-6 and abs(bounds['max'][1] - 1.89) < 1e-5

    attributes = [attribute for obj in core_objects for attribute in list(obj.data.color_attributes)[:1]]
    assert all(attribute.domain == 'POINT' for attribute in attributes), 'Native color domain changed'
    colors = [tuple(value.color[:3]) for attribute in attributes for value in attribute.data]
    types = {attribute.data_type for attribute in attributes}
    assert len(types) == 1 and types <= {'BYTE_COLOR', 'FLOAT_COLOR'}
    assert len(colors) == len(raw_colors), 'Vertex colors missing after import'
    predicted = imported_color_reference(raw_colors, next(iter(types)))
    assert all(abs(a - b) < 1e-5 for imported, reference in zip(colors, predicted)
               for a, b in zip(imported, reference)), 'Imported color transfer mismatch'
    assert all(math.isfinite(c) and 0 <= c <= 1 for color in colors for c in color)
    assert all(abs(value.color[3] - 1) < 1e-6 for attribute in attributes for value in attribute.data), 'Point alpha changed'
    color_transfer_error = max(abs(a - b) for imported, reference in zip(colors, predicted)
                               for a, b in zip(imported, reference))
    linear_quantization_error = max(abs(a - b) for imported, raw in zip(colors, raw_colors)
                                    for a, b in zip(imported, raw))
    srgb_quantization_error = max(abs(linear_to_srgb(a) - linear_to_srgb(b))
                                 for imported, raw in zip(colors, raw_colors)
                                 for a, b in zip(imported, raw))
    if 'BYTE_COLOR' in types:
        # Half a byte-step from rounding plus the converter's approximation;
        # one full sRGB code step is an explicit bound, not a linear-RGB slack.
        assert srgb_quantization_error <= 1 / 255 + 1e-7, 'Color loss exceeds byte quantization'
    materials = []
    for obj in objects:
        for material in obj.data.materials:
            bsdf = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None) if material and material.node_tree else None
            roughness_factor = imported_material_factor(bsdf.inputs['Roughness']) if bsdf else None
            if bsdf:
                assert abs(roughness_factor - glass['pbrMetallicRoughness']['roughnessFactor']) < 1e-6, 'Glass roughness multiplier lost'
                assert imported_material_factor(bsdf.inputs['Metallic']) == 0, 'Glass metallic multiplier changed'
                normal = bsdf.inputs['Normal'].links[0].from_node
                assert normal.type == 'NORMAL_MAP' and abs(normal.inputs['Strength'].default_value - glass['normalTexture']['scale']) < 1e-6, 'Micro-normal scale changed'
            materials.append({'name': material.name if material else None,
                              'ior': bsdf.inputs['IOR'].default_value if bsdf else None,
                              'transmission': bsdf.inputs['Transmission Weight'].default_value if bsdf else None,
                              'roughnessFactor': roughness_factor,
                              'roughnessTextureLinked': bsdf.inputs['Roughness'].is_linked if bsdf else None,
                              'embeddedImageNodes': sum(node.type == 'TEX_IMAGE' for node in material.node_tree.nodes) if material and material.node_tree else 0})
    assert any(m['transmission'] and m['transmission'] > 0.95 and abs(m['ior'] - 1.5) < 1e-5 for m in materials)
    assert any(m['embeddedImageNodes'] >= 2 for m in materials), 'Embedded material maps lost'
    reports.append({'file': filename, 'sha256': hashlib.sha256(binary).hexdigest(),
                    'triangles': expected_triangles, 'nativePoints': len(colors), 'bounds': bounds,
                    'importedColorStorage': sorted(types), 'maxNormalDifference': max_normal_difference,
                    'colorTransferMaxError': color_transfer_error,
                    'sourceLinearColorMaxError': linear_quantization_error,
                    'sourceSrgbColorMaxErrorInByteSteps': srgb_quantization_error * 255,
                    'materials': materials})

report = {'loader': 'Blender glTF importer', 'version': list(bpy.app.version), 'checksPassed': True,
          'assets': reports, 'pointPolicy': 'Native colored POINTS are loose vertices; a point renderer is required. No solid branch surface is claimed.',
          'colorPolicy': 'Every imported position and color checked against GLB bytes. BYTE_COLOR uses an independent installed-Blender transfer reference with 1e-5 matching tolerance; source loss is separately bounded to one sRGB byte step and reported.'}
with open(os.path.join(assets, 'blue-branch-pawn-loader-report.json'), 'w') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print(json.dumps({'checksPassed': True, 'assets': reports}))
