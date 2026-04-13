FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    libgl1-mesa-glx libglib2.0-0 wget unzip git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir setuptools wheel Cython numpy
RUN pip3 install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu118
RUN pip3 install --no-cache-dir basicsr --no-deps
RUN pip3 install --no-cache-dir -r requirements.txt

# Download InsightFace buffalo_l model files individually
RUN mkdir -p /app/models/insightface/models/buffalo_l && \
    cd /app/models/insightface/models/buffalo_l && \
    curl -L -o 1k3d68.onnx "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/1k3d68.onnx" && \
    curl -L -o 2d106det.onnx "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/2d106det.onnx" && \
    curl -L -o det_10g.onnx "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/det_10g.onnx" && \
    curl -L -o genderage.onnx "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/genderage.onnx" && \
    curl -L -o w600k_r50.onnx "https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx"

# Download inswapper model
RUN curl -L -o /app/models/inswapper_128.onnx \
    "https://huggingface.co/ashleykleynhans/inswapper/resolve/main/inswapper_128.onnx"

# Download CodeFormer model
RUN mkdir -p /app/models/codeformer && \
    curl -L -o /app/models/codeformer/codeformer.pth \
    "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth"

# Download GFPGAN model
RUN mkdir -p /app/models/gfpgan && \
    curl -L -o /app/models/gfpgan/GFPGANv1.4.pth \
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth"

# Download parsing model
RUN mkdir -p /app/models/parsing && \
    curl -L -o /app/models/parsing/parsing_parsenet.pth \
    "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/parsing_parsenet.pth"

COPY . .

CMD ["python3", "-u", "handler.py"]
