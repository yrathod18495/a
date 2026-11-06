"""
GPU video encoding for the cloud-export worker.

Why: Chrome has no NVENC on Linux, so the render page's own video encoder runs on the CPU. On a machine with a good GPU but only a few
CPU cores (a Colab T4 has 2) that CPU encoder is the bottleneck and the GPU sits idle. This module lets the render page hand its finished
frames to ffmpeg running here, and ffmpeg encodes them on the GPU (h264_nvenc). Nothing else about a render changes.

How it works (all on this machine, over a local WebSocket that needs a per-job token):
  * every frame worker of the render page opens a connection and, for each slice of the video it renders, sends one JSON "slice"
    message followed by one binary message per raw frame, then "end". Each slice has its own ffmpeg process, so slices never have to be
    put back in order in memory: they are joined at the end.
  * the page's control connection then sends the mixed audio ("audio" + one binary message) and "finish". The slices are joined with
    `-c copy` (no second encode), the audio is encoded to AAC, and the finished MP4 is sent back in 4 MB pieces; the page uploads it
    exactly like a video it encoded itself.
If anything is missing (no websockets package, no working GPU encoder) `get_encoder()` returns None and the render page keeps using its own
software encoder as before.
"""
import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import threading

VERSION = "jpeg-selftest-3"                 # printed by the Colab cell so an old copy kept in memory is noticed
CODEC = os.environ.get("GPUENC_CODEC", "h264_nvenc")          # libx264 can be set to try the whole path on a machine without a GPU
CHUNK = 4 * 1024 * 1024


def log(msg):
    print(f"[gpu-encode] {msg}", flush=True)


LEVEL = 0                                  # which encoder settings the start-up test found working (see selftest)


def codec_args(bitrate, level=None):
    level = LEVEL if level is None else level
    if CODEC.endswith("nvenc"):
        if level == 0:
            return ["-preset", "p4", "-tune", "hq", "-rc", "vbr", "-b:v", str(bitrate), "-maxrate", str(int(bitrate * 1.25)),
                    "-bufsize", str(int(bitrate * 2)), "-profile:v", "high"]
        if level == 1:                       # older ffmpeg / driver: the older preset names, no tuning
            return ["-preset", "fast", "-b:v", str(bitrate), "-maxrate", str(int(bitrate * 1.25)), "-bufsize", str(int(bitrate * 2))]
        return ["-b:v", str(bitrate)]
    return ["-preset", "ultrafast", "-b:v", str(bitrate)]


def selftest():
    """Runs the REAL path once at start-up (JPEG frames in, the chosen encoder out) with each set of encoder settings until one works.
    Listing an encoder is not enough: NVENC can exist and still refuse the settings of an older ffmpeg or a different driver."""
    global LEVEL
    if not shutil.which("ffmpeg"):
        log("ffmpeg is not installed")
        return False
    try:
        gen = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=40", "-frames:v", "4",
                              "-f", "image2pipe", "-c:v", "mjpeg", "-"], capture_output=True, timeout=30)
        if gen.returncode != 0 or not gen.stdout:
            log("ffmpeg could not make test JPEG frames: " + gen.stderr.decode("utf-8", "replace")[-300:])
            return False
        levels = 3 if CODEC.endswith("nvenc") else 1
        for level in range(levels):
            r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", "40", "-i", "-", "-an",
                                "-c:v", CODEC, *codec_args(8_000_000, level), "-g", "80", "-bf", "0", "-pix_fmt", "yuv420p", "-f", "null", "-"],
                               input=gen.stdout, capture_output=True, timeout=60)
            if r.returncode == 0:
                LEVEL = level
                log(f"encoder test passed with {CODEC} settings level {level}")
                return True
            log(f"encoder test failed with {CODEC} settings level {level}: " + r.stderr.decode("utf-8", "replace")[-400:])
    except Exception as e:
        log(f"encoder test crashed: {e!r}")
    return False


encoder_works = selftest                   # the old name, still used by older Colab cells


