import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';
import '../providers/app_state.dart';
import '../models/deployed_model.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';
import '../services/hardware_service.dart';
import 'qr_scanner_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    final url = ref.read(serverUrlProvider);
    _urlController = TextEditingController(text: url);
    _detectHardware();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _detectHardware() async {
    final hwService = ref.read(hardwareServiceProvider);
    final info = await hwService.detectHardware();
    ref.read(deviceInfoProvider.notifier).state = info;
    hwService.startMetricsCollection();
  }

  Future<void> _connectToServer() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      ref.read(authErrorProvider.notifier).state = 'Enter a server URL';
      return;
    }

    // Save URL
    var normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://$normalizedUrl';
    }
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.substring(0, normalizedUrl.length - 1);
    }
    ref.read(serverUrlProvider.notifier).state = normalizedUrl;
    Hive.box('settings').put('serverUrl', normalizedUrl);

    ref.read(isConnectingProvider.notifier).state = true;
    ref.read(authErrorProvider.notifier).state = null;

    final apiService = ref.read(apiServiceProvider);
    final wsService = ref.read(webSocketServiceProvider);
    final deviceInfo = ref.read(deviceInfoProvider);

    try {
      // Step 1: Login
      final loggedIn = await apiService.login(normalizedUrl);
      if (!loggedIn) {
        ref.read(authErrorProvider.notifier).state = 'Authentication failed';
        ref.read(isConnectingProvider.notifier).state = false;
        return;
      }
      ref.read(isAuthenticatedProvider.notifier).state = true;

      // Step 2: Register device
      if (deviceInfo != null) {
        final result = await apiService.registerDevice(normalizedUrl, deviceInfo);
        final deviceId = result['id'] as String?;
        ref.read(deviceIdProvider.notifier).state = deviceId;
        Hive.box('settings').put('deviceId', deviceId);

        // Step 3: Connect WebSocket
        if (deviceId != null) {
          wsService.connect(normalizedUrl, deviceId, authToken: apiService.authToken);
        }
      }
    } catch (e) {
      ref.read(authErrorProvider.notifier).state = 'Connection failed: $e';
    } finally {
      ref.read(isConnectingProvider.notifier).state = false;
    }
  }

  void _disconnect() {
    final wsService = ref.read(webSocketServiceProvider);
    final apiService = ref.read(apiServiceProvider);
    wsService.disconnect();
    apiService.disconnect();
    ref.read(isAuthenticatedProvider.notifier).state = false;
    ref.read(deviceIdProvider.notifier).state = null;
    ref.read(authErrorProvider.notifier).state = null;
  }

  @override
  Widget build(BuildContext context) {
    final deviceInfo = ref.watch(deviceInfoProvider);
    final models = ref.watch(deployedModelsProvider);
    final wsService = ref.watch(webSocketServiceProvider);
    final connectionStatus = wsService.status;
    final isConnecting = ref.watch(isConnectingProvider);
    final authError = ref.watch(authErrorProvider);
    final deviceId = ref.watch(deviceIdProvider);
    final isAuthenticated = ref.watch(isAuthenticatedProvider);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: const Color(0xFF7B9FC7),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_awesome, size: 16, color: Colors.white),
            ),
            const SizedBox(width: 8),
            const Text('QpiAI Nexus', style: TextStyle(fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          // Connection indicator
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: connectionStatus == ConnectionStatus.connected
                        ? Colors.green
                        : isConnecting
                            ? Colors.amber
                            : Colors.red,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  isConnecting
                      ? 'connecting'
                      : connectionStatus == ConnectionStatus.connected
                          ? 'connected'
                          : isAuthenticated
                              ? 'authenticated'
                              : 'disconnected',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[400],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Server Connection Card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.cloud, color: Colors.grey[400], size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Server Connection',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[300],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _urlController,
                    decoration: InputDecoration(
                      labelText: 'Server URL',
                      labelStyle: TextStyle(color: Colors.grey[500], fontSize: 13),
                      hintText: 'https://your-tunnel.trycloudflare.com',
                      hintStyle: TextStyle(color: Colors.grey[700]),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey[800]!),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: BorderSide(color: Colors.grey[800]!),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                        borderSide: const BorderSide(color: Color(0xFF7B9FC7)),
                      ),
                      filled: true,
                      fillColor: const Color(0xFF121522),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                    style: const TextStyle(fontSize: 14),
                  ),
                  const SizedBox(height: 12),
                  if (authError != null) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.red.withAlpha(25),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline, color: Colors.red, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              authError,
                              style: const TextStyle(fontSize: 12, color: Colors.red),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (deviceId != null) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.green.withAlpha(25),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.check_circle, color: Colors.green, size: 16),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Connected \u2022 Device: $deviceId',
                              style: const TextStyle(fontSize: 12, color: Colors.green),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: isConnecting ? null : _connectToServer,
                          icon: isConnecting
                              ? const SizedBox(
                                  width: 14, height: 14,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.wifi, size: 16),
                          label: Text(
                            isConnecting
                                ? 'Connecting...'
                                : isAuthenticated
                                    ? 'Reconnect'
                                    : 'Connect & Register',
                            style: const TextStyle(fontSize: 13),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF7B9FC7),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        ),
                      ),
                      if (isAuthenticated) ...[
                        const SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: _disconnect,
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: Colors.grey[700]!),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                          child: const Text('Disconnect', style: TextStyle(fontSize: 13)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final result = await Navigator.of(context).push<Map<String, String>>(
                        MaterialPageRoute(builder: (_) => const QRScannerScreen()),
                      );
                      if (result != null && result['url'] != null) {
                        _urlController.text = result['url']!;
                        // If QR includes pairing token, set it on the API service
                        if (result['token'] != null) {
                          ref.read(apiServiceProvider).setAuthToken(result['token']);
                        }
                        _connectToServer();
                      }
                    },
                    icon: const Icon(Icons.qr_code_scanner, size: 16),
                    label: const Text('Scan QR Code', style: TextStyle(fontSize: 13)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFF7B9FC7)),
                      foregroundColor: const Color(0xFF7B9FC7),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                      minimumSize: const Size(double.infinity, 40),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Device Info Card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.phone_android, color: Colors.grey[400], size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Device Hardware',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[300],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (deviceInfo != null) ...[
                    _buildInfoRow('Device', deviceInfo.deviceName),
                    _buildInfoRow('Platform', deviceInfo.platform),
                    _buildInfoRow('CPU', '${deviceInfo.cpuModel} (${deviceInfo.cpuCores} cores)'),
                    _buildInfoRow('RAM', '${deviceInfo.ramGB} GB'),
                    _buildInfoRow('Storage', '${deviceInfo.storageGB} GB'),
                    if (deviceInfo.gpuModel != null)
                      _buildInfoRow('GPU', deviceInfo.gpuModel!),
                  ] else
                    const Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Models Summary
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.model_training, color: Colors.grey[400], size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Deployed Models',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[300],
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${models.length}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 20,
                          color: Color(0xFF7B9FC7),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (models.isEmpty)
                    Text(
                      'No models deployed yet. Connect to the server to discover models.',
                      style: TextStyle(color: Colors.grey[500], fontSize: 13),
                    )
                  else
                    ...models.map((m) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: m.status == ModelStatus.running
                                  ? Colors.green
                                  : Colors.grey,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              m.name,
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                          Text(
                            '${m.sizeMB.toStringAsFixed(0)} MB',
                            style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                          ),
                        ],
                      ),
                    )),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: Colors.grey[500]),
            ),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
