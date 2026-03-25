import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/device_info.dart';
import '../models/metrics.dart';

class HardwareService {
  Timer? _metricsTimer;
  final _metricsController = StreamController<DeviceMetrics>.broadcast();

  Stream<DeviceMetrics> get metricsStream => _metricsController.stream;

  /// Detect device hardware specifications
  Future<DeviceHardwareInfo> detectHardware() async {
    // In production, use device_info_plus for actual values
    return DeviceHardwareInfo(
      deviceName: Platform.localHostname,
      platform: '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
      cpuModel: 'ARM64',
      cpuCores: Platform.numberOfProcessors,
      ramGB: 8.0, // Would use actual system info
      storageGB: 128.0, // Would use path_provider + disk space
      gpuModel: Platform.isAndroid ? 'Adreno/Mali' : 'Apple GPU',
    );
  }

  /// Start periodic metrics collection
  void startMetricsCollection({Duration interval = const Duration(seconds: 5)}) {
    _metricsTimer?.cancel();
    _metricsTimer = Timer.periodic(interval, (_) async {
      final metrics = await _collectMetrics();
      _metricsController.add(metrics);
    });
  }

  void stopMetricsCollection() {
    _metricsTimer?.cancel();
  }

  Future<DeviceMetrics> _collectMetrics() async {
    // In production, use platform channels / sensors_plus / battery_plus
    // For now, generate realistic sample data
    return DeviceMetrics(
      timestamp: DateTime.now(),
      cpuUsage: 15.0 + (DateTime.now().millisecond % 40),
      memoryUsage: 45.0 + (DateTime.now().millisecond % 20),
      temperature: 35.0 + (DateTime.now().millisecond % 10),
      batteryLevel: 85.0 - (DateTime.now().minute % 20),
    );
  }

  void dispose() {
    _metricsTimer?.cancel();
    _metricsController.close();
  }
}

final hardwareServiceProvider = Provider<HardwareService>((ref) {
  final service = HardwareService();
  ref.onDispose(() => service.dispose());
  return service;
});
