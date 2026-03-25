#!/usr/bin/env python3
"""Finetuning script using Unsloth.

Supports SFT (Supervised Fine-Tuning) and GRPO (Group Relative Policy Optimization)
via Unsloth's FastLanguageModel + HuggingFace TRL trainers.
Emits JSON line events to stdout for SSE streaming.

Uses PYTHONPATH from env to find packages in the finetune venv.
"""

import argparse
import json
import os
import sys
import time

# Ensure our venv packages take priority
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
FINETUNE_VENV = os.path.join(PROJECT_DIR, "venvs", "finetune")
SITE_PACKAGES = ""
for pyver in ['python3.10', 'python3.12', 'python3.11']:
    candidate = os.path.join(FINETUNE_VENV, "lib", pyver, "site-packages")
    if os.path.isdir(candidate):
        SITE_PACKAGES = candidate
        sys.path.insert(0, candidate)
        break
else:
    if os.path.isdir(FINETUNE_VENV):
        SITE_PACKAGES = FINETUNE_VENV
        sys.path.insert(0, FINETUNE_VENV)


def emit(msg_type, message, progress=None, **kwargs):
    """Emit a JSON progress line to stdout."""
    obj = {"type": msg_type, "message": message}
    if progress is not None:
        obj["progress"] = round(progress, 3)
    obj.update(kwargs)
    print(json.dumps(obj), flush=True)


def check_gpu():
    """Verify GPU is available and report device info."""
    try:
        import torch
        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            emit("info", f"GPU detected: {device_name} ({vram:.1f} GB VRAM)")
            return True
        else:
            emit("warning", "No GPU detected. Training will run on CPU (much slower).")
            return False
    except ImportError:
        emit("warning", "PyTorch not found. Cannot check GPU.")
        return False


def detect_chat_template(model_name):
    """Auto-detect the chat template based on model name."""
    lower = model_name.lower()
    if "llama-3" in lower or "llama3" in lower:
        return "llama-3.1"
    if "llama" in lower:
        return "llama-3.1"
    if "qwen" in lower:
        return "qwen-2.5"
    if "mistral" in lower:
        return "mistral"
    if "phi" in lower:
        return "phi-4"
    if "gemma" in lower:
        return "gemma"
    if "deepseek" in lower:
        return "deepseek-v3"
    if "smollm" in lower or "smol" in lower:
        return "chatml"
    return "chatml"


def detect_dataset_format(dataset_path):
    """Detect whether a local dataset is alpaca or sharegpt format."""
    try:
        with open(dataset_path, "r") as f:
            first_line = f.readline().strip()
            if first_line.startswith("["):
                # JSON array -- read entire file
                f.seek(0)
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    sample = data[0]
                else:
                    return "alpaca"
            else:
                sample = json.loads(first_line)

            if isinstance(sample, dict):
                if "conversations" in sample or "messages" in sample:
                    return "sharegpt"
            return "alpaca"
    except Exception:
        return "alpaca"


