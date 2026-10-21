"""Build an isolated, packed Blender material study; never changes the book.

Run after build_surfaces.py. This is an authoring reference, not a browser or
headset acceptance capture. The runtime uses its own lighting and BRDF.
"""

import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def operation(nodes, links, kind, source, value):
    node = nodes.new("ShaderNodeMath")
    node.operation = kind
    links.new(source, node.inputs[0])
    node.inputs[1].default_value = value
    return node.outputs[0]


def material(name, image_path, color, roughness, metallic, height):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = metallic
    coords = nodes.new("ShaderNodeTexCoord")
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[3].default_value = 1 / 0.048
    links.new(coords.outputs["Object"], scale.inputs[0])
    image = bpy.data.images.load(str(image_path), check_existing=True)
    image.colorspace_settings.name = "Non-Color"
    image.pack()
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.extension = "REPEAT"
    tex.interpolation = "Linear"
    links.new(scale.outputs["Vector"], tex.inputs["Vector"])
    separate = nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    links.new(tex.outputs["Color"], separate.inputs["Color"])
    centered = operation(nodes, links, "SUBTRACT", separate.outputs["Green"], 0.5)
    variation = operation(nodes, links, "MULTIPLY", centered, 0.2)
    varied_roughness = operation(nodes, links, "ADD", variation, roughness)
    links.new(varied_roughness, shader.inputs["Roughness"])
    tint = nodes.new("ShaderNodeMixRGB")
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 1
    tint.inputs[1].default_value = (*color, 1)
    varied_albedo = operation(nodes, links, "MULTIPLY", separate.outputs["Blue"], 0.2)
    multiplier = operation(nodes, links, "ADD", varied_albedo, 0.9)
    links.new(multiplier, tint.inputs[2])
    links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1
    bump.inputs["Distance"].default_value = height
    links.new(separate.outputs["Red"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def cube(name, location, dimensions, mat, bevel):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Keep authored object coordinates in metres; no UV assumptions are needed.
    obj.data.materials.append(mat)
    modifier = obj.modifiers.new("Soft sample edge", "BEVEL")
    modifier.width = bevel
    modifier.segments = 4
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--deliverables-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if not args.evidence_dir.is_absolute() or not args.deliverables_dir.is_absolute():
        parser.error("Both output paths must be absolute registered-run paths")
    args.deliverables_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.world = bpy.data.worlds.new("Neutral studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.11, 0.12, 0.14, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.18
    settings = (
        ("paper", (0.030, 0.029, 0.032), 0.86, 0, 0.00010),
        ("leather", (0.030, 0.022, 0.018), 0.58, 0, 0.00024),
        ("metal", (0.95, 0.74, 0.40), 0.34, 1, 0.000018),
    )
    for index, (name, color, roughness, metallic, height) in enumerate(settings):
        mat = material(name, args.evidence_dir / f"{name}-linear-data.png", color, roughness, metallic, height)
        sample = cube(name.title(), ((index - 1) * 0.086, 0, 0.004), (0.076, 0.062, 0.006), mat, 0.002)
        # One mild tilt reveals the specular response without inventing geometry.
        sample.rotation_euler.x = 0.06
    floor = bpy.data.materials.new("Charcoal studio base")
    floor.use_nodes = True
    floor.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.011, 0.012, 0.014, 1)
    floor.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    cube("Studio", (0, 0, -0.004), (2, 2, 0.004), floor, 0.001)
    for name, location, energy, size, color in (
        ("Warm broad key", (-0.09, -0.08, 0.17), 0.15, 0.16, (1, 0.91, 0.78)),
        ("Cool strip", (0.04, 0.11, 0.09), 0.08, 0.10, (0.75, 0.86, 1)),
        ("Side fill", (0.15, -0.10, 0.10), 0.025, 0.12, (1, 1, 1)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        aim(obj, (0, 0, 0))
    data = bpy.data.cameras.new("Surface study camera")
    camera = bpy.data.objects.new("Surface study camera", data)
    scene.collection.objects.link(camera)
    camera.location = (0.008, -0.18, 0.22)
    aim(camera, (0, 0, 0))
    data.type = "ORTHO"
    data.ortho_scale = 0.285
    data.clip_start = 0.001
    scene.camera = camera
    scene.render.filepath = str(args.evidence_dir / "surface-blender-study.png")
    scene["purpose"] = "Authoring-only linear texture material study. Not the runtime renderer or a Quest acceptance image."
    bpy.ops.wm.save_as_mainfile(filepath=str(args.deliverables_dir / "almanac-surface-study.blend"))
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
