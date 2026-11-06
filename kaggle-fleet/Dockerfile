# syntax=docker/dockerfile:1
# Hugging Face control plane and optional local CPU/GPU fallback renderer.
FROM nvidia/cuda:12.6.3-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=7860 \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics,video

WORKDIR /app

# Install Chromium runtime libraries once. Keep this layer before Python deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv python3-dev \
    ca-certificates curl \
    xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 \
    xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic \
    fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libwayland-client0 \
    libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 \
    libvulkan1 vulkan-tools libgl1 libegl1 libgles2 \
    && python3 -m venv /opt/venv \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/requirements.txt

# Do not use --with-deps here: apt dependencies were installed above.
RUN python -m playwright install chromium

# App code is copied last, so code-only changes can reuse dependency/browser layers.
COPY render.py fleet.py fleet.html worker.py gpu_encode.py /app/

EXPOSE 7860
CMD ["python", "/app/render.py"]
