"""
Validate and prepare a dataset for YOLO training.
Supports YOLO format (images/ + labels/) and COCO JSON format (auto-converts).
Usage: python vision_dataset_prepare.py --input /path/to/extracted --output /path/to/prepared --name my_dataset
"""
import argparse, json, sys, os, shutil, glob


def emit(data):
    print(json.dumps(data), flush=True)


def find_yolo_structure(root, max_depth=3):
    """Detect YOLO dataset structure: images/ + labels/ with optional train/val splits."""
    if max_depth <= 0:
        return None

    images_dir = None
    labels_dir = None

    # Check for images/ and labels/ at root
    try:
        entries = os.listdir(root)
    except OSError:
        return None

    for d in entries:
        full = os.path.join(root, d)
        if not os.path.isdir(full) or os.path.islink(full):
            continue
        dl = d.lower()
        if dl == 'images':
            images_dir = full
        elif dl == 'labels':
            labels_dir = full

    if images_dir and labels_dir:
        # Check if there are train/val subdirs
        train_imgs = os.path.join(images_dir, 'train')
        val_imgs = os.path.join(images_dir, 'val')
        if os.path.isdir(train_imgs) and os.path.isdir(val_imgs):
            return {
                'format': 'yolo',
                'split': True,
                'train_images': train_imgs,
                'val_images': val_imgs,
                'train_labels': os.path.join(labels_dir, 'train'),
                'val_labels': os.path.join(labels_dir, 'val'),
            }
        else:
            return {
                'format': 'yolo',
                'split': False,
                'images': images_dir,
                'labels': labels_dir,
            }

    # Check one level deeper (e.g. dataset_name/images/ ...)
    for sub in entries:
        sub_path = os.path.join(root, sub)
        if os.path.isdir(sub_path) and not os.path.islink(sub_path):
            result = find_yolo_structure(sub_path, max_depth=max_depth - 1)
            if result:
                return result

    return None


def find_coco_annotations(root):
    """Find COCO JSON annotation files."""
    for dirpath, _, filenames in os.walk(root, followlinks=False):
        for f in filenames:
            if f.endswith('.json'):
                fpath = os.path.join(dirpath, f)
                try:
                    with open(fpath) as fp:
                        data = json.load(fp)
                    if 'images' in data and 'annotations' in data and 'categories' in data:
                        return fpath, data
                except Exception:
                    continue
    return None, None