def load_dataset_from_path(dataset_path):
    """Load a local JSON/JSONL dataset file."""
    from datasets import Dataset

    ext = os.path.splitext(dataset_path)[1].lower()
    if ext == ".jsonl":
        records = []
        with open(dataset_path, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        return Dataset.from_list(records)
    else:
        with open(dataset_path, "r") as f:
            data = json.load(f)
        if isinstance(data, list):
            return Dataset.from_list(data)
        raise ValueError(f"Expected a JSON array in {dataset_path}")


def convert_alpaca_to_messages(examples):
    """Convert alpaca format (instruction/input/output) to messages format for SFT."""
    all_messages = []
    instructions = examples.get("instruction", [])
    inputs = examples.get("input", [])
    outputs = examples.get("output", [])

    for i in range(len(instructions)):
        instruction = instructions[i] if i < len(instructions) else ""
        inp = inputs[i] if i < len(inputs) else ""
        out = outputs[i] if i < len(outputs) else ""

        user_content = instruction
        if inp:
            user_content += f"\n{inp}"

        messages = [
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": out},
        ]
        all_messages.append(messages)

    return {"messages": all_messages}


def convert_sharegpt_to_messages(examples):
    """Convert sharegpt format (conversations) to messages format."""
    all_messages = []
    # Try 'conversations' key first, then 'messages'
    convos = examples.get("conversations", examples.get("messages", []))

    for convo in convos:
        messages = []
        if isinstance(convo, list):
            for turn in convo:
                role = turn.get("role", turn.get("from", "user"))
                content = turn.get("content", turn.get("value", ""))
                # Normalize roles
                if role in ("human", "user"):
                    role = "user"
                elif role in ("gpt", "assistant", "bot"):
                    role = "assistant"
                elif role == "system":
                    role = "system"
                else:
                    role = "user"
                messages.append({"role": role, "content": content})
        all_messages.append(messages)

    return {"messages": all_messages}


def build_reward_functions(reward_type):
    """Build reward functions for GRPO training."""
    import re as _re

    reward_funcs = []

    if reward_type == "length" or reward_type == "custom":
        def length_reward(completions, **kwargs):
            """Reward longer, more detailed responses."""
            return [min(len(c) / 500.0, 2.0) for c in completions]
        reward_funcs.append(length_reward)

    if reward_type == "correctness" or reward_type == "custom":
        def correctness_reward(completions, **kwargs):
            """Reward responses that contain structured answer markers."""
            rewards = []
            for c in completions:
                score = 0.0
                if "<answer>" in c and "</answer>" in c:
                    score += 1.5
                elif any(marker in c.lower() for marker in ["the answer is", "therefore", "thus", "in conclusion"]):
                    score += 0.8
                if len(c.strip()) > 20:
                    score += 0.2
                rewards.append(score)
            return rewards
        reward_funcs.append(correctness_reward)

    if reward_type == "format" or reward_type == "custom":
        def format_reward(completions, **kwargs):
            """Reward well-structured output with proper formatting."""
            rewards = []
            for c in completions:
                score = 0.0
                # Has numbered lists or bullet points
                if _re.search(r"^\s*[\d]+\.", c, _re.MULTILINE) or _re.search(r"^\s*[-*]", c, _re.MULTILINE):
                    score += 0.5
                # Has paragraphs (multiple newlines)
                if c.count("\n\n") >= 1:
                    score += 0.3
                # Not too short
                if len(c.strip()) > 50:
                    score += 0.2
                rewards.append(score)
            return rewards
        reward_funcs.append(format_reward)

    if not reward_funcs:
        # Fallback: simple length reward
        def default_reward(completions, **kwargs):
            return [min(len(c) / 500.0, 1.0) for c in completions]
        reward_funcs.append(default_reward)

    return reward_funcs


class ProgressCallback:
    """TrainerCallback that emits JSON progress events."""

    def __init__(self, total_steps_estimate=0):
        self.total_steps_estimate = total_steps_estimate
        self.last_log_time = 0

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is None:
            return

        step = state.global_step
        total = state.max_steps or self.total_steps_estimate
        loss = logs.get("loss")
        lr = logs.get("learning_rate", 0)
        epoch = logs.get("epoch", 0)

        if loss is not None and total > 0:
            train_pct = step / total * 0.85 + 0.10
            emit("loss", f"Step {step}/{total}",
                 progress=train_pct, step=step,
                 loss=round(loss, 4), learning_rate=lr, epoch=round(epoch, 2))
        elif total > 0:
            train_pct = step / total * 0.85 + 0.10
            emit("progress", f"Step {step}/{total}", progress=train_pct)


def make_callback_class():
    """Create a TrainerCallback subclass dynamically (required by HF Trainer)."""
    from transformers import TrainerCallback

    class UnslothProgressCallback(TrainerCallback):
        def __init__(self):
            self.inner = ProgressCallback()

        def on_log(self, args, state, control, logs=None, **kwargs):
            self.inner.on_log(args, state, control, logs=logs, **kwargs)

        def on_train_begin(self, args, state, control, **kwargs):
            self.inner.total_steps_estimate = state.max_steps or 0
            emit("progress", f"Training started — {state.max_steps} steps", progress=0.10)

        def on_epoch_begin(self, args, state, control, **kwargs):
            epoch = state.epoch or 0
            emit("log", f"Epoch {int(epoch) + 1}/{args.num_train_epochs}")

    return UnslothProgressCallback


def main():
    parser = argparse.ArgumentParser(description="Unsloth Finetuning (SFT / GRPO)")
    parser.add_argument("--model", required=True, help="HuggingFace repo ID")
    parser.add_argument("--dataset", required=True, help="HF dataset ID or local path")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--finetuning-type", choices=["lora", "qlora", "full"], default="qlora")
    parser.add_argument("--merge-adapters", action="store_true", default=False)
    # New: training mode and GRPO options
    parser.add_argument("--training-mode", choices=["sft", "grpo"], default="sft")
    parser.add_argument("--reward-type", choices=["length", "correctness", "format", "custom"], default="length")
    parser.add_argument("--num-generations", type=int, default=4)
    parser.add_argument("--grpo-beta", type=float, default=0.1)
    # VLM fine-tuning options
    parser.add_argument("--vlm", action="store_true", default=False,
                        help="Use FastVisionModel for vision-language model fine-tuning")
    parser.add_argument("--max-samples", type=int, default=0,
                        help="Subsample dataset to N examples (0 = use all)")
    args = parser.parse_args()

    finetune_output = os.path.join(args.output_dir, "finetune")
    os.makedirs(finetune_output, exist_ok=True)

    # Check GPU availability early
    has_gpu = check_gpu()

    ft_type_label = {"qlora": "QLoRA (4-bit)", "lora": "LoRA", "full": "Full"}[args.finetuning_type]
    mode_label = "GRPO (RL)" if args.training_mode == "grpo" else "SFT"
    emit("info", f"Starting {mode_label} + {ft_type_label} finetuning with Unsloth...")
    emit("progress", f"Model: {args.model}", 0.02)
    emit("progress", f"Dataset: {args.dataset}", 0.03)
    emit("progress", f"Mode: {mode_label} | Method: {ft_type_label} | Epochs: {args.epochs} | Batch: {args.batch_size} | LR: {args.learning_rate}", 0.04)

    # ---- Load model via Unsloth ----
    emit("progress", "Loading model with Unsloth...", 0.05)
    start_time = time.time()

    load_in_4bit = args.finetuning_type == "qlora"
    is_vlm = args.vlm

    if is_vlm:
        # ---- VLM: Load with FastVisionModel ----
        emit("info", "VLM mode: loading with FastVisionModel...")
        try:
            from unsloth import FastVisionModel
        except ImportError as e:
            emit("error", f"Failed to import FastVisionModel: {e}. Is unsloth[vision] installed?")
            sys.exit(1)

        try:
            model, tokenizer = FastVisionModel.from_pretrained(
                model_name=args.model,
                max_seq_length=args.max_seq_length,
                load_in_4bit=load_in_4bit,
                dtype=None,
            )
            emit("progress", "VLM model loaded successfully", 0.06)
        except Exception as e:
            emit("error", f"Failed to load VLM model: {e}")
            sys.exit(1)

        # Apply LoRA for VLM — includes vision layers
        if args.finetuning_type != "full":
            emit("progress", "Applying LoRA adapters (vision + language)...", 0.07)
            try:
                model = FastVisionModel.get_peft_model(
                    model,
                    r=args.lora_rank,
                    lora_alpha=args.lora_alpha,
                    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                                    "gate_proj", "up_proj", "down_proj"],
                    finetune_vision_layers=True,
                    finetune_language_layers=True,
                    finetune_attention_modules=True,
                    finetune_mlp_modules=True,
                    lora_dropout=0.05,
                    bias="none",
                    use_gradient_checkpointing="unsloth",
                    random_state=42,
                )
                emit("progress", f"VLM LoRA applied (rank={args.lora_rank})", 0.08)
            except Exception as e:
                emit("error", f"Failed to apply VLM LoRA: {e}")
                sys.exit(1)
    else:
        # ---- LLM: Load with FastLanguageModel ----
        try:
            from unsloth import FastLanguageModel
        except ImportError as e:
            emit("error", f"Failed to import Unsloth: {e}. Is it installed in the finetune venv?")
            sys.exit(1)

        try:
            model, tokenizer = FastLanguageModel.from_pretrained(
                model_name=args.model,
                max_seq_length=args.max_seq_length,
                load_in_4bit=load_in_4bit,
                dtype=None,  # auto-detect
            )
            emit("progress", "Model loaded successfully", 0.06)
        except Exception as e:
            emit("error", f"Failed to load model: {e}")
            sys.exit(1)

        # ---- Apply LoRA ----
        if args.finetuning_type != "full":
            emit("progress", "Applying LoRA adapters...", 0.07)
            try:
                model = FastLanguageModel.get_peft_model(
                    model,
                    r=args.lora_rank,
                    lora_alpha=args.lora_alpha,
                    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                                    "gate_proj", "up_proj", "down_proj"],
                    lora_dropout=0.05,
                    bias="none",
                    use_gradient_checkpointing="unsloth",
                    random_state=42,
                )
                emit("progress", f"LoRA applied (rank={args.lora_rank}, alpha={args.lora_alpha})", 0.08)
            except Exception as e:
                emit("error", f"Failed to apply LoRA: {e}")
                sys.exit(1)

    # ---- Apply chat template (LLM only — VLM uses its own processor) ----
    if not is_vlm:
        template_name = detect_chat_template(args.model)
        emit("log", f"Auto-detected chat template: {template_name}")
        try:
            from unsloth.chat_templates import get_chat_template
            tokenizer = get_chat_template(tokenizer, chat_template=template_name)
        except Exception as e:
            emit("log", f"Chat template '{template_name}' not available, using tokenizer default: {e}")

    # ---- Load & prepare dataset ----
    emit("progress", "Loading dataset...", 0.08)
    try:
        if os.path.exists(args.dataset):
            # Local file
            dataset = load_dataset_from_path(args.dataset)
            fmt = detect_dataset_format(args.dataset)
            emit("log", f"Loaded local dataset ({len(dataset)} samples, {fmt} format)")
        else:
            # HuggingFace Hub
            from datasets import load_dataset
            ds = load_dataset(args.dataset, split="train")
            dataset = ds
            # Detect format from columns
            cols = dataset.column_names
            if "conversations" in cols or "messages" in cols:
                fmt = "sharegpt"
            else:
                fmt = "alpaca"
            emit("log", f"Loaded HF dataset: {args.dataset} ({len(dataset)} samples, {fmt} format)")
    except Exception as e:
        emit("error", f"Failed to load dataset: {e}")
        sys.exit(1)

    # ---- Subsample if requested ----
    if args.max_samples > 0 and len(dataset) > args.max_samples:
        dataset = dataset.shuffle(seed=42).select(range(args.max_samples))
        emit("log", f"Subsampled dataset to {args.max_samples} examples")

    # ---- VLM dataset preparation ----
    vlm_data_collator = None
    if is_vlm:
        emit("progress", "Preparing VLM dataset with vision data collator...", 0.09)
        try:
            from unsloth import UnslothVisionDataCollator

            def convert_to_vlm_messages(example):
                """Convert various VLM dataset formats to Unsloth's expected format."""
                if "messages" in example:
                    msgs = example["messages"]
                    if isinstance(msgs, list) and len(msgs) > 0:
                        first = msgs[0]
                        if isinstance(first, dict) and "content" in first:
                            content = first["content"]
                            if isinstance(content, list):
                                return example  # Already multimodal format
                    # Text-only messages + separate image — convert
                    if "image" in example or "images" in example:
                        img = example.get("image") or (
                            example.get("images", [None])[0] if example.get("images") else None
                        )
                        if img is not None and isinstance(msgs, list) and len(msgs) > 0:
                            new_msgs = []
                            for msg in msgs:
                                if msg.get("role") == "user" and isinstance(msg.get("content"), str):
                                    new_msgs.append({
                                        "role": "user",
                                        "content": [
                                            {"type": "image", "image": img},
                                            {"type": "text", "text": msg["content"]},
                                        ],
                                    })
                                else:
                                    new_msgs.append(msg)
                            return {**example, "messages": new_msgs}
                elif "conversations" in example:
                    # Convert conversations to messages
                    convos = example["conversations"]
                    msgs = []
                    for turn in (convos if isinstance(convos, list) else []):
                        role = turn.get("role", turn.get("from", "user"))
                        content = turn.get("content", turn.get("value", ""))
                        if role in ("human", "user"):
                            role = "user"
                        elif role in ("gpt", "assistant", "bot"):
                            role = "assistant"
                        msgs.append({"role": role, "content": content})
                    result = {**example, "messages": msgs}
                    # Inject image if separate
                    if "image" in example and msgs:
                        first_content = msgs[0].get("content", "")
                        if isinstance(first_content, str):
                            result["messages"][0] = {
                                "role": msgs[0]["role"],
                                "content": [
                                    {"type": "image", "image": example["image"]},
                                    {"type": "text", "text": first_content},
                                ],
                            }
                    return result
                return example

            dataset = dataset.map(convert_to_vlm_messages)
            vlm_data_collator = UnslothVisionDataCollator(model, tokenizer)
            emit("log", f"VLM dataset prepared: {len(dataset)} samples")
        except Exception as e:
            emit("error", f"Failed to prepare VLM dataset: {e}")
            sys.exit(1)

    # Convert to messages format for SFT (LLM only — VLM uses data_collator)
    if is_vlm:
        pass  # VLM uses vlm_data_collator, no text formatting needed
    elif args.training_mode == "sft":
        emit("progress", "Formatting dataset for SFT...", 0.09)
        try:
            if fmt == "sharegpt":
                # Standardize sharegpt conversations to messages
                try:
                    from unsloth.chat_templates import standardize_sharegpt
                    dataset = standardize_sharegpt(dataset)
                except Exception:
                    dataset = dataset.map(convert_sharegpt_to_messages, batched=True,
                                          remove_columns=dataset.column_names)
            else:
                # Alpaca format -- convert to messages
                dataset = dataset.map(convert_alpaca_to_messages, batched=True,
                                      remove_columns=dataset.column_names)

            # Apply chat template to format messages
            def apply_template(examples):
                texts = []
                for msgs in examples["messages"]:
                    text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
                    texts.append(text)
                return {"text": texts}

            dataset = dataset.map(apply_template, batched=True)
            emit("log", f"Dataset formatted: {len(dataset)} samples with chat template")
        except Exception as e:
            emit("error", f"Failed to format dataset: {e}")
            sys.exit(1)
    else:
        # GRPO: needs 'prompt' column
        emit("progress", "Formatting dataset for GRPO...", 0.09)
        try:
            if fmt == "alpaca":
                def make_prompts(examples):
                    prompts = []
                    instructions = examples.get("instruction", [])
                    inputs = examples.get("input", [])
                    for i in range(len(instructions)):
                        instruction = instructions[i] if i < len(instructions) else ""
                        inp = inputs[i] if i < len(inputs) else ""
                        prompt = instruction
                        if inp:
                            prompt += f"\n{inp}"
                        prompts.append([{"role": "user", "content": prompt}])
                    return {"prompt": prompts}

                dataset = dataset.map(make_prompts, batched=True,
                                      remove_columns=dataset.column_names)
            else:
                # sharegpt: extract first user message as prompt
                def extract_prompts(examples):
                    prompts = []
                    convos = examples.get("conversations", examples.get("messages", []))
                    for convo in convos:
                        if isinstance(convo, list) and len(convo) > 0:
                            first = convo[0]
                            content = first.get("content", first.get("value", ""))
                            prompts.append([{"role": "user", "content": content}])
                        else:
                            prompts.append([{"role": "user", "content": "Hello"}])
                    return {"prompt": prompts}

                dataset = dataset.map(extract_prompts, batched=True,
                                      remove_columns=dataset.column_names)

            emit("log", f"Dataset formatted for GRPO: {len(dataset)} prompts")
        except Exception as e:
            emit("error", f"Failed to format dataset for GRPO: {e}")
            sys.exit(1)

    # ---- Build output path ----
    model_name = args.model.split("/")[-1]
    timestamp = int(time.time())
    run_output = os.path.join(finetune_output, f"{model_name}_{args.training_mode}_{timestamp}")
    os.makedirs(run_output, exist_ok=True)

    # ---- Create trainer callback ----
    CallbackClass = make_callback_class()

    # ---- Train ----
    emit("progress", f"Starting {mode_label} training...", 0.10)
    last_loss = None

    try:
        if is_vlm:
            # ---- VLM SFT: uses data_collator instead of dataset_text_field ----
            from trl import SFTTrainer, SFTConfig

            training_args = SFTConfig(
                output_dir=run_output,
                per_device_train_batch_size=args.batch_size,
                gradient_accumulation_steps=max(1, 8 // args.batch_size),
                num_train_epochs=args.epochs,
                learning_rate=args.learning_rate,
                logging_steps=5,
                save_steps=500,
                save_total_limit=2,
                max_seq_length=args.max_seq_length,
                bf16=has_gpu,
                fp16=False,
                warmup_ratio=0.1,
                lr_scheduler_type="cosine",
                optim="adamw_8bit" if has_gpu else "adamw_torch",
                report_to="none",
                seed=42,
                remove_unused_columns=False,
                dataset_text_field="",
                dataset_kwargs={"skip_prepare_dataset": True},
            )

            trainer = SFTTrainer(
                model=model,
                tokenizer=tokenizer,
                train_dataset=dataset,
                args=training_args,
                data_collator=vlm_data_collator,
                callbacks=[CallbackClass()],
            )

            result = trainer.train()
            last_loss = result.training_loss if hasattr(result, 'training_loss') else None

        elif args.training_mode == "sft":
            from trl import SFTTrainer, SFTConfig

            training_args = SFTConfig(
                output_dir=run_output,
                per_device_train_batch_size=args.batch_size,
                gradient_accumulation_steps=max(1, 16 // args.batch_size),
                num_train_epochs=args.epochs,
                learning_rate=args.learning_rate,
                logging_steps=5,
                save_steps=500,
                save_total_limit=2,
                max_seq_length=args.max_seq_length,
                bf16=has_gpu,
                fp16=False,
                warmup_ratio=0.1,
                lr_scheduler_type="cosine",
                optim="adamw_8bit" if has_gpu else "adamw_torch",
                report_to="none",
                seed=42,
                dataset_text_field="text",
            )

            trainer = SFTTrainer(
                model=model,
                tokenizer=tokenizer,
                train_dataset=dataset,
                args=training_args,
                callbacks=[CallbackClass()],
            )

            result = trainer.train()
            last_loss = result.training_loss if hasattr(result, 'training_loss') else None

        elif args.training_mode == "grpo":
            from trl import GRPOTrainer, GRPOConfig

            reward_funcs = build_reward_functions(args.reward_type)
            emit("log", f"GRPO reward type: {args.reward_type} ({len(reward_funcs)} reward functions)")

            training_args = GRPOConfig(
                output_dir=run_output,
                per_device_train_batch_size=args.batch_size,
                num_train_epochs=args.epochs,
                learning_rate=args.learning_rate,
                logging_steps=5,
                save_steps=500,
                save_total_limit=2,
                max_completion_length=args.max_seq_length,
                bf16=has_gpu,
                fp16=False,
                warmup_ratio=0.1,
                lr_scheduler_type="cosine",
                optim="adamw_8bit" if has_gpu else "adamw_torch",
                report_to="none",
                seed=42,
                num_generations=args.num_generations,
                beta=args.grpo_beta,
            )

            # GRPO needs the model in training mode
            FastLanguageModel.for_training(model)

            trainer = GRPOTrainer(
                model=model,
                processing_class=tokenizer,
                reward_funcs=reward_funcs,
                train_dataset=dataset,
                args=training_args,
                callbacks=[CallbackClass()],
            )

            result = trainer.train()
            last_loss = result.training_loss if hasattr(result, 'training_loss') else None

    except Exception as e:
        emit("error", f"Training failed: {e}")
        sys.exit(1)

    elapsed = time.time() - start_time
    emit("progress", "Training complete. Saving model...", 0.95)

    # ---- Save model ----
    merged = False
    output_path = run_output

    try:
        if is_vlm:
            # VLM model save
            if args.merge_adapters and args.finetuning_type in ("lora", "qlora"):
                emit("progress", "Merging VLM adapters and saving...", 0.96)
                merged_dir = run_output + "_merged"
                model.save_pretrained_merged(merged_dir, tokenizer, save_method="merged_16bit")
                merged = True
                output_path = merged_dir
                emit("progress", "VLM model merged and saved", 0.98)
            else:
                model.save_pretrained(run_output)
                tokenizer.save_pretrained(run_output)
                emit("progress", "VLM model saved", 0.98)
        elif args.merge_adapters and args.finetuning_type in ("lora", "qlora"):
            emit("progress", "Merging LoRA adapters and saving...", 0.96)
            merged_dir = run_output + "_merged"
            model.save_pretrained_merged(merged_dir, tokenizer, save_method="merged_16bit")
            merged = True
            output_path = merged_dir
            emit("progress", "Model merged and saved", 0.98)
        else:
            # Save adapter or full model
            model.save_pretrained(run_output)
            tokenizer.save_pretrained(run_output)
            emit("progress", "Model saved", 0.98)
    except Exception as e:
        emit("log", f"Save with merge failed, saving adapter only: {e}")
        try:
            model.save_pretrained(run_output)
            tokenizer.save_pretrained(run_output)
        except Exception as e2:
            emit("error", f"Failed to save model: {e2}")
            sys.exit(1)

    # Calculate output size
    total_size = 0
    if os.path.exists(output_path):
        for root, dirs, files in os.walk(output_path):
            for f in files:
                total_size += os.path.getsize(os.path.join(root, f))
    size_mb = total_size / (1024 * 1024)

    result = {
        "type": "complete",
        "message": f"Finetuning complete! {mode_label} + {ft_type_label} on {model_name} ({size_mb:.1f} MB, {elapsed:.0f}s)",
        "progress": 1.0,
        "output_dir": output_path,
        "base_model": args.model,
        "finetuning_type": args.finetuning_type,
        "training_mode": args.training_mode,
        "merged": merged,
        "final_loss": last_loss,
        "total_time": round(elapsed, 1),
        "size_mb": round(size_mb, 1),
    }
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
