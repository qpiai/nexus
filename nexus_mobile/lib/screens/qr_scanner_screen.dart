import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class QRScannerScreen extends StatefulWidget {
  const QRScannerScreen({super.key});

  @override
  State<QRScannerScreen> createState() => _QRScannerScreenState();
}

class _QRScannerScreenState extends State<QRScannerScreen> {
  bool _scanned = false;

  /// Returns a map with 'url' and optionally 'token' from QR data.
  Map<String, String>? _extractQrData(String raw) {
    // Try JSON format: {"url":"https://...","token":"...","ts":123}
    try {
      final json = jsonDecode(raw);
      if (json is Map && json['url'] is String) {
        String url = json['url'] as String;
        if (url.startsWith('http')) {
          final cleanUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
          final result = <String, String>{'url': cleanUrl};
          if (json['token'] is String) {
            result['token'] = json['token'] as String;
          }
          return result;
        }
      }
    } catch (_) {}

    // Fallback: raw URL (no pairing token)
    final trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      final cleanUrl = trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
      return {'url': cleanUrl};
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan QR Code'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              if (_scanned) return;
              final barcodes = capture.barcodes;
              for (final barcode in barcodes) {
                final raw = barcode.rawValue;
                if (raw == null) continue;
                final qrData = _extractQrData(raw);
                if (qrData != null) {
                  _scanned = true;
                  Navigator.of(context).pop(qrData);
                  return;
                }
              }
            },
          ),
          Positioned(
            top: 24,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Point at the QR code on the Nexus dashboard',
                  style: TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
