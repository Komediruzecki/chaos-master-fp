FROM denoland/deno:2.9.4

# Vulkan/Mesa libraries required for Deno WebGPU (Dawn/WGPU backend), plus
# python3 for the RunPod serverless handler shim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libegl1-mesa-dev \
    libgl1-mesa-dri \
    libgles2-mesa-dev \
    libvulkan1 \
    mesa-vulkan-drivers \
    libglvnd0 \
    libglvnd-dev \
    libxkbcommon0 \
    libwayland-client0 \
    libxcb1 \
    libxcb-render0 \
    libxcb-shm0 \
    libxcb-xfixes0 \
    vulkan-tools \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# RunPod serverless SDK + S3 client for the handler. Kept in its own layer so
# source edits below never re-install Python deps.
RUN pip3 install --no-cache-dir --break-system-packages runpod boto3

# NVIDIA container toolkit graphics passthrough configuration
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute

# NVIDIA Vulkan ICD configuration injection
RUN mkdir -p /etc/vulkan/icd.d && \
    echo '{' > /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '    "file_format_version" : "1.0.0",' >> /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '    "ICD": {' >> /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '        "library_path": "libGLX_nvidia.so.0",' >> /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '        "api_version" : "1.3"' >> /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '    }' >> /etc/vulkan/icd.d/nvidia_icd.json && \
    echo '}' >> /etc/vulkan/icd.d/nvidia_icd.json

WORKDIR /workers/render-worker

# Warm the Deno npm/jsr cache in a layer keyed only on deno.json, so
# shader-source edits don't re-download dependencies. The import map's bare
# names point at local wrapper files (not copied yet), so the warm list is
# generated from the registry-backed values only.
COPY workers/render-worker/deno.json .
RUN deno eval 'const imports = JSON.parse(Deno.readTextFileSync("deno.json")).imports; const specs = [...new Set([...Object.values(imports), "jsr:@std/cli/parse-args"])].filter((v) => v.startsWith("npm:") || v.startsWith("jsr:")).map((v) => (v.endsWith("/") ? v.slice(0, -1) : v)); Deno.writeTextFileSync("/tmp/warm.ts", specs.map((s) => `import "${s}";`).join("\n"));' \
    && deno cache /tmp/warm.ts \
    && rm /tmp/warm.ts

COPY workers/render-worker/src/ ./src/
COPY workers/render-worker/handler.py .
COPY packages/app/src/ /packages/app/src/
COPY packages/core/src/ /packages/core/src/

# Cache the full module graph (also proves all imports resolve at build time,
# instead of on the first billable cold start).
RUN deno cache --unstable-webgpu --sloppy-imports --config deno.json src/cli.ts src/server.ts

EXPOSE 8787

# Two run modes:
#  - RunPod SERVERLESS (default): the Python shim consumes queue jobs and
#    invokes the Deno CLI per render.
#      docker run ... chaos-render-worker
#  - Self-hosted POD (HTTP server on 8787): set the entrypoint back to deno.
#      docker run --device /dev/dri -p 8787:8787 \
#        --entrypoint deno chaos-render-worker \
#        run --unstable-webgpu --allow-ffi --sloppy-imports --allow-net \
#        --allow-env --allow-read --allow-write --allow-run src/server.ts
ENTRYPOINT []
CMD ["python3", "-u", "handler.py"]
