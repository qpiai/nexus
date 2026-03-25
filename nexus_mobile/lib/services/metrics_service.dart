import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';
import '../models/metrics.dart';

class MetricsService {
  final List<DeviceMetrics> _history = [];
  static const int maxHistory = 500;

  List<DeviceMetrics> get history => List.unmodifiable(_history);

  void addMetric(DeviceMetrics metric) {
    _history.add(metric);
    if (_history.length > maxHistory) {
      _history.removeAt(0);
    }
  }

  /// Send metrics to the Nexus server
  Future<bool> reportMetrics(String serverUrl, List<DeviceMetrics> metrics) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/telemetry/report'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'metrics': metrics.map((m) => m.toJson()).toList(),
        }),
      );
      return response.statusCode == 200;
    } catch (e) {
      // Metrics reporting is best-effort
      return false;
    }
  }

  /// Get average metrics over a time range
  DeviceMetrics? getAverage({Duration? duration}) {
    if (_history.isEmpty) return null;

    final cutoff = duration != null
        ? DateTime.now().subtract(duration)
        : DateTime.fromMillisecondsSinceEpoch(0);

    final relevant = _history.where(
      (m) => m.timestamp.isAfter(cutoff),
    ).toList();

    if (relevant.isEmpty) return null;

    return DeviceMetrics(
      timestamp: DateTime.now(),
      cpuUsage: relevant.map((m) => m.cpuUsage).reduce((a, b) => a + b) / relevant.length,
      memoryUsage: relevant.map((m) => m.memoryUsage).reduce((a, b) => a + b) / relevant.length,
      temperature: relevant.map((m) => m.temperature).reduce((a, b) => a + b) / relevant.length,
      batteryLevel: relevant.last.batteryLevel,
    );
  }

  /// Save server URL to settings
  static Future<void> saveServerUrl(String url) async {
    final box = Hive.box('settings');
    await box.put('serverUrl', url);
  }

  static String? getServerUrl() {
    final box = Hive.box('settings');
    return box.get('serverUrl');
  }
}

final metricsServiceProvider = Provider<MetricsService>((ref) {
  return MetricsService();
});
