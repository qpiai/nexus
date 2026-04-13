import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/device_info.dart';

class NexusApiService {
  String? _authToken;
  String? _deviceId;

  String? get authToken => _authToken;
  String? get deviceId => _deviceId;
  bool get isAuthenticated => _authToken != null;

  Map<String, String> _headers({bool withAuth = true}) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (withAuth && _authToken != null) {
      headers['Authorization'] = 'Bearer $_authToken';
    }
    return headers;
  }

  /// Set auth token directly (from QR pairing token or saved device token).
  void setAuthToken(String? token) {
    _authToken = token;
  }

  /// Login to the Nexus server. Returns true on success.
  /// The server sets an auth cookie; we also extract a token if provided.
  Future<bool> login(String serverUrl) async {
    final url = Uri.parse('${serverUrl.replaceAll(RegExp(r'/$'), '')}/api/auth/login');
    try {
      final response = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'username': 'admin',
          'password': 'qpiai-nexus',
        }),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final token = data['token'] as String?;
        if (token != null) {
          _authToken = token;
        }
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Register this device with the server.
  Future<Map<String, dynamic>> registerDevice(
    String serverUrl,
    DeviceHardwareInfo deviceInfo,
  ) async {
    final url = Uri.parse('${serverUrl.replaceAll(RegExp(r'/$'), '')}/api/mobile/register');
    final response = await http.post(
      url,
      headers: _headers(),
      body: jsonEncode({
        'name': deviceInfo.deviceName,
        'platform': deviceInfo.platform,
        'hardware': {
          'cpuModel': deviceInfo.cpuModel,
          'cpuCores': deviceInfo.cpuCores,
          'ramGB': deviceInfo.ramGB.round(),
          'storageGB': deviceInfo.storageGB.round(),
        },
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      _deviceId = data['id'] as String?;
      // Store device token from registration response
      final deviceToken = data['token'] as String?;
      if (deviceToken != null) {
        _authToken = deviceToken;
      }
      return data;
    }
    throw Exception('Registration failed: ${response.statusCode}');
  }

  /// Fetch available mobile models from the server.
  Future<List<dynamic>> fetchModels(String serverUrl) async {
    final url = Uri.parse('${serverUrl.replaceAll(RegExp(r'/$'), '')}/api/mobile/models');
    final response = await http.get(url, headers: _headers());

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['models'] as List<dynamic>? ?? [];
    }
    throw Exception('Failed to fetch models: ${response.statusCode}');
  }

  /// Send device metrics to the server.
  Future<void> sendMetrics(
    String serverUrl,
    String deviceId,
    Map<String, dynamic> metrics,
  ) async {
    final url = Uri.parse('${serverUrl.replaceAll(RegExp(r'/$'), '')}/api/telemetry/report');
    try {
      await http.post(
        url,
        headers: _headers(),
        body: jsonEncode({
          'deviceId': deviceId,
          ...metrics,
        }),
      );
    } catch (_) {
      // Metrics are best-effort, don't throw
    }
  }

  void disconnect() {
    _authToken = null;
    _deviceId = null;
  }
}

final apiServiceProvider = Provider<NexusApiService>((ref) {
  return NexusApiService();
});
