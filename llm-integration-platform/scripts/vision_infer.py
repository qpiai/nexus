"""
Run YOLO inference on an image.
Usage: python vision_infer.py --model /path/to/model.onnx --image /path/to/img.jpg --task detect --conf 0.25 --iou 0.45
"""
import argparse, json, sys, base64


def emit(data):
    print(json.dumps(data), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Run YOLO inference on an image")
    parser.add_argument('--model', required=True, help="Path to exported model")
    parser.add_argument('--image', required=True, help="Path to input image")
    parser.add_argument('--task', default='detect', help="Task: detect or segment")
    parser.add_argument('--conf', type=float, default=0.25, help="Confidence threshold")
    parser.add_argument('--iou', type=float, default=0.45, help="IoU threshold")
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
        import cv2

        model = YOLO(args.model)
        results = model.predict(source=args.image, conf=args.conf, iou=args.iou, verbose=False)
        result = results[0]

        # Extract detections
        detections = []
        if result.boxes is not None:
            for box in result.boxes:
                x1, y1, x2, y2 = [round(x, 1) for x in box.xyxy[0].tolist()]
                cls_id = int(box.cls[0])
                detections.append({
                    "bbox": [x1, y1, x2, y2],
                    "class": result.names[cls_id],
                    "className": result.names[cls_id],
                    "classId": cls_id,
                    "confidence": round(float(box.conf[0]), 4),
                    "x": x1,
                    "y": y1,
                    "width": round(x2 - x1, 1),
                    "height": round(y2 - y1, 1),
                })

        # Generate annotated image — ultralytics draws boxes/masks automatically
        annotated = result.plot()
        _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
        img_base64 = base64.b64encode(buffer).decode('utf-8')

        h, w = result.orig_shape
        speed = result.speed  # dict: preprocess, inference, postprocess (ms)

        emit({
            "type": "result",
            "detections": detections,
            "annotatedImage": img_base64,
            "inferenceTimeMs": round(sum(speed.values()), 2),
            "preprocessMs": round(speed.get('preprocess', 0), 2),
            "inferenceMs": round(speed.get('inference', 0), 2),
            "postprocessMs": round(speed.get('postprocess', 0), 2),
            "imageSize": [w, h],
            "detectionCount": len(detections),
        })
        emit({"type": "done"})

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
