FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/workspace/.cache/huggingface

WORKDIR /workspace

COPY trainer/lora_service/requirements.txt /workspace/requirements.txt
RUN pip install --upgrade pip && pip install -r /workspace/requirements.txt

COPY trainer/lora_service/app /workspace/app

EXPOSE 6060

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6060"]
