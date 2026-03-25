import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';

enum InferenceStatus { idle, loading, running, error }

class ServerModel {
  final String name;
  final String file;
  final String method;
  final int sizeMB;

  const ServerModel({
    required this.name,
    required this.file,
    required this.method,
    required this.sizeMB,
  });

  factory ServerModel.fromJson(Map<String, dynamic> json) {
    return ServerModel(
      name: json['name'] as String,
      file: json['file'] as String,
      method: json['method'] as String,
      sizeMB: json['sizeMB'] as int,
    );
  }

  bool get isGGUF => method == 'GGUF';
}

class InferenceResult {
  final String text;
  final int tokensGenerated;
  final double timeMs;
  final double tokensPerSec;

  const InferenceResult({
    required this.text,
    required this.tokensGenerated,
    required this.timeMs,
    required this.tokensPerSec,
  });
}

class InferenceService {
  InferenceStatus _status = InferenceStatus.idle;
  List<ServerModel> _models = [];
  http.Client? _activeClient;

  InferenceStatus get status => _status;
  List<ServerModel> get models => _models;
  List<ServerModel> get ggufModels => _models.where((m) => m.isGGUF).toList();

  final _statusController = StreamController<InferenceStatus>.broadcast();
  Stream<InferenceStatus> get statusStream => _statusController.stream;

  String get _serverUrl {
    final box = Hive.box('settings');
    return box.get('serverUrl', defaultValue: 'http://localhost:6001');
  }

  /// Fetch available models from the Nexus server
  Future<List<ServerModel>> fetchModels() async {
    try {
      final url = '$_serverUrl/api/chat/models';
      final res = await http.get(Uri.parse(url)).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = json.decode(res.body);
        final list = (data['models'] as List?) ?? [];
        _models = list.map((m) => ServerModel.fromJson(m)).toList();
        return _models;
      }
    } catch (_) {
      // Return empty on error
    }
    return [];
  }

  /// Run inference via server SSE streaming
  /// Yields tokens as they arrive from the server's /api/chat endpoint
  Stream<String> generateStream(
    ServerModel model,
    List<Map<String, String>> messages, {
    int maxTokens = 512,
    String? imageBase64,
  }) async* {
    _status = InferenceStatus.running;
    _statusController.add(_status);

    final client = http.Client();
    _activeClient = client;

    try {
      final url = '$_serverUrl/api/chat';
      final request = http.Request('POST', Uri.parse(url));
      request.headers['Content-Type'] = 'application/json';
      final body = <String, dynamic>{
        'model': model.file,
        'method': model.method,
        'messages': messages,
        'maxTokens': maxTokens,
      };
      if (imageBase64 != null) {
        body['image'] = imageBase64;
      }
      request.body = json.encode(body);

      final response = await client.send(request).timeout(const Duration(seconds: 30));

      if (response.statusCode != 200) {
        throw Exception('Server error (${response.statusCode})');
      }

      // Parse SSE stream
      String buffer = '';
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        buffer += chunk;
        final lines = buffer.split('\n');
        buffer = lines.removeLast(); // Keep incomplete line in buffer

        String eventType = '';
        for (final line in lines) {
          if (line.startsWith('event: ')) {
            eventType = line.substring(7);
          } else if (line.startsWith('data: ')) {
            try {
              final data = json.decode(line.substring(6));
              if (eventType == 'token') {
                final text = data['text'] as String? ?? '';
                if (text.isNotEmpty) {
                  yield text;
                }
              } else if (eventType == 'error') {
                throw Exception(data['message'] ?? 'Server error');
              }
              // 'status', 'metrics', 'done' events are informational
            } catch (e) {
              if (e is Exception && e.toString().contains('Server error')) {
                rethrow;
              }
              // Skip malformed data lines
            }
          }
        }
      }

      _status = InferenceStatus.idle;
      _statusController.add(_status);
    } catch (e) {
      _status = InferenceStatus.error;
      _statusController.add(_status);
      rethrow;
    } finally {
      _activeClient = null;
      client.close();
    }
  }

  /// Cancel active request
  void cancel() {
    _activeClient?.close();
    _activeClient = null;
    _status = InferenceStatus.idle;
    _statusController.add(_status);
  }

  void dispose() {
    _activeClient?.close();
    _statusController.close();
  }
}

final inferenceServiceProvider = Provider<InferenceService>((ref) {
  final service = InferenceService();
  ref.onDispose(() => service.dispose());
  return service;
});
