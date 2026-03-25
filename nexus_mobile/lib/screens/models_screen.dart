import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/app_state.dart';
import '../models/deployed_model.dart';

class ModelsScreen extends ConsumerWidget {
  const ModelsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final models = ref.watch(deployedModelsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Models'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {},
          ),
        ],
      ),
      body: models.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.model_training, size: 48, color: Colors.grey[700]),
                  const SizedBox(height: 16),
                  Text(
                    'No Models Deployed',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w500,
                      color: Colors.grey[400],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Deploy models from the Nexus server\nto run them on this device.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: Colors.grey[600]),
                  ),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: models.length,
              itemBuilder: (context, index) {
                final model = models[index];
                return _ModelCard(model: model);
              },
            ),
    );
  }
}

class _ModelCard extends ConsumerWidget {
  final DeployedModel model;

  const _ModelCard({required this.model});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isRunning = model.status == ModelStatus.running;
    final isLoading = model.status == ModelStatus.loading;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        model.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          _Badge(label: model.method, color: model.method == 'GGUF'
                              ? const Color(0xFF7B9FC7)
                              : const Color(0xFF10B981)),
                          const SizedBox(width: 6),
                          _Badge(label: '${model.sizeMB.toStringAsFixed(0)} MB',
                              color: Colors.grey),
                        ],
                      ),
                    ],
                  ),
                ),
                // Status indicator
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: isRunning
                        ? Colors.green.withAlpha(30)
                        : isLoading
                            ? Colors.amber.withAlpha(30)
                            : Colors.grey.withAlpha(30),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (isLoading)
                        const SizedBox(
                          width: 12, height: 12,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      else
                        Container(
                          width: 6, height: 6,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isRunning ? Colors.green : Colors.grey,
                          ),
                        ),
                      const SizedBox(width: 6),
                      Text(
                        model.status.name,
                        style: TextStyle(
                          fontSize: 11,
                          color: isRunning ? Colors.green : Colors.grey[400],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: isLoading ? null : () {
                      final notifier = ref.read(deployedModelsProvider.notifier);
                      if (isRunning) {
                        notifier.updateStatus(model.id, ModelStatus.idle);
                      } else {
                        notifier.updateStatus(model.id, ModelStatus.loading);
                        Future.delayed(const Duration(seconds: 2), () {
                          notifier.updateStatus(model.id, ModelStatus.running);
                        });
                      }
                    },
                    icon: Icon(isRunning ? Icons.stop : Icons.play_arrow, size: 16),
                    label: Text(isRunning ? 'Stop' : 'Start', style: const TextStyle(fontSize: 13)),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(color: Colors.grey[700]!),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: isRunning ? () {} : null,
                    icon: const Icon(Icons.chat, size: 16),
                    label: const Text('Chat', style: TextStyle(fontSize: 13)),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(color: Colors.grey[700]!),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () {
                    ref.read(deployedModelsProvider.notifier).removeModel(model.id);
                  },
                  icon: const Icon(Icons.delete_outline, size: 18, color: Colors.red),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withAlpha(60)),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w500),
      ),
    );
  }
}
