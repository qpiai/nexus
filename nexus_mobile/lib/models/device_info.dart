class DeviceHardwareInfo {
  final String deviceName;
  final String platform;
  final String cpuModel;
  final int cpuCores;
  final double ramGB;
  final double storageGB;
  final String? gpuModel;
  final int? gpuMemoryMB;

  const DeviceHardwareInfo({
    required this.deviceName,
    required this.platform,
    required this.cpuModel,
    required this.cpuCores,
    required this.ramGB,
    required this.storageGB,
    this.gpuModel,
    this.gpuMemoryMB,
  });

  Map<String, dynamic> toJson() => {
    'deviceName': deviceName,
    'platform': platform,
    'cpuModel': cpuModel,
    'cpuCores': cpuCores,
    'ramGB': ramGB,
    'storageGB': storageGB,
    'gpuModel': gpuModel,
    'gpuMemoryMB': gpuMemoryMB,
  };

  factory DeviceHardwareInfo.fromJson(Map<String, dynamic> json) {
    return DeviceHardwareInfo(
      deviceName: json['deviceName'] ?? 'Unknown',
      platform: json['platform'] ?? 'Unknown',
      cpuModel: json['cpuModel'] ?? 'Unknown',
      cpuCores: json['cpuCores'] ?? 0,
      ramGB: (json['ramGB'] ?? 0).toDouble(),
      storageGB: (json['storageGB'] ?? 0).toDouble(),
      gpuModel: json['gpuModel'],
      gpuMemoryMB: json['gpuMemoryMB'],
    );
  }
}
