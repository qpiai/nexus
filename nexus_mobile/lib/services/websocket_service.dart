import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum ConnectionStatus { disconnected, connecting, connected, error }

/// SSE-based connection to the Nexus server.
///
/// The server's /api/mobile/ws endpoint uses Server-Sent Events (HTTP GET),
/// not WebSocket. This service connects via HTTP and parses the SSE stream.
class WebSocketService {
  http.Client? _client;
  ConnectionStatus _status = ConnectionStatus.disconnected;
  String? _serverUrl;
  String? _deviceId;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  String? _authToken;

  final _statusController = StreamController<ConnectionStatus>.broadcast();
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  Stream<Map<String, dynamic>> get messageStream => _messageController.stream;
  ConnectionStatus get status => _status;
  String? get deviceId => _deviceId;

  Future<void> connect(String serverUrl, String deviceId, {String? authToken}) async {
    _serverUrl = serverUrl;
    _deviceId = deviceId;
    _authToken = authToken;
    _setStatus(ConnectionStatus.connecting);

    // Close any existing connection
    _client?.close();
    _client = null;

    try {
      final baseUrl = serverUrl.replaceAll(RegExp(r'/$'), '');
      var uriStr = '$baseUrl/api/mobile/ws?deviceId=$deviceId';
      if (authToken != null) {
        uriStr += '&token=$authToken';
      }
      final uri = Uri.parse(uriStr);

      _client = http.Client();
      final request = http.Request('GET', uri);
      request.headers['Accept'] = 'text/event-stream';
      request.headers['Cache-Control'] = 'no-cache';
      if (authToken != null) {
        request.headers['Authorization'] = 'Bearer $authToken';
      }

      final response = await _client!.send(request);

      if (response.statusCode != 200) {
        _setStatus(ConnectionStatus.error);
        _scheduleReconnect();
        return;
      }

      _setStatus(ConnectionStatus.connected);
      _startHeartbeat();

      // Parse SSE stream
      String buffer = '';
      String currentEvent = '';

      response.stream.transform(utf8.decoder).listen(
        (chunk) {
          buffer += chunk;
          final lines = buffer.split('\n');
          buffer = lines.removeLast(); // Keep incomplete line in buffer

          for (final line in lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.substring(7).trim();
            } else if (line.startsWith('data: ') && currentEvent.isNotEmpty) {
              final dataStr = line.substring(6).trim();
              try {
                final data = jsonDecode(dataStr);
                if (data is Map<String, dynamic>) {
                  // Add event type to the message for handler compatibility
                  data['_event'] = currentEvent;
                  _messageController.add(data);
                  _handleMessage(currentEvent, data);
                }
              } catch (_) {
                // Skip malformed JSON
              }
              currentEvent = '';
            } else if (line.startsWith('data: ')) {
              // Data without preceding event — try to parse as typed message
              final dataStr = line.substring(6).trim();
              try {
                final data = jsonDecode(dataStr);
                if (data is Map<String, dynamic>) {
                  final type = data['type'] as String? ?? '';
                  _messageController.add(data);
                  _handleMessage(type, data);
                }
              } catch (_) {}
            }
            // Empty line resets event state (SSE spec)
            if (line.trim().isEmpty) {
              currentEvent = '';
            }
          }
        },
        onDone: () {
          _setStatus(ConnectionStatus.disconnected);
          _scheduleReconnect();
        },
        onError: (error) {
          _setStatus(ConnectionStatus.error);
          _scheduleReconnect();
        },
      );
    } catch (e) {
      _setStatus(ConnectionStatus.error);
      _scheduleReconnect();
    }
  }

  void _handleMessage(String type, Map<String, dynamic> data) {
    switch (type) {
      case 'deploy':
      case 'deploy_model':
        // Handle model deployment push from server
        break;
      case 'stop_model':
        break;
      case 'get_metrics':
        break;
      case 'run_inference':
        break;
    }
  }

  /// Send metrics to the server via HTTP POST (SSE is read-only).
  void sendMetrics(Map<String, dynamic> metrics) {
    if (_serverUrl == null || _deviceId == null) return;
    final baseUrl = _serverUrl!.replaceAll(RegExp(r'/$'), '');
    final uri = Uri.parse('$baseUrl/api/telemetry/report');
    final headers = <String, String>{
      'Content-Type': 'application/json',
    };
    if (_authToken != null) {
      headers['Authorization'] = 'Bearer $_authToken';
    }
    // Fire-and-forget
    http.post(
      uri,
      headers: headers,
      body: jsonEncode({
        'deviceId': _deviceId,
        ...metrics,
      }),
    ).catchError((_) => http.Response('', 0));
  }

  void _setStatus(ConnectionStatus status) {
    _status = status;
    _statusController.add(status);
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    // SSE is read-only, so heartbeat sends metrics via HTTP POST
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      sendMetrics({'type': 'heartbeat', 'timestamp': DateTime.now().millisecondsSinceEpoch});
    });
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (_serverUrl != null && _deviceId != null) {
        connect(_serverUrl!, _deviceId!, authToken: _authToken);
      }
    });
  }

  void disconnect() {
    _reconnectTimer?.cancel();
    _heartbeatTimer?.cancel();
    _client?.close();
    _client = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  void dispose() {
    disconnect();
    _statusController.close();
    _messageController.close();
  }
}

final webSocketServiceProvider = Provider<WebSocketService>((ref) {
  final service = WebSocketService();
  ref.onDispose(() => service.dispose());
  return service;
});