class GpuEncoder:
    def __init__(self):
        self.jobs = {}                      # token -> working directory
        self.port = None
        self._ready = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        self._ready.wait(10)

    def new_job(self):
        import secrets
        token = secrets.token_urlsafe(18)
        self.jobs[token] = tempfile.mkdtemp(prefix="gpuenc-")
        return token

    def end_job(self, token):
        folder = self.jobs.pop(token, None)
        if folder:
            shutil.rmtree(folder, ignore_errors=True)

    # ---------------------------------------------------------------- server
    def _run(self):
        asyncio.run(self._serve())

    async def _serve(self):
        try:
            from websockets.asyncio.server import serve
        except ImportError:                  # older websockets
            from websockets import serve
        # compression=None: per-message deflate of raw video would cost far more CPU than it saves; max_size=None: one message is one frame
        async with serve(self._handle, "127.0.0.1", 0, max_size=None, compression=None, ping_interval=None) as server:
            self.port = server.sockets[0].getsockname()[1]
            self._ready.set()
            await asyncio.Future()

    async def _handle(self, ws):
        state = {"proc": None, "slice": None, "audio_next": False, "folder": None, "err": None, "frames": 0, "bytes": 0}
        try:
            hello = json.loads(await ws.recv())
            folder = self.jobs.get(hello.get("token"))
            if hello.get("t") != "hello" or not folder:
                await ws.close(1008, "bad token")
                return
            state["folder"] = folder
            await ws.send(json.dumps({"t": "ready", "codec": CODEC}))
            async for message in ws:
                if isinstance(message, bytes):
                    if state["audio_next"]:
                        state["audio_next"] = False
                        with open(os.path.join(folder, "audio.f32"), "wb") as f:
                            f.write(message)
                    elif state["proc"] and state["proc"].stdin:
                        state["frames"] += 1; state["bytes"] += len(message)
                        state["proc"].stdin.write(message)
                        await state["proc"].stdin.drain()
                    continue
                msg = json.loads(message)
                kind = msg.get("t")
                if kind == "slice":
                    await self._start_slice(state, msg)
                elif kind == "end":
                    await ws.send(json.dumps(await self._end_slice(state, msg)))
                elif kind == "audio":
                    state["audio_next"] = True
                elif kind == "finish":
                    await self._finish(ws, folder, msg)
        except Exception as e:
            err = ""
            proc = state["proc"]
            if proc and proc.returncode is None:
                proc.kill()
            if state["err"] is not None:
                try:
                    err = (await asyncio.wait_for(state["err"], 2)).decode("utf-8", "replace")[-500:]
                except Exception:
                    pass
            log(f"connection ended after {state['frames']} frames ({state['bytes']} bytes) of slice {state['slice']}: {e!r} | ffmpeg said: {err or '(nothing)'}")
            try:
                await ws.send(json.dumps({"t": "error", "error": err or repr(e)}))
            except Exception:
                pass
        finally:
            proc = state["proc"]
            if proc and proc.returncode is None:
                proc.kill()

    async def _start_slice(self, state, msg):
        path = os.path.join(state["folder"], f"slice-{int(msg['id'])}.mp4")
        w, h, fps = int(msg["w"]), int(msg["h"]), int(msg["fps"])
        if msg["pix"] == "mjpeg":
            # one JPEG per frame (the render page compresses each frame: raw frames are 3.7 MB at 720p, far too much to move at 40+ fps on 2 CPU cores)
            source = ["-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(fps), "-i", "-"]
        else:
            source = ["-f", "rawvideo", "-pix_fmt", str(msg["pix"]), "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *source,
               "-an", "-c:v", CODEC, *codec_args(int(msg["bitrate"])), "-g", str(fps * 2), "-bf", "0", "-pix_fmt", "yuv420p", path]
        state["proc"] = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        state["slice"] = int(msg["id"]); state["frames"] = 0; state["bytes"] = 0
        state["err"] = asyncio.ensure_future(state["proc"].stderr.read())          # read while it runs, so ffmpeg's complaint is never lost

    async def _end_slice(self, state, msg):
        proc = state["proc"]
        if not proc:
            return {"t": "sliceDone", "id": msg.get("id"), "ok": False, "error": "no slice"}
        proc.stdin.close()
        err = (await state["err"]).decode("utf-8", "replace")[-400:]
        code = await proc.wait()
        state["proc"] = None
        return {"t": "sliceDone", "id": msg.get("id"), "ok": code == 0, "error": err if code else ""}

    async def _finish(self, ws, folder, msg):
        ids = [int(i) for i in msg.get("slices", [])]
        listing = os.path.join(folder, "list.txt")
        with open(listing, "w") as f:
            for i in ids:
                f.write(f"file '{os.path.join(folder, f'slice-{i}.mp4')}'\n")
        out = os.path.join(folder, "final.mp4")
        audio = os.path.join(folder, "audio.f32")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listing]
        if os.path.exists(audio):
            cmd += ["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k"]
        cmd += ["-c:v", "copy", "-movflags", "+faststart", out]
        proc = await asyncio.create_subprocess_exec(*cmd, stderr=asyncio.subprocess.PIPE)
        err = (await proc.stderr.read()).decode("utf-8", "replace")[-400:]
        if await proc.wait() != 0 or not os.path.exists(out):
            await ws.send(json.dumps({"t": "final", "ok": False, "error": err}))
            return
        size = os.path.getsize(out)
        await ws.send(json.dumps({"t": "final", "ok": True, "size": size}))
        with open(out, "rb") as f:
            while True:
                piece = f.read(CHUNK)
                if not piece:
                    break
                await ws.send(piece)


_encoder = None
_checked = False
_lock = threading.Lock()


def get_encoder():
    """The shared encoder server, or None when GPU encoding is switched off (GPU_ENCODE=0) or unavailable on this machine."""
    global _encoder, _checked
    with _lock:                              # two jobs can ask at the same moment: only one server is started
        if _checked:
            return _encoder
        _checked = True
        if os.environ.get("GPU_ENCODE", "0") != "1":          # OFF unless asked for: on a 2-core machine it measured SLOWER than the browser encoder (see docs/CLOUD-EXPORT.md)
            return None
        try:
            import websockets  # noqa: F401
        except ImportError:
            log("the 'websockets' package is missing: GPU encoding is off (pip install websockets)")
            return None
        if not selftest():
            log(f"GPU encoding is off: ffmpeg could not encode the test frames with {CODEC}; the render page keeps its own encoder")
            return None
        _encoder = GpuEncoder()
        log(f"ready on 127.0.0.1:{_encoder.port} using {CODEC}")
        return _encoder
