import json
import os
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from datasets import Dataset
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainerCallback, TrainingArguments
from trl import SFTTrainer


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_env(name: str, default: Dict[str, str]) -> Dict[str, str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except Exception:
        pass
    return default


DEFAULT_MODEL_ALIASES = {
    "llama3:8b": "meta-llama/Llama-3.1-8B-Instruct",
    "llama3.1:8b": "meta-llama/Llama-3.1-8B-Instruct",
    "qwen2.5:7b": "Qwen/Qwen2.5-7B-Instruct",
    "qwen2.5:0.5b": "Qwen/Qwen2.5-0.5B-Instruct",
}
MODEL_ALIASES = parse_json_env("LORA_MODEL_ALIASES_JSON", DEFAULT_MODEL_ALIASES)


class JobCreateRequest(BaseModel):
    provider: str = "generic-http"
    datasetPath: str
    datasetTier: str = "curated"
    baseModel: str = ""
    adapterName: str = "luna-adapter"
    outputDir: str
    hyperparameters: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class JobStateStore:
    def __init__(self, state_file: Path):
        self.state_file = state_file
        self.lock = threading.Lock()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        if not self.state_file.exists():
            self.state_file.write_text(json.dumps({"jobs": {}}, indent=2), encoding="utf-8")

    def _read(self) -> Dict[str, Any]:
        raw = self.state_file.read_text(encoding="utf-8").strip()
        if not raw:
            return {"jobs": {}}
        try:
            parsed = json.loads(raw)
        except Exception:
            return {"jobs": {}}
        if not isinstance(parsed, dict):
            return {"jobs": {}}
        parsed.setdefault("jobs", {})
        return parsed

    def _write(self, payload: Dict[str, Any]) -> None:
        self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def upsert(self, job_id: str, values: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            data = self._read()
            jobs = data.setdefault("jobs", {})
            current = jobs.get(job_id, {})
            current.update(values)
            jobs[job_id] = current
            data["updatedAt"] = now_iso()
            self._write(data)
            return current

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            data = self._read()
            return data.get("jobs", {}).get(job_id)

    def append_log(self, job_id: str, message: str, level: str = "info") -> Dict[str, Any]:
        with self.lock:
            data = self._read()
            jobs = data.setdefault("jobs", {})
            current = jobs.get(job_id, {})
            logs = current.get("logs", [])
            if not isinstance(logs, list):
                logs = []

            logs.append({
                "at": now_iso(),
                "level": str(level or "info"),
                "message": str(message or "").strip(),
            })
            current["logs"] = logs[-120:]
            jobs[job_id] = current
            data["updatedAt"] = now_iso()
            self._write(data)
            return current


def calculate_eta_seconds(elapsed_seconds: float, progress_ratio: float) -> Optional[int]:
    if progress_ratio <= 0 or progress_ratio >= 1:
        return None
    remaining = (elapsed_seconds * (1 - progress_ratio)) / progress_ratio
    if remaining < 0:
        return None
    return int(remaining)


class JobProgressCallback(TrainerCallback):
    def __init__(self, job_id: str, store: JobStateStore, started_ts: datetime):
        self.job_id = job_id
        self.store = store
        self.started_ts = started_ts

    def _elapsed_seconds(self) -> float:
        return max(0.0, (datetime.now(timezone.utc) - self.started_ts).total_seconds())

    def _update_progress(self, state) -> None:
        max_steps = int(getattr(state, "max_steps", 0) or 0)
        global_step = int(getattr(state, "global_step", 0) or 0)
        progress_ratio = 0.0
        if max_steps > 0:
            progress_ratio = min(1.0, max(0.0, global_step / max_steps))

        elapsed_seconds = self._elapsed_seconds()
        eta_seconds = calculate_eta_seconds(elapsed_seconds, progress_ratio)

        self.store.upsert(
            self.job_id,
            {
                "status": "running",
                "progress": {
                    "globalStep": global_step,
                    "maxSteps": max_steps,
                    "progressRatio": progress_ratio,
                    "progressPercent": round(progress_ratio * 100, 2),
                    "elapsedSeconds": int(elapsed_seconds),
                    "estimatedRemainingSeconds": eta_seconds,
                },
            },
        )

    def on_train_begin(self, args, state, control, **kwargs):
        self.store.append_log(self.job_id, "Training started", "info")
        self._update_progress(state)

    def on_step_end(self, args, state, control, **kwargs):
        self._update_progress(state)

    def on_log(self, args, state, control, logs=None, **kwargs):
        if isinstance(logs, dict) and logs:
            message = ", ".join([f"{k}={v}" for k, v in logs.items()])
            self.store.append_log(self.job_id, f"Trainer log: {message}", "debug")
        self._update_progress(state)


def sanitize_adapter_name(value: str) -> str:
    name = (value or "").strip().lower()
    cleaned = []
    for char in name:
        if char.isalnum() or char in ["-", "_", "."]:
            cleaned.append(char)
        else:
            cleaned.append("-")
    merged = "".join(cleaned)
    while "--" in merged:
        merged = merged.replace("--", "-")
    merged = merged.strip("-")
    return merged or "lora-adapter"


def normalize_model_id(raw_base_model: str) -> str:
    candidate = (raw_base_model or "").strip()
    if not candidate:
        candidate = os.getenv("LORA_DEFAULT_BASE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct").strip()

    mapped = MODEL_ALIASES.get(candidate.lower())
    if mapped:
        return mapped

    return candidate


def convert_jsonl_to_examples(dataset_path: Path) -> List[Dict[str, str]]:
    if not dataset_path.exists():
        raise FileNotFoundError(f"dataset not found: {dataset_path}")

    rows: List[Dict[str, str]] = []
    with dataset_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            messages = payload.get("messages") or []
            text_parts = []
            for msg in messages:
                role = str(msg.get("role", "user")).strip()
                content = str(msg.get("content", "")).strip()
                if not content:
                    continue
                text_parts.append(f"<{role}>: {content}")
            if text_parts:
                rows.append({"text": "\n".join(text_parts)})
    if not rows:
        raise ValueError("dataset has no usable message rows")
    return rows


def run_real_lora_training(job_id: str, req: JobCreateRequest, store: JobStateStore) -> None:
    try:
        started_ts = datetime.now(timezone.utc)
        store.upsert(job_id, {
            "status": "running",
            "startedAt": now_iso(),
            "progress": {
                "globalStep": 0,
                "maxSteps": 0,
                "progressRatio": 0,
                "progressPercent": 0,
                "elapsedSeconds": 0,
                "estimatedRemainingSeconds": None,
            },
        })
        store.append_log(job_id, "Preparing LoRA training job", "info")

        dataset_path = Path(req.datasetPath).resolve()
        output_dir = Path(req.outputDir).resolve()
        adapter_name = sanitize_adapter_name(req.adapterName)
        adapter_path = output_dir / adapter_name
        adapter_path.mkdir(parents=True, exist_ok=True)
        store.append_log(job_id, f"Adapter path: {adapter_path}", "info")

        base_model = normalize_model_id(req.baseModel)
        store.append_log(job_id, f"Base model: {base_model}", "info")

        examples = convert_jsonl_to_examples(dataset_path)
        hf_dataset = Dataset.from_list(examples)
        store.append_log(job_id, f"Loaded dataset samples: {len(examples)}", "info")

        learning_rate = float(req.hyperparameters.get("learningRate", 2e-4))
        epochs = int(req.hyperparameters.get("epochs", 1))
        batch_size = int(req.hyperparameters.get("batchSize", 1))
        rank = int(req.hyperparameters.get("rank", 16))
        alpha = int(req.hyperparameters.get("alpha", 32))
        dropout = float(req.hyperparameters.get("dropout", 0.05))

        device = "cuda" if torch.cuda.is_available() else "cpu"

        tokenizer = AutoTokenizer.from_pretrained(base_model, use_fast=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model_kwargs: Dict[str, Any] = {}
        if device == "cuda":
            model_kwargs["torch_dtype"] = torch.bfloat16
            model_kwargs["device_map"] = "auto"

        model = AutoModelForCausalLM.from_pretrained(base_model, **model_kwargs)

        peft_config = LoraConfig(
            r=rank,
            lora_alpha=alpha,
            lora_dropout=dropout,
            bias="none",
            task_type="CAUSAL_LM",
        )

        train_args = TrainingArguments(
            output_dir=str(adapter_path),
            learning_rate=learning_rate,
            num_train_epochs=epochs,
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=max(1, int(req.hyperparameters.get("gradientAccumulationSteps", 1))),
            logging_steps=max(1, int(req.hyperparameters.get("loggingSteps", 5))),
            save_strategy="epoch",
            fp16=(device == "cuda"),
            bf16=False,
            report_to=[],
            remove_unused_columns=False,
        )

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=hf_dataset,
            dataset_text_field="text",
            peft_config=peft_config,
            args=train_args,
            max_seq_length=int(req.hyperparameters.get("maxSeqLength", 1024)),
            callbacks=[JobProgressCallback(job_id=job_id, store=store, started_ts=started_ts)],
        )

        trainer.train()
        store.append_log(job_id, "Training loop completed. Saving adapter.", "info")
        trainer.model.save_pretrained(str(adapter_path))
        tokenizer.save_pretrained(str(adapter_path))

        summary = {
            "ok": True,
            "jobId": job_id,
            "status": "completed",
            "adapterPath": str(adapter_path),
            "baseModel": base_model,
            "datasetPath": str(dataset_path),
            "sampleCount": len(examples),
            "device": device,
            "finishedAt": now_iso(),
            "metadata": req.metadata,
            "hyperparameters": req.hyperparameters,
            "progress": {
                "globalStep": int(getattr(getattr(trainer, 'state', None), 'global_step', 0) or 0),
                "maxSteps": int(getattr(getattr(trainer, 'state', None), 'max_steps', 0) or 0),
                "progressRatio": 1.0,
                "progressPercent": 100.0,
                "elapsedSeconds": int((datetime.now(timezone.utc) - started_ts).total_seconds()),
                "estimatedRemainingSeconds": 0,
            },
        }

        (adapter_path / "training-summary.json").write_text(
            json.dumps(summary, indent=2),
            encoding="utf-8",
        )

        store.upsert(job_id, summary)
        store.append_log(job_id, "Job completed successfully", "info")
    except Exception as exc:
        store.append_log(job_id, f"Job failed: {exc}", "error")
        store.upsert(
            job_id,
            {
                "ok": False,
                "status": "failed",
                "error": str(exc),
                "trace": traceback.format_exc()[-6000:],
                "finishedAt": now_iso(),
            },
        )


state_file = Path(os.getenv("LORA_JOB_STATE_FILE", "/workspace/reports/trainer/jobs.json"))
store = JobStateStore(state_file)
app = FastAPI(title="Luna LoRA Trainer", version="1.0.0")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "lora-trainer",
        "timestamp": now_iso(),
        "cudaAvailable": bool(torch.cuda.is_available()),
        "stateFile": str(state_file),
    }


@app.post("/jobs")
def create_job(req: JobCreateRequest) -> Dict[str, Any]:
    job_id = f"job-{int(datetime.now().timestamp() * 1000)}"
    output_dir = Path(req.outputDir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    store.upsert(
        job_id,
        {
            "ok": True,
            "jobId": job_id,
            "status": "queued",
            "createdAt": now_iso(),
            "adapterName": sanitize_adapter_name(req.adapterName),
            "adapterPath": str((output_dir / sanitize_adapter_name(req.adapterName)).resolve()),
            "datasetPath": str(Path(req.datasetPath).resolve()),
            "datasetTier": req.datasetTier,
            "baseModel": normalize_model_id(req.baseModel),
            "hyperparameters": req.hyperparameters,
            "metadata": req.metadata,
            "progress": {
                "globalStep": 0,
                "maxSteps": 0,
                "progressRatio": 0,
                "progressPercent": 0,
                "elapsedSeconds": 0,
                "estimatedRemainingSeconds": None,
            },
            "logs": [
                {
                    "at": now_iso(),
                    "level": "info",
                    "message": "Job queued",
                }
            ],
        },
    )

    worker = threading.Thread(target=run_real_lora_training, args=(job_id, req, store), daemon=True)
    worker.start()

    current = store.get(job_id) or {}
    return {
        "ok": True,
        "jobId": job_id,
        "id": job_id,
        "status": current.get("status", "queued"),
        "adapterPath": current.get("adapterPath", ""),
    }


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> Dict[str, Any]:
    current = store.get(job_id)
    if not current:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    return {"ok": True, **current}
