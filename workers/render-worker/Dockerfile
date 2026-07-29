# Selects the app-bundle stage below, so it has to be declared before any FROM.
ARG CHROME_ENGINE=false

FROM denoland/deno:2.9.4 AS base

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

# ── The app bundle, conditionally ────────────────────────────────
# Only the chrome engine renders from the built app, so only a CHROME_ENGINE
# build should require `pnpm --filter chaos-master build` to have run. COPY
# cannot be made conditional on a build arg — but a FROM can, so these two
# stages differ only in whether they carry the bundle and the arg picks one.
# Without this, every `docker build` (including the CI job, which has no reason
# to build the app) fails on a missing packages/app/dist.
FROM base AS appdist-false
RUN mkdir -p /appdist

FROM base AS appdist-true
COPY packages/app/dist/ /appdist/

FROM appdist-${CHROME_ENGINE} AS appdist

# ── Chrome render engine (optional) ──────────────────────────────
# Build with --build-arg CHROME_ENGINE=true to include headless Chrome and the
# built app bundle, which together serve engine:'chrome' jobs (4K/8K — see
# docs/plans/headless-chrome-renderer-plan.md). Off by default: it adds Node,
# Chromium and ~1.5GB, and a Deno-only endpoint has no use for any of it.
FROM base

# Re-declared: a global ARG is visible to FROM lines only, so a stage that wants
# to read the value needs its own declaration.
ARG CHROME_ENGINE
ARG PLAYWRIGHT_VERSION=1.59.1
ENV CHROME_RENDER_ENABLED=${CHROME_ENGINE}
# Browsers land at a fixed path rather than root's HOME cache, so the runtime
# user cannot miss them.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

# playwright is installed into tools/ — NOT globally. The driver is an ESM
# module (.mjs) and ESM resolution does NOT consult NODE_PATH (that is
# CommonJS-only); it only walks node_modules upward from the importing file. A
# global install would resolve at build time and fail at render time. tools/ is
# also invisible to Deno, so this node_modules cannot confuse `deno cache`.
RUN if [ "$CHROME_ENGINE" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        nodejs npm ca-certificates fonts-liberation \
      && npm install --prefix /workers/render-worker/tools \
           playwright@${PLAYWRIGHT_VERSION} \
      && npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY workers/render-worker/src/ ./src/
COPY workers/render-worker/tools/ ./tools/
COPY workers/render-worker/handler.py .
COPY packages/app/src/ /packages/app/src/
COPY packages/core/src/ /packages/core/src/

# The built app bundle the Chrome engine renders with — empty on a Deno-only
# build (see the appdist stages above). 26MB with sourcemaps, so a Chrome-side
# stack trace stays readable. Baking it in couples the image to an app version,
# so tag Chrome-enabled images with it.
COPY --from=appdist /appdist/ /packages/app/dist/

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
