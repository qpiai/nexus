import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../services/hardware_service.dart';
import '../models/metrics.dart';

class MetricsScreen extends ConsumerStatefulWidget {
  const MetricsScreen({super.key});

  @override
  ConsumerState<MetricsScreen> createState() => _MetricsScreenState();
}

class _MetricsScreenState extends ConsumerState<MetricsScreen> {
  final List<DeviceMetrics> _history = [];
  StreamSubscription? _subscription;

  @override
  void initState() {
    super.initState();
    final hwService = ref.read(hardwareServiceProvider);
    _subscription = hwService.metricsStream.listen((metrics) {
      setState(() {
        _history.add(metrics);
        if (_history.length > 60) _history.removeAt(0);
      });
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  List<FlSpot> _getSpots(double Function(DeviceMetrics) getter) {
    return _history.asMap().entries.map((e) {
      return FlSpot(e.key.toDouble(), getter(e.value));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final latest = _history.isNotEmpty ? _history.last : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Metrics'),
        actions: [
          if (_history.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.green.withAlpha(30),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 6, height: 6,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.green,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Text('Live', style: TextStyle(fontSize: 11, color: Colors.green)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Summary Cards
          Row(
            children: [
              Expanded(child: _MetricCard(
                label: 'CPU',
                value: latest != null ? '${latest.cpuUsage.toStringAsFixed(0)}%' : '—',
                color: Colors.blue,
                icon: Icons.memory,
              )),
              const SizedBox(width: 8),
              Expanded(child: _MetricCard(
                label: 'Memory',
                value: latest != null ? '${latest.memoryUsage.toStringAsFixed(0)}%' : '—',
                color: Colors.purple,
                icon: Icons.storage,
              )),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _MetricCard(
                label: 'Temp',
                value: latest != null ? '${latest.temperature.toStringAsFixed(0)}°C' : '—',
                color: Colors.red,
                icon: Icons.thermostat,
              )),
              const SizedBox(width: 8),
              Expanded(child: _MetricCard(
                label: 'Battery',
                value: latest != null ? '${latest.batteryLevel.toStringAsFixed(0)}%' : '—',
                color: Colors.green,
                icon: Icons.battery_std,
              )),
            ],
          ),
          const SizedBox(height: 20),

          // CPU Chart
          _buildChart('CPU Usage (%)', Colors.blue, (m) => m.cpuUsage),
          const SizedBox(height: 20),

          // Memory Chart
          _buildChart('Memory Usage (%)', Colors.purple, (m) => m.memoryUsage),
          const SizedBox(height: 20),

          // Temperature Chart
          _buildChart('Temperature (°C)', Colors.red, (m) => m.temperature),
        ],
      ),
    );
  }

  Widget _buildChart(String title, Color color, double Function(DeviceMetrics) getter) {
    final spots = _getSpots(getter);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 8, height: 8,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: color),
                ),
                const SizedBox(width: 8),
                Text(title, style: TextStyle(fontSize: 13, color: Colors.grey[400])),
                const Spacer(),
                if (spots.isNotEmpty)
                  Text(
                    spots.last.y.toStringAsFixed(1),
                    style: TextStyle(fontSize: 13, color: color, fontWeight: FontWeight.w600),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 120,
              child: spots.length < 2
                  ? Center(
                      child: Text(
                        'Collecting data...',
                        style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      ),
                    )
                  : LineChart(
                      LineChartData(
                        gridData: const FlGridData(show: false),
                        titlesData: const FlTitlesData(show: false),
                        borderData: FlBorderData(show: false),
                        lineBarsData: [
                          LineChartBarData(
                            spots: spots,
                            isCurved: true,
                            color: color,
                            barWidth: 2,
                            dotData: const FlDotData(show: false),
                            belowBarData: BarAreaData(
                              show: true,
                              color: color.withAlpha(30),
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                color: color.withAlpha(25),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 11, color: Colors.grey[500])),
                Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
