# Starts the cloud worker's GPU-encoder server with libx264 standing in for NVENC (no GPU needed) and prints "<port> <token>" for the browser test.
import os, sys, time
os.environ["GPUENC_CODEC"] = "libx264"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "hf-cloud-export"))
import gpu_encode
enc = gpu_encode.get_encoder()
if not enc:
    print("UNAVAILABLE", flush=True); sys.exit(1)
print(enc.port, enc.new_job(), flush=True)
time.sleep(240)
