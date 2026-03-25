import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';
import '../models/device_info.dart';
import '../models/deployed_model.dart';
import '../models/metrics.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';

// Server URL
final serverUrlProvider = StateProvider<String>((ref) {
  final box = Hive.box('settings');
  return box.get('serverUrl', defaultValue: '');
});

// Auth state
final isAuthenticatedProvider = StateProvider<bool>((ref) => false);
final deviceIdProvider = StateProvider<String?>((ref) => null);
final authErrorProvider = StateProvider<String?>((ref) => null);
final isConnectingProvider = StateProvider<bool>((ref) => false);

// Connection status
final connectionStatusProvider = StreamProvider<ConnectionStatus>((ref) {
  final wsService = ref.watch(webSocketServiceProvider);
  return wsService.statusStream;
});

// Device info
final deviceInfoProvider = StateProvider<DeviceHardwareInfo?>((ref) => null);

// Deployed models
final deployedModelsProvider = StateNotifierProvider<DeployedModelsNotifier, List<DeployedModel>>((ref) {
  return DeployedModelsNotifier();
});

class DeployedModelsNotifier extends StateNotifier<List<DeployedModel>> {
  DeployedModelsNotifier() : super([]) {
    _loadFromStorage();
  }

  void _loadFromStorage() {
    final box = Hive.box('models');
    final models = box.get('deployed', defaultValue: []);
    if (models is List) {
      state = models
          .map((m) => DeployedModel.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    }
  }

  void _saveToStorage() {
    final box = Hive.box('models');
    box.put('deployed', state.map((m) => m.toJson()).toList());
  }

  void addModel(DeployedModel model) {
    state = [...state, model];
    _saveToStorage();
  }

  void removeModel(String id) {
    state = state.where((m) => m.id != id).toList();
    _saveToStorage();
  }

  void updateStatus(String id, ModelStatus status) {
    state = state.map((m) {
      if (m.id == id) {
        m.status = status;
        return m;
      }
      return m;
    }).toList();
    _saveToStorage();
  }
}

// Metrics history
final metricsHistoryProvider = StateProvider<List<DeviceMetrics>>((ref) => []);

// Chat messages per model
final chatMessagesProvider = StateProvider.family<List<Map<String, String>>, String>(
  (ref, modelId) => [],
);