def convert_coco_to_yolo(coco_json_path, coco_data, output_dir):
    """Convert COCO JSON annotations to YOLO format."""
    images = coco_data['images']
    annotations = coco_data['annotations']
    categories = coco_data['categories']

    cat_id_to_idx = {}
    class_names = []
    for idx, cat in enumerate(sorted(categories, key=lambda c: c['id'])):
        cat_id_to_idx[cat['id']] = idx
        class_names.append(cat['name'])

    # Group annotations by image_id
    img_anns = {}
    for ann in annotations:
        img_id = ann['image_id']
        if img_id not in img_anns:
            img_anns[img_id] = []
        img_anns[img_id].append(ann)

    # Find images directory relative to JSON
    json_dir = os.path.dirname(coco_json_path)
    possible_img_dirs = [
        os.path.join(json_dir, 'images'),
        os.path.join(json_dir, '..', 'images'),
        os.path.join(json_dir, '..', 'train'),
        os.path.join(json_dir, '..', 'val'),
        json_dir,
    ]
    img_source_dir = None
    for d in possible_img_dirs:
        if os.path.isdir(d):
            # Check if it actually contains image files
            test_files = os.listdir(d)
            if any(f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp')) for f in test_files):
                img_source_dir = d
                break

    if not img_source_dir:
        # Last resort: search for images in the root
        root = os.path.dirname(json_dir) if os.path.basename(json_dir).lower() == 'annotations' else json_dir
        for dp, dn, fns in os.walk(root, followlinks=False):
            if any(f.lower().endswith(('.jpg', '.jpeg', '.png')) for f in fns):
                img_source_dir = dp
                break

    if not img_source_dir:
        raise ValueError("Could not find images directory for COCO dataset")

    images_out = os.path.join(output_dir, 'images', 'train')
    labels_out = os.path.join(output_dir, 'labels', 'train')
    os.makedirs(images_out, exist_ok=True)
    os.makedirs(labels_out, exist_ok=True)

    converted = 0
    for img_info in images:
        img_id = img_info['id']
        fname = img_info['file_name']
        w, h = img_info['width'], img_info['height']
        if w <= 0 or h <= 0:
            continue

        src_path = os.path.join(img_source_dir, fname)
        if not os.path.exists(src_path):
            src_path = os.path.join(img_source_dir, os.path.basename(fname))
        if not os.path.exists(src_path):
            continue

        # Copy image
        dst_img = os.path.join(images_out, os.path.basename(fname))
        if not os.path.exists(dst_img):
            shutil.copy2(src_path, dst_img)

        # Write YOLO label
        label_name = os.path.splitext(os.path.basename(fname))[0] + '.txt'
        label_path = os.path.join(labels_out, label_name)

        lines = []
        for ann in img_anns.get(img_id, []):
            cat_idx = cat_id_to_idx.get(ann['category_id'])
            if cat_idx is None:
                continue
            bbox = ann['bbox']  # [x, y, w, h] in pixels
            cx = (bbox[0] + bbox[2] / 2) / w
            cy = (bbox[1] + bbox[3] / 2) / h
            bw = bbox[2] / w
            bh = bbox[3] / h
            lines.append(f"{cat_idx} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

        with open(label_path, 'w') as f:
            f.write('\n'.join(lines))

        converted += 1

    return class_names, converted


def count_images(directory):
    """Count image files in a directory."""
    exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff')
    count = 0
    if os.path.isdir(directory):
        for f in os.listdir(directory):
            if f.lower().endswith(exts):
                count += 1
    return count


def get_classes_from_labels(labels_dir):
    """Extract unique class indices from YOLO label files."""
    classes = set()
    if not os.path.isdir(labels_dir):
        return classes
    for f in os.listdir(labels_dir):
        if not f.endswith('.txt'):
            continue
        fpath = os.path.join(labels_dir, f)
        try:
            with open(fpath) as fp:
                for line in fp:
                    parts = line.strip().split()
                    if parts:
                        classes.add(int(parts[0]))
        except Exception:
            pass
    return classes


def split_dataset(images_dir, labels_dir, output_dir, val_ratio=0.2):
    """Split a flat YOLO dataset into train/val."""
    import random
    exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
    all_images = [f for f in os.listdir(images_dir) if f.lower().endswith(exts)]
    random.shuffle(all_images)

    val_count = max(1, int(len(all_images) * val_ratio))
    val_images = all_images[:val_count]
    train_images = all_images[val_count:]

    for split_name, file_list in [('train', train_images), ('val', val_images)]:
        img_out = os.path.join(output_dir, 'images', split_name)
        lbl_out = os.path.join(output_dir, 'labels', split_name)
        os.makedirs(img_out, exist_ok=True)
        os.makedirs(lbl_out, exist_ok=True)

        for fname in file_list:
            src_img = os.path.join(images_dir, fname)
            dst_img = os.path.join(img_out, fname)
            shutil.copy2(src_img, dst_img)

            label_name = os.path.splitext(fname)[0] + '.txt'
            src_lbl = os.path.join(labels_dir, label_name)
            if os.path.exists(src_lbl):
                shutil.copy2(src_lbl, os.path.join(lbl_out, label_name))

    return len(train_images), len(val_images)


def main():
    parser = argparse.ArgumentParser(description="Prepare dataset for YOLO training")
    parser.add_argument('--input', required=True, help="Path to extracted dataset directory")
    parser.add_argument('--output', required=True, help="Output directory for prepared dataset")
    parser.add_argument('--name', required=True, help="Dataset name")
    args = parser.parse_args()

    try:
        emit({"type": "progress", "message": "Scanning dataset structure...", "progress": 0.1})

        # Try YOLO format first
        yolo_info = find_yolo_structure(args.input)

        if yolo_info:
            emit({"type": "progress", "message": "Detected YOLO format dataset", "progress": 0.2})
            os.makedirs(args.output, exist_ok=True)

            if yolo_info['split']:
                # Already split — copy as-is
                for split in ['train', 'val']:
                    img_src = yolo_info[f'{split}_images']
                    lbl_src = yolo_info[f'{split}_labels']
                    img_dst = os.path.join(args.output, 'images', split)
                    lbl_dst = os.path.join(args.output, 'labels', split)
                    os.makedirs(img_dst, exist_ok=True)
                    os.makedirs(lbl_dst, exist_ok=True)

                    for f in os.listdir(img_src):
                        if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp')):
                            shutil.copy2(os.path.join(img_src, f), os.path.join(img_dst, f))

                    if os.path.isdir(lbl_src):
                        for f in os.listdir(lbl_src):
                            if f.endswith('.txt'):
                                shutil.copy2(os.path.join(lbl_src, f), os.path.join(lbl_dst, f))

                train_count = count_images(os.path.join(args.output, 'images', 'train'))
                val_count = count_images(os.path.join(args.output, 'images', 'val'))
                emit({"type": "progress", "message": f"Copied {train_count} train + {val_count} val images", "progress": 0.6})
            else:
                # Need to split
                emit({"type": "progress", "message": "Splitting dataset into train/val (80/20)...", "progress": 0.3})
                train_count, val_count = split_dataset(
                    yolo_info['images'], yolo_info['labels'], args.output
                )
                emit({"type": "progress", "message": f"Split into {train_count} train + {val_count} val images", "progress": 0.6})

            # Get classes
            train_labels = os.path.join(args.output, 'labels', 'train')
            class_indices = get_classes_from_labels(train_labels)
            num_classes = max(class_indices) + 1 if class_indices else 0

            # Check for existing classes.txt or data.yaml for class names
            class_names = [f"class_{i}" for i in range(num_classes)]
            for candidate in ['classes.txt', 'labels.txt']:
                for search_dir in [args.input, os.path.dirname(args.input)]:
                    cpath = os.path.join(search_dir, candidate)
                    if os.path.exists(cpath):
                        with open(cpath) as f:
                            names = [l.strip() for l in f if l.strip()]
                        if len(names) >= num_classes:
                            class_names = names[:num_classes]
                        break

            # Also check for data.yaml
            for search_dir in [args.input, os.path.dirname(args.input)]:
                yaml_candidates = glob.glob(os.path.join(search_dir, '*.yaml')) + glob.glob(os.path.join(search_dir, '*.yml'))
                for yf in yaml_candidates:
                    try:
                        import yaml
                        with open(yf) as f:
                            yd = yaml.safe_load(f)
                        if 'names' in yd:
                            if isinstance(yd['names'], dict):
                                class_names = [yd['names'].get(i, f'class_{i}') for i in range(num_classes)]
                            elif isinstance(yd['names'], list) and len(yd['names']) >= num_classes:
                                class_names = yd['names'][:num_classes]
                            break
                    except Exception:
                        pass

            dataset_format = 'yolo'

        else:
            # Try COCO format
            emit({"type": "progress", "message": "Checking for COCO JSON annotations...", "progress": 0.2})
            coco_path, coco_data = find_coco_annotations(args.input)

            if coco_path and coco_data:
                emit({"type": "progress", "message": f"Found COCO annotations, converting to YOLO...", "progress": 0.3})
                class_names, converted = convert_coco_to_yolo(coco_path, coco_data, args.output)
                num_classes = len(class_names)

                # Split the converted data
                emit({"type": "progress", "message": "Splitting converted data into train/val...", "progress": 0.5})
                train_imgs = os.path.join(args.output, 'images', 'train')
                train_lbls = os.path.join(args.output, 'labels', 'train')

                # Re-split (move some from train to val)
                import random
                all_imgs = [f for f in os.listdir(train_imgs) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.webp'))]
                random.shuffle(all_imgs)
                val_n = max(1, int(len(all_imgs) * 0.2))
                val_imgs_list = all_imgs[:val_n]

                val_imgs_dir = os.path.join(args.output, 'images', 'val')
                val_lbls_dir = os.path.join(args.output, 'labels', 'val')
                os.makedirs(val_imgs_dir, exist_ok=True)
                os.makedirs(val_lbls_dir, exist_ok=True)

                for fname in val_imgs_list:
                    shutil.move(os.path.join(train_imgs, fname), os.path.join(val_imgs_dir, fname))
                    lbl = os.path.splitext(fname)[0] + '.txt'
                    src_lbl = os.path.join(train_lbls, lbl)
                    if os.path.exists(src_lbl):
                        shutil.move(src_lbl, os.path.join(val_lbls_dir, lbl))

                train_count = count_images(train_imgs)
                val_count = len(val_imgs_list)
                emit({"type": "progress", "message": f"Converted {converted} images — {train_count} train + {val_count} val", "progress": 0.7})
                dataset_format = 'coco'
            else:
                emit({"type": "error", "message": "Could not detect dataset format. Expected YOLO (images/ + labels/) or COCO JSON."})
                sys.exit(1)

        # Write data.yaml
        emit({"type": "progress", "message": "Writing data.yaml...", "progress": 0.8})
        yaml_path = os.path.join(args.output, 'data.yaml')
        yaml_content = {
            'path': os.path.abspath(args.output),
            'train': 'images/train',
            'val': 'images/val',
            'nc': num_classes,
            'names': class_names,
        }

        # Write YAML manually (no pyyaml dependency needed)
        with open(yaml_path, 'w') as f:
            f.write(f"path: {yaml_content['path']}\n")
            f.write(f"train: {yaml_content['train']}\n")
            f.write(f"val: {yaml_content['val']}\n")
            f.write(f"nc: {yaml_content['nc']}\n")
            f.write("names:\n")
            for i, name in enumerate(class_names):
                f.write(f"  {i}: {name}\n")

        # Write metadata
        metadata = {
            'name': args.name,
            'path': os.path.abspath(args.output),
            'format': dataset_format,
            'numImages': train_count + val_count,
            'numClasses': num_classes,
            'classes': class_names,
            'splits': {'train': train_count, 'val': val_count},
            'yamlPath': yaml_path,
            'preparedAt': __import__('time').strftime('%Y-%m-%dT%H:%M:%SZ'),
        }
        with open(os.path.join(args.output, 'metadata.json'), 'w') as f:
            json.dump(metadata, f, indent=2)

        emit({
            "type": "complete",
            "message": f"Dataset '{args.name}' prepared — {num_classes} classes, {train_count + val_count} images",
            "progress": 1.0,
            **metadata,
        })

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
