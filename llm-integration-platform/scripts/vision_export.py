"""
Export YOLO vision model to deployment format.
Usage: python vision_export.py --model yolo26n.pt --format onnx --precision fp16 --img-size 640 --output-dir /output/vision/...
"""
import argparse, json, sys, os, time, shutil


def emit(data):
    print(json.dumps(data), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Export YOLO model to deployment format")
    parser.add_argument('--model', required=True, help="Model ID e.g. yolo26n.pt")
    parser.add_argument('--format', required=True, help="Export format: onnx, engine, coreml, tflite, openvino, ncnn")
    parser.add_argument('--precision', default='fp16', help="Precision: fp32, fp16, int8")
    parser.add_argument('--img-size', type=int, default=640, help="Input image size")
    parser.add_argument('--output-dir', required=True, help="Output directory")
    args = parser.parse_args()

    try:
        emit({"type": "info", "message": f"Loading {args.model}..."})

        from ultralytics import YOLO
        model = YOLO(args.model)
        emit({"type": "progress", "message": "Model loaded successfully", "progress": 0.2})

        export_kwargs = dict(format=args.format, imgsz=args.img_size)
        if args.precision == 'fp16':
            export_kwargs['half'] = True
        elif args.precision == 'int8':
            export_kwargs['int8'] = True

        emit({"type": "progress", "message": f"Exporting to {args.format.upper()} ({args.precision})...", "progress": 0.3})
        exported_path = model.export(**export_kwargs)
        emit({"type": "progress", "message": "Export finished, saving to output...", "progress": 0.8})

        # Copy to output dir
        os.makedirs(args.output_dir, exist_ok=True)
        exported_path = str(exported_path)

        if os.path.isdir(exported_path):
            dest = os.path.join(args.output_dir, os.path.basename(exported_path))
            if os.path.exists(dest):
                shutil.rmtree(dest)
            shutil.copytree(exported_path, dest)
            size_bytes = sum(
                os.path.getsize(os.path.join(dp, f))
                for dp, dn, fns in os.walk(dest, followlinks=False) for f in fns
            )
        else:
            dest = os.path.join(args.output_dir, os.path.basename(exported_path))
            shutil.copy2(exported_path, dest)
            size_bytes = os.path.getsize(dest)

        size_mb = round(size_bytes / (1024 * 1024), 2)

        # Save metadata.json
        metadata = {
            "name": os.path.splitext(args.model)[0],
            "modelId": args.model,
            "task": "segment" if "-seg" in args.model else "detect",
            "format": args.format,
            "precision": args.precision,
            "imgSize": args.img_size,
            "sizeMB": size_mb,
            "exportDate": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "classes": list(model.names.values()) if hasattr(model, 'names') and model.names else [],
        }
        with open(os.path.join(args.output_dir, "metadata.json"), "w") as f:
            json.dump(metadata, f, indent=2)

        emit({
            "type": "complete",
            "message": f"Exported {args.model} to {args.format.upper()} ({args.precision}) — {size_mb} MB",
            "output_path": dest,
            "size_mb": size_mb,
            "progress": 1.0,
        })

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
