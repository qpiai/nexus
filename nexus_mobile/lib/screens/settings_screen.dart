import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive/hive.dart';
import '../providers/app_state.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    final url = ref.read(serverUrlProvider);
    _urlController = TextEditingController(text: url);
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;

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
      final loggedIn = await apiService.login(normalizedUrl);
      if (!loggedIn) {
        ref.read(authErrorProvider.notifier).state = 'Authentication failed';
        ref.read(isConnectingProvider.notifier).state = false;
        return;
      }
      ref.read(isAuthenticatedProvider.notifier).state = true;

      if (deviceInfo != null) {
        final result = await apiService.registerDevice(normalizedUrl, deviceInfo);
        final deviceId = result['id'] as String?;
        ref.read(deviceIdProvider.notifier).state = deviceId;
        Hive.box('settings').put('deviceId', deviceId);

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

  @override
  Widget build(BuildContext context) {
    final wsService = ref.watch(webSocketServiceProvider);
    final connectionStatus = wsService.status;
    final deviceId = ref.watch(deviceIdProvider);
    final isConnecting = ref.watch(isConnectingProvider);
    final isAuthenticated = ref.watch(isAuthenticatedProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Server Connection
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
                  const SizedBox(height: 16),

                  // Status
                  Row(
                    children: [
                      Container(
                        width: 8, height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: connectionStatus == ConnectionStatus.connected
                              ? Colors.green
                              : isConnecting
                                  ? Colors.amber
                                  : Colors.red,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Status: ${isConnecting ? "connecting" : connectionStatus.name}',
                        style: TextStyle(fontSize: 13, color: Colors.grey[400]),
                      ),
                    ],
                  ),
                  if (deviceId != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Device ID: $deviceId',
                      style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                    ),
                  ],
                  const SizedBox(height: 12),

                  // URL Input
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

                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: isConnecting ? null : _connect,
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
                                    : 'Connect',
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
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: connectionStatus == ConnectionStatus.connected
                            ? () {
                                ref.read(webSocketServiceProvider).disconnect();
                                ref.read(apiServiceProvider).disconnect();
                                ref.read(isAuthenticatedProvider.notifier).state = false;
                                ref.read(deviceIdProvider.notifier).state = null;
                              }
                            : null,
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(color: Colors.grey[700]!),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: const Text('Disconnect', style: TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // App Info
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline, color: Colors.grey[400], size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'About',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[300],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _buildAboutRow('App', 'QpiAI Nexus'),
                  _buildAboutRow('Version', '1.0.0'),
                  _buildAboutRow('Platform', Theme.of(context).platform.name),
                  _buildAboutRow('Purpose', 'Hardware-aware LLM deployment'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Notifications
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.notifications_outlined, color: Colors.grey[400], size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Notifications',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[300],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    title: const Text('Deployment Alerts', style: TextStyle(fontSize: 14)),
                    subtitle: Text('Notify on model deploy/stop', style: TextStyle(fontSize: 12, color: Colors.grey[500])),
                    value: true,
                    onChanged: (_) {},
                    activeColor: const Color(0xFF7B9FC7),
                    contentPadding: EdgeInsets.zero,
                  ),
                  SwitchListTile(
                    title: const Text('Thermal Warnings', style: TextStyle(fontSize: 14)),
                    subtitle: Text('Alert when device overheats', style: TextStyle(fontSize: 12, color: Colors.grey[500])),
                    value: true,
                    onChanged: (_) {},
                    activeColor: const Color(0xFF7B9FC7),
                    contentPadding: EdgeInsets.zero,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAboutRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(label, style: TextStyle(fontSize: 12, color: Colors.grey[500])),
          ),
          Text(value, style: const TextStyle(fontSize: 13)),
        ],
      ),
    );
  }
}
