---
title: 12toons Cloud Export
emoji: ☁️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

Renders 12toons videos on this machine instead of the user's own device/phone. See `../docs/CLOUD-EXPORT.md` for the full design.
This Space does one thing: watch the `cloudExports` node of the Realtime Database for pending jobs, open each one in a headless
Chromium, and let the 12toons website itself (the exact same code real exports use) do the actual rendering and upload.

On an NVIDIA-backed Space, the worker enables Chromium's hardware WebGL/Vulkan path automatically; CPU-only Spaces retain the
SwiftShader fallback. The website's cloud-render page splits a single video's frames across GPU-aware Web Workers. Optional
`CLOUD_RENDER_WORKERS` (1–8, default `0` for automatic selection) can override the frame-worker count for controlled benchmarks.
