class DeviceMetrics {
  final DateTime timestamp;
  final double cpuUsage;
  final double memoryUsage;
  final double temperature;
  final double batteryLevel;
  final double? tokensPerSec;
  final double? latencyMs;

  const DeviceMetrics({
    required this.timestamp,
    required this.cpuUsage,
    required this.memoryUsage,
    required this.temperature,
    required this.batteryLevel,
    this.tokensPerSec,
    this.latencyMs,
  });

  Map<String, dynamic> toJson() => {
    'timestamp': timestamp.millisecondsSinceEpoch,
    'cpuUsage': cpuUsage,
    'memoryUsage': memoryUsage,
    'temperature': temperature,
    'batteryLevel': batteryLevel,
    'tokensPerSec': tokensPerSec,
    'latencyMs': latencyMs,
  };

  factory DeviceMetrics.fromJson(Map<String, dynamic> json) {
    return DeviceMetrics(
      timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] ?? 0),
      cpuUsage: (json['cpuUsage'] ?? 0).toDouble(),
      memoryUsage: (json['memoryUsage'] ?? 0).toDouble(),
      temperature: (json['temperature'] ?? 0).toDouble(),
      batteryLevel: (json['batteryLevel'] ?? 0).toDouble(),
      tokensPerSec: json['tokensPerSec']?.toDouble(),
      latencyMs: json['latencyMs']?.toDouble(),
    );
  }
}
