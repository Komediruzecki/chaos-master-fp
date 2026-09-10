"""RunPod serverless handler for chaos-master GPU renders.

Thin Python shim around the Deno renderer CLI (src/cli.ts): one job = one
subprocess render + one R2 upload. Mirrors the mercurypitch handler contract:

  input:  { flameJson, width, height, quality, seed }
  output: { imageKey, timings, cost } on success
          { error }                    on failure (the RunPod job still ends
                                        COMPLETED; the submitting worker treats
                                        output.error as failed and refunds)

R2 upload uses the S3 API (boto3). Required endpoint env:
  S3_BUCKET, S3_ENDPOINT_URL, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
Optional: S3_REGION (default auto), S3_KEY_PREFIX (default "renders"),
  RENDER_MAX_PIXELS (default 7680*4320), RENDER_TIMEOUT_SECS (default 280),
  RUNPOD_GPU_USD_PER_HR (cost accounting only).
"""

import json
import os
import subprocess
import tempfile
import time

import boto3
import runpod

# Deno WebGPU refuses single allocations above ~100MB; the accumulation
# buffer is 16 bytes/pixel, so ~5.1Mpx is the practical ceiling.
MAX_PIXELS = int(os.environ.get("RENDER_MAX_PIXELS", "5100000"))
RENDER_TIMEOUT_SECS = int(os.environ.get("RENDER_TIMEOUT_SECS", "280"))
KEY_PREFIX = os.environ.get("S3_KEY_PREFIX", "renders").strip("/")

_s3 = None


def s3_client():
    global _s3
    if _s3 is None:
        missing = [
            k
            for k in ("S3_ENDPOINT_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET")
            if not os.environ.get(k)
        ]
        if missing:
            raise RuntimeError(
                f"stage=upload: endpoint env not configured, missing {', '.join(missing)}"
            )
        _s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT_URL"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
            region_name=os.environ.get("S3_REGION", "auto"),
        )
    return _s3


MEMORY_ERROR_MARKERS = ("memory", "allocation", "oom")


def gpu_memory() -> str:
    """Free/used VRAM as reported by nvidia-smi, or a reason it is unknown.

    Attached to allocation failures: 'not enough memory left' is meaningless
    without knowing whether the GPU was actually full (leak//fragmentation
    across jobs on a reused worker) or whether the limit was elsewhere.
    """
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.free,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        return (out.stdout or out.stderr or "").strip().replace("\n", " | ") or "no output"
    except Exception as exc:  # noqa: BLE001 — diagnostics must never fail a job
        return f"unavailable ({exc})"


def host_memory() -> str:
    """Container RAM. wgpu reports OOM for HOST allocation failures too, so a
    'not enough memory left' with an empty GPU usually means the cgroup, not
    the card."""
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, _, v = line.partition(":")
                info[k] = v.strip()
        limit = "n/a"
        for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
            try:
                with open(path) as f:
                    limit = f.read().strip()
                break
            except OSError:
                continue
        return f"MemAvailable={info.get('MemAvailable', '?')} MemTotal={info.get('MemTotal', '?')} cgroupLimit={limit}"
    except Exception as exc:  # noqa: BLE001
        return f"unavailable ({exc})"


class RenderFailure(RuntimeError):
    """Render error that still carries the device context. A failure is the
    case where 'which GPU was this?' matters most, so backend/adapter travel
    with the exception into the job output."""

    def __init__(self, message: str, backend: str | None = None, adapter=None):
        super().__init__(message)
        self.backend = backend
        self.adapter = adapter


