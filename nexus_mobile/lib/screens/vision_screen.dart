import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

class VisionScreen extends ConsumerStatefulWidget {
  const VisionScreen({super.key});

  @override
  ConsumerState<VisionScreen> createState() => _VisionScreenState();
}

class _VisionScreenState extends ConsumerState<VisionScreen> {
  final ImagePicker _picker = ImagePicker();

  List<Map<String, dynamic>> _visionModels = [];
  int _selectedModelIndex = 0;
  XFile? _selectedImage;
  Uint8List? _imageBytes;
  bool _isDetecting = false;
  String? _error;

  // Detection results
  List<Map<String, dynamic>> _detections = [];
  int _inferenceTimeMs = 0;

  @override
  void initState() {
    super.initState();
    _fetchVisionModels();
  }

  String get _serverUrl {
    final box = Hive.box('settings');
    return box.get('serverUrl', defaultValue: '') as String;
  }

  String? get _authToken {
    final box = Hive.box('settings');
    return box.get('authToken') as String?;
  }

  Future<void> _fetchVisionModels() async {
    if (_serverUrl.isEmpty) return;
    try {
      final headers = <String, String>{};
      if (_authToken != null) headers['Authorization'] = 'Bearer $_authToken';
      final response = await http.get(
        Uri.parse('$_serverUrl/api/mobile/vision/models'),
        headers: headers,
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _visionModels = List<Map<String, dynamic>>.from(data['models'] ?? []);
        });
      }
    } catch (_) {}
  }

  Future<void> _pickFromGallery() async {
    final file = await _picker.pickImage(source: ImageSource.gallery, maxWidth: 1920);
    if (file != null && mounted) {
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      setState(() {
        _selectedImage = file;
        _imageBytes = bytes;
        _detections = [];
        _error = null;
      });
    }
  }

  Future<void> _pickFromCamera() async {
    final file = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1920);
    if (file != null && mounted) {
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      setState(() {
        _selectedImage = file;
        _imageBytes = bytes;
        _detections = [];
        _error = null;
      });
    }
  }

  Future<void> _runDetection() async {
    if (_selectedImage == null || _visionModels.isEmpty || _serverUrl.isEmpty) return;

    setState(() {
      _isDetecting = true;
      _error = null;
      _detections = [];
    });

    try {
      final model = _visionModels[_selectedModelIndex];
      final request = http.MultipartRequest(
        'POST',
        Uri.parse('$_serverUrl/api/mobile/vision/infer'),
      );

      if (_authToken != null) {
        request.headers['Authorization'] = 'Bearer $_authToken';
      }

      request.files.add(await http.MultipartFile.fromPath('image', _selectedImage!.path));
      request.fields['modelDirName'] = model['dirName'] ?? '';
      request.fields['modelFile'] = model['fileName'] ?? '';
      request.fields['task'] = 'detect';
      request.fields['conf'] = '0.25';
      request.fields['iou'] = '0.45';

      final streamedResponse = await request.send();
      final responseBody = await streamedResponse.stream.bytesToString();

      if (streamedResponse.statusCode != 200) {
        throw Exception('Server error ${streamedResponse.statusCode}');
      }

      final result = jsonDecode(responseBody);
      if (!mounted) return;
      setState(() {
        _detections = List<Map<String, dynamic>>.from(result['detections'] ?? []);
        _inferenceTimeMs = result['inferenceTimeMs'] ?? 0;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceAll('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _isDetecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vision', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchVisionModels,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Model selector
          _buildModelSelector(),
          const SizedBox(height: 12),

          // Image source buttons
          Row(
            children: [
              Expanded(
                child: _buildActionButton(
                  icon: Icons.photo_library,
                  label: 'Gallery',
                  color: const Color(0xFF7B9FC7),
                  onTap: _pickFromGallery,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildActionButton(
                  icon: Icons.camera_alt,
                  label: 'Camera',
                  color: const Color(0xFF10B981),
                  onTap: _pickFromCamera,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Preview or empty state
          if (_imageBytes != null)
            _buildImagePreview()
          else
            _buildEmptyState(),

          const SizedBox(height: 12),

          // Detect button
          if (_imageBytes != null)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _isDetecting || _visionModels.isEmpty ? null : _runDetection,
                icon: _isDetecting
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.auto_awesome),
                label: Text(_isDetecting ? 'Detecting...' : 'Detect Objects'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF7B9FC7),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),

          // Results
          if (_detections.isNotEmpty) ...[
            const SizedBox(height: 16),
            _buildResults(),
          ],

          // Error
          if (_error != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.withAlpha(20),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, color: Colors.red, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildModelSelector() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'VISION MODEL',
              style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w600,
                color: Colors.grey[600], letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 6),
            if (_visionModels.isEmpty)
              Text(
                'No vision models available. Export a model from the server first.',
                style: TextStyle(fontSize: 12, color: Colors.grey[500]),
              )
            else
              DropdownButton<int>(
                value: _selectedModelIndex,
                isExpanded: true,
                dropdownColor: const Color(0xFF121522),
                items: _visionModels.asMap().entries.map((e) {
                  final m = e.value;
                  return DropdownMenuItem(
                    value: e.key,
                    child: Text(
                      '${m['name']} (${m['format']})',
                      style: const TextStyle(fontSize: 13),
                    ),
                  );
                }).toList(),
                onChanged: (val) => setState(() => _selectedModelIndex = val ?? 0),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: color.withAlpha(25),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 8),
            Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Card(
      child: Container(
        height: 180,
        alignment: Alignment.center,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.image_search, size: 48, color: Colors.grey[700]),
            const SizedBox(height: 12),
            Text(
              'Select an image to detect objects',
              style: TextStyle(color: Colors.grey[600], fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildImagePreview() {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Image.memory(_imageBytes!, fit: BoxFit.contain, width: double.infinity),
          // Draw detections as positioned boxes
          if (_detections.isNotEmpty)
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return CustomPaint(
                    painter: DetectionPainter(
                      detections: _detections,
                      viewWidth: constraints.maxWidth,
                      viewHeight: constraints.maxHeight,
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildResults() {
    final uniqueClasses = _detections.map((d) => d['class'] ?? 'object').toSet();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _resultStat('${_detections.length}', 'Detections', const Color(0xFF7B9FC7)),
            Container(width: 1, height: 30, color: Colors.grey[800]),
            _resultStat('${_inferenceTimeMs}ms', 'Inference', const Color(0xFF10B981)),
            Container(width: 1, height: 30, color: Colors.grey[800]),
            _resultStat('${uniqueClasses.length}', 'Classes', Colors.orange),
          ],
        ),
      ),
    );
  }

  Widget _resultStat(String value, String label, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 10, color: Colors.grey[600])),
      ],
    );
  }
}

/// Custom painter for drawing detection bounding boxes
class DetectionPainter extends CustomPainter {
  final List<Map<String, dynamic>> detections;
  final double viewWidth;
  final double viewHeight;

  DetectionPainter({
    required this.detections,
    required this.viewWidth,
    required this.viewHeight,
  });

  static const colors = [
    Color(0xFF7B9FC7), Color(0xFF3B82F6), Color(0xFF10B981),
    Color(0xFFF59E0B), Color(0xFFEF4444), Color(0xFFEC4899),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < detections.length; i++) {
      final det = detections[i];
      final box = List<double>.from(det['box'] ?? [0, 0, 0, 0]);
      final label = det['class'] ?? 'object';
      final conf = ((det['confidence'] ?? 0.0) * 100).toInt();
      final color = colors[i % colors.length];

      final paint = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5;

      // Box coordinates are in image pixels — scale to view
      // Since we don't know the exact image dimensions here,
      // the server returns coordinates scaled to the original image
      // and the Image widget handles scaling
      final rect = Rect.fromLTRB(box[0], box[1], box[2], box[3]);
      canvas.drawRect(rect, paint);

      // Label background
      final labelText = '$label $conf%';
      final textPainter = TextPainter(
        text: TextSpan(
          text: labelText,
          style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
        ),
        textDirection: TextDirection.ltr,
      )..layout();

      final bgPaint = Paint()..color = color;
      canvas.drawRect(
        Rect.fromLTWH(box[0], box[1] - 16, textPainter.width + 8, 16),
        bgPaint,
      );
      textPainter.paint(canvas, Offset(box[0] + 4, box[1] - 15));
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
