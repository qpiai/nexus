"""
Train a YOLO model on a custom dataset with per-epoch metric callbacks.
Usage: python vision_train.py --model yolo26n.pt --data /path/to/data.yaml --epochs 50 --batch 16 --imgsz 640 --lr 0.01 --optimizer auto --freeze 0 --augment --patience 10 --project /output/vision_train
"""
import argparse, json, sys, os, time, signal

_stop_requested = False


def emit(data):
    print(json.dumps(data), flush=True)


def _handle_sigterm(signum, frame):
    global _stop_requested
    _stop_requested = True
    emit({"type": "info", "message": "Stop signal received, finishing current epoch..."})


signal.signal(signal.SIGTERM, _handle_sigterm)


def main():
    parser = argparse.ArgumentParser(description="Train YOLO model")
    parser.add_argument('--model', required=True, help="Base model e.g. yolo26n.pt")
    parser.add_argument('--data', required=True, help="Path to data.yaml")
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch', type=int, default=16)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--lr', type=float, default=0.01)
    parser.add_argument('--optimizer', default='auto')
    parser.add_argument('--freeze', type=int, default=0)
    parser.add_argument('--augment', action='store_true')
    parser.add_argument('--no-augment', dest='augment', action='store_false')
    parser.add_argument('--patience', type=int, default=10)
    parser.add_argument('--project', required=True, help="Project directory for saving runs")
    parser.add_argument('--run-name', default='train', help="Run name")
    parser.add_argument('--resume', action='store_true', help="Resume interrupted training")
    parser.set_defaults(augment=True)
    args = parser.parse_args()

    try:
        emit({"type": "info", "message": f"Loading model {args.model}..."})

        from ultralytics import YOLO
        from ultralytics.utils import callbacks

        model = YOLO(args.model)
        emit({"type": "progress", "message": "Model loaded", "progress": 0.05})

        start_time = time.time()

        # Callback: on_train_epoch_end — emit per-epoch metrics + check for stop
        def on_train_epoch_end(trainer):
            global _stop_requested
            epoch = trainer.epoch + 1
            total = trainer.epochs
            loss_items = trainer.label_loss_items(trainer.tloss)

            metrics = {
                "type": "epoch",
                "epoch": epoch,
                "totalEpochs": total,
                "boxLoss": round(float(loss_items.get('train/box_loss', 0)), 5),
                "clsLoss": round(float(loss_items.get('train/cls_loss', 0)), 5),
                "dflLoss": round(float(loss_items.get('train/dfl_loss', 0)), 5),
                "learningRate": round(float(trainer.optimizer.param_groups[0]['lr']), 8),
                "progress": round(epoch / total, 4),
            }
            emit(metrics)

            # Graceful stop: finish current epoch, then stop training
            if _stop_requested:
                emit({"type": "info", "message": f"Stopping training at epoch {epoch}/{total}"})
                trainer.epoch = trainer.epochs  # Force training loop to end

        # Callback: on_fit_epoch_end — emit val metrics (mAP etc.)
        def on_fit_epoch_end(trainer):
            epoch = trainer.epoch + 1
            total = trainer.epochs
            m = trainer.metrics

            val_metrics = {
                "type": "val_metrics",
                "epoch": epoch,
                "totalEpochs": total,
                "mAP50": round(float(m.get('metrics/mAP50(B)', 0)), 5),
                "mAP5095": round(float(m.get('metrics/mAP50-95(B)', 0)), 5),
                "precision": round(float(m.get('metrics/precision(B)', 0)), 5),
                "recall": round(float(m.get('metrics/recall(B)', 0)), 5),
                "progress": round(epoch / total, 4),
            }
            emit(val_metrics)

        # Register callbacks
        model.add_callback('on_train_epoch_end', on_train_epoch_end)
        model.add_callback('on_fit_epoch_end', on_fit_epoch_end)

        emit({"type": "progress", "message": f"Starting training: {args.epochs} epochs, batch {args.batch}, img {args.imgsz}", "progress": 0.1})

        # Build training kwargs
        train_kwargs = dict(
            data=args.data,
            epochs=args.epochs,
            batch=args.batch,
            imgsz=args.imgsz,
            lr0=args.lr,
            optimizer=args.optimizer,
            augment=args.augment,
            patience=args.patience if args.patience > 0 else 0,
            project=args.project,
            name=args.run_name,
            exist_ok=True,
            verbose=False,
            plots=True,
        )

        if args.freeze > 0:
            train_kwargs['freeze'] = args.freeze

        if args.resume:
            train_kwargs['resume'] = True

        results = model.train(**train_kwargs)

        elapsed = round(time.time() - start_time, 1)

        # Find run directory
        run_dir = os.path.join(args.project, args.run_name)
        best_path = os.path.join(run_dir, 'weights', 'best.pt')
        last_path = os.path.join(run_dir, 'weights', 'last.pt')

        # Get best metrics
        best_map50 = 0
        best_map5095 = 0
        best_epoch = 0
        if hasattr(results, 'results_dict'):
            rd = results.results_dict
            best_map50 = round(float(rd.get('metrics/mAP50(B)', 0)), 5)
            best_map5095 = round(float(rd.get('metrics/mAP50-95(B)', 0)), 5)

        # Read data.yaml for class names
        classes = []
        try:
            with open(args.data) as f:
                for line in f:
                    line = line.strip()
                    # Parse "  0: class_name" lines
                    if ':' in line and line.split(':')[0].strip().isdigit():
                        classes.append(line.split(':', 1)[1].strip())
        except Exception:
            pass

        # Save training metadata
        train_meta = {
            'model': args.model,
            'dataset': args.data,
            'epochs': args.epochs,
            'bestModelPath': best_path if os.path.exists(best_path) else last_path,
            'lastModelPath': last_path,
            'runDir': run_dir,
            'bestMap50': best_map50,
            'bestMap5095': best_map5095,
            'bestEpoch': best_epoch,
            'totalTime': elapsed,
            'classes': classes,
            'completedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        }
        meta_path = os.path.join(run_dir, 'train_metadata.json')
        with open(meta_path, 'w') as f:
            json.dump(train_meta, f, indent=2)

        emit({
            "type": "complete",
            "message": f"Training complete — mAP50: {best_map50:.3f}, mAP50-95: {best_map5095:.3f} ({elapsed}s)",
            "progress": 1.0,
            **train_meta,
        })

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