def render_png(flame_json: str, width: int, height: int, quality: float):
    """Run the Deno CLI renderer.

    Returns (png_bytes, backend, adapter) where backend is 'gpu' or 'cpu' and
    adapter is the WebGPU adapter dict the renderer reported — both travel back
    in the job output so a silent CPU fallback can never go unnoticed.

    A GPU memory/allocation failure retries once on the software Vulkan
    rasterizer (llvmpipe) — same policy as the pod server (server.ts).
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as flame_file:
        flame_file.write(flame_json)
        flame_path = flame_file.name
    out_path = flame_path.replace(".json", ".png")

    try:
        last_error = ""
        backend = "gpu"
        adapter = None
        for backend in ("gpu", "cpu"):
            env = dict(os.environ)
            if backend == "cpu":
                env["RENDER_WORKER_FORCE_CPU"] = "true"
                print(f"[handler] retrying on software Vulkan after: {last_error}")
            proc = subprocess.run(
                [
                    "deno",
                    "run",
                    "--unstable-webgpu",
                    "--allow-ffi",
                    "--allow-net",
                    "--allow-env",
                    "--allow-read",
                    "--allow-write",
                    "--allow-run",
                    "--sloppy-imports",
                    "src/cli.ts",
                    "--flame", flame_path,
                    "--out", out_path,
                    "--width", str(width),
                    "--height", str(height),
                    "--quality", str(quality),
                ],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                env=env,
                capture_output=True,
                text=True,
                timeout=RENDER_TIMEOUT_SECS,
            )
            # The CLI prints SUCCESS on stderr before exit; a Vulkan teardown
            # segfault after a successful write is a known non-issue — trust
            # the output file over the exit code (same rule as the pod server).
            adapter = None
            for line in (proc.stderr or "").splitlines():
                if line.startswith("ADAPTER:"):
                    try:
                        adapter = json.loads(line[len("ADAPTER:"):])
                    except ValueError:
                        adapter = {"raw": line[len("ADAPTER:"):][:200]}
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    return f.read(), backend, adapter
            tail = (proc.stderr or "").strip().splitlines()[-5:]
            last_error = " | ".join(tail) or f"exit {proc.returncode}"
            if any(m in last_error.lower() for m in MEMORY_ERROR_MARKERS):
                vram = gpu_memory()
                host = host_memory()
                print(f"[handler] allocation failure on {backend}; vram(used,free,total MiB)= {vram}; host {host}")
                last_error += f" [vram used,free,total MiB: {vram}] [host {host}]"
            if backend == "gpu" and any(
                m in last_error.lower() for m in MEMORY_ERROR_MARKERS
            ):
                continue
            break
        raise RenderFailure(
            f"stage=render: no output produced: {last_error}",
            backend=backend,
            adapter=adapter,
        )
    finally:
        for p in (flame_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


def handler(job):
    started = time.time()
    inp = job.get("input") or {}

    flame_json = inp.get("flameJson")
    if not flame_json or not isinstance(flame_json, str):
        return {"error": "flameJson (string) is required"}
    try:
        json.loads(flame_json)
    except ValueError:
        return {"error": "flameJson is not valid JSON"}

    width = int(inp.get("width") or 1920)
    height = int(inp.get("height") or 1080)
    quality = float(inp.get("quality") or 0.5)
    if width < 16 or height < 16 or width * height > MAX_PIXELS:
        return {"error": f"resolution out of bounds (max {MAX_PIXELS} pixels)"}
    if not (0.01 <= quality <= 1):
        return {"error": "quality must be within 0.01..1"}

    # The R2 key is derived from the submitting worker's job id so its
    # status/result routes can find the object without a round trip.
    job_id = str(inp.get("jobId") or job.get("id"))
    image_key = f"{KEY_PREFIX}/{job_id}.png"

    try:
        png, backend, adapter = render_png(flame_json, width, height, quality)
        render_done = time.time()
        print(
            f"[handler] job={job_id} rendered {len(png)} bytes in "
            f"{render_done - started:.1f}s on {backend} ({(adapter or {}).get('description', 'unknown adapter')})"
        )

        try:
            s3_client().put_object(
                Bucket=os.environ["S3_BUCKET"],
                Key=image_key,
                Body=png,
                ContentType="image/png",
            )
        except RuntimeError:
            raise
        except Exception as exc:  # noqa: BLE001 — boto errors become stage-tagged text
            raise RenderFailure(
                f"stage=upload: {exc}", backend=backend, adapter=adapter
            ) from exc
        uploaded = time.time()
        print(f"[handler] job={job_id} uploaded {image_key} in {uploaded - render_done:.1f}s")

        gpu_usd_per_hr = float(os.environ.get("RUNPOD_GPU_USD_PER_HR", "0") or 0)
        billed_secs = uploaded - started
        return {
            "imageKey": image_key,
            # Which device actually rendered this job. 'cpu' means the GPU
            # attempt failed and llvmpipe took over — visibly slower, and a
            # signal that something is wrong with the endpoint.
            "backend": backend,
            "adapter": adapter,
            "timings": {
                "totalMs": int(billed_secs * 1000),
                "renderMs": int((render_done - started) * 1000),
                "uploadMs": int((uploaded - render_done) * 1000),
            },
            "cost": {
                "gpu_usd_per_hr": gpu_usd_per_hr,
                "billed_secs": round(billed_secs, 2),
                "usd": round(gpu_usd_per_hr * billed_secs / 3600, 6),
            },
        }
    except subprocess.TimeoutExpired:
        return {"error": f"render timed out after {RENDER_TIMEOUT_SECS}s"}
    except RenderFailure as exc:
        print(f"[handler] job={job_id} FAILED on {exc.backend}: {exc}")
        return {
            "error": str(exc),
            "backend": exc.backend,
            "adapter": exc.adapter,
        }
    except Exception as exc:  # noqa: BLE001 — everything maps to output.error
        return {"error": str(exc)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
