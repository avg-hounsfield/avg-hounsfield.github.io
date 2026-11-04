#!/usr/bin/env python3
"""
Export the retrained student to the browser bundle, the same way the previous
student was exported (optimum ONNX export, dynamic INT8 quantisation), so
js/embedding-search.js loads it unchanged:

  models/student-radiology/onnx/model_quantized.onnx
  models/student-radiology/{config.json, tokenizer.json, tokenizer_config.json,
                            special_tokens_map.json, vocab.txt, manifest.json}

Checks before copying: the INT8 model's embeddings agree with the PyTorch
student on a few texts, and the file is no larger than the bundle it replaces.

Usage:
  python tools/semantic_fallback_export.py --student tools/cache/distill/student_v4 [--deploy] [--bundle-dir DIR]
Without --deploy or --bundle-dir the ONNX files are written to <student>/onnx only.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEPLOY_DIR = ROOT / "models" / "student-radiology"
BUNDLE_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt"]


def export_onnx(student: Path, onnx_dir: Path):
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer
    print(f"exporting {student} to ONNX", flush=True)
    model = ORTModelForFeatureExtraction.from_pretrained(str(student), export=True)
    onnx_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(onnx_dir))
    AutoTokenizer.from_pretrained(str(student)).save_pretrained(str(onnx_dir))
    print(f"  fp32 {onnx_dir / 'model.onnx'}: {(onnx_dir / 'model.onnx').stat().st_size:,} bytes", flush=True)


def quantize_int8(onnx_dir: Path, per_channel: bool = False):
    from optimum.onnxruntime import ORTQuantizer
    from optimum.onnxruntime.configuration import AutoQuantizationConfig
    print(f"quantising to INT8 (dynamic, avx512_vnni recipe, {'per-channel' if per_channel else 'per-tensor'})", flush=True)
    quantizer = ORTQuantizer.from_pretrained(str(onnx_dir), file_name="model.onnx")
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=per_channel)
    quantizer.quantize(save_dir=str(onnx_dir), quantization_config=qconfig)
    q = onnx_dir / "model_quantized.onnx"
    print(f"  int8 {q}: {q.stat().st_size:,} bytes", flush=True)
    return q


def check_agreement(student: Path, onnx_dir: Path):
    """Cosine between the PyTorch student and the INT8 ONNX on sample texts."""
    import onnxruntime as ort
    from tokenizers import Tokenizer
    from sentence_transformers import SentenceTransformer
    texts = ["foot drop", "weak legs after epidural", "48yo M sudden cold pulseless leg",
             "Headache, sudden onset, severe. Adult. Initial imaging.", "child with limp and fever"]
    st = SentenceTransformer(str(student), device="cpu")
    ref = st.encode(texts, normalize_embeddings=True)
    tok = Tokenizer.from_file(str(onnx_dir / "tokenizer.json"))
    tok.enable_truncation(max_length=128)
    sess = ort.InferenceSession(str(onnx_dir / "model_quantized.onnx"), providers=["CPUExecutionProvider"])
    names = [i.name for i in sess.get_inputs()]
    cos = []
    for t, r in zip(texts, ref):
        ids = np.asarray([tok.encode(t).ids], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": np.ones_like(ids)}
        if "token_type_ids" in names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        out = sess.run(None, feeds)[0][0, 0]
        out = out / np.linalg.norm(out)
        cos.append(float(out @ r))
    print(f"  int8 vs fp32 cosine on {len(texts)} texts: min {min(cos):.4f} mean {np.mean(cos):.4f}", flush=True)
    return min(cos)


def deploy(onnx_dir: Path, student: Path, name: str, target: Path = DEPLOY_DIR):
    old = (target / "onnx" / "model_quantized.onnx")
    old_size = old.stat().st_size if old.exists() else None
    new_size = (onnx_dir / "model_quantized.onnx").stat().st_size
    if target == DEPLOY_DIR and old_size is not None and new_size > old_size:
        raise SystemExit(f"new INT8 model is larger ({new_size:,} > {old_size:,} bytes); not deploying")
    (target / "onnx").mkdir(parents=True, exist_ok=True)
    shutil.copy2(onnx_dir / "model_quantized.onnx", target / "onnx" / "model_quantized.onnx")
    for f in BUNDLE_FILES:
        shutil.copy2(onnx_dir / f, target / f)
    manifest = {
        "name": name,
        "base": "BAAI/bge-small-en-v1.5",
        "teacher": "bge_large_lora_v1 retriever (CoreGRAi): hard negatives and soft labels",
        "training": "data/eval/mined_phrasings.json train split; tools/semantic_fallback_train.py (gold positive + KD from the retriever, weight 0.5)",
        "indexes": "tools/build_semantic_index.py --encoder torch --corpus-format name_search",
        "dim": 384,
        "max_seq_length": 256,
        "pooling": "cls",
        "normalize": True,
        "files": {"int8": "onnx/model_quantized.onnx", "tokenizer": "tokenizer.json"},
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"deployed to {target} (int8 {new_size:,} bytes" + (f", was {old_size:,}" if old_size else "") + ")", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--student", required=True)
    ap.add_argument("--name", default="embed-student-v4")
    ap.add_argument("--deploy", action="store_true", help="copy the bundle into models/student-radiology")
    ap.add_argument("--bundle-dir", default=None, help="instead write the browser-layout bundle here (for comparing candidates)")
    ap.add_argument("--min-agreement", type=float, default=0.9,
                    help="lowest INT8-vs-fp32 cosine accepted (dynamic per-tensor INT8 of this model sits near 0.95-0.97)")
    ap.add_argument("--per-channel", action="store_true", help="per-channel weight scales (same file size, closer to fp32)")
    args = ap.parse_args()
    student = Path(args.student)
    onnx_dir = student / ("onnx_per_channel" if args.per_channel else "onnx")
    export_onnx(student, onnx_dir)
    quantize_int8(onnx_dir, args.per_channel)
    agreement = check_agreement(student, onnx_dir)
    if agreement < args.min_agreement:
        raise SystemExit(f"INT8 model disagrees with the student (min cosine {agreement:.4f})")
    if args.bundle_dir:
        deploy(onnx_dir, student, args.name, Path(args.bundle_dir))
    if args.deploy:
        deploy(onnx_dir, student, args.name)


if __name__ == "__main__":
    main()
