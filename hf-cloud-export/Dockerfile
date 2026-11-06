FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

# A GPU Space needs the graphics side of the NVIDIA driver (not only compute) and the Vulkan loader for Chromium's hardware WebGL; on a CPU Space both are harmless.
ENV NVIDIA_DRIVER_CAPABILITIES=all
RUN apt-get update && apt-get install -y --no-install-recommends libvulkan1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["python", "app.py"]
