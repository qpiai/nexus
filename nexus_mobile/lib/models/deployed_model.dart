enum ModelStatus { idle, loading, running, error }

class DeployedModel {
  final String id;
  final String name;
  final String fileName;
  final String method; // GGUF or AWQ
  final double sizeMB;
  final DateTime deployedAt;
  ModelStatus status;

  DeployedModel({
    required this.id,
    required this.name,
    required this.fileName,
    required this.method,
    required this.sizeMB,
    required this.deployedAt,
    this.status = ModelStatus.idle,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'fileName': fileName,
    'method': method,
    'sizeMB': sizeMB,
    'deployedAt': deployedAt.toIso8601String(),
    'status': status.name,
  };

  factory DeployedModel.fromJson(Map<String, dynamic> json) {
    return DeployedModel(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      fileName: json['fileName'] ?? '',
      method: json['method'] ?? 'GGUF',
      sizeMB: (json['sizeMB'] ?? 0).toDouble(),
      deployedAt: DateTime.tryParse(json['deployedAt'] ?? '') ?? DateTime.now(),
      status: ModelStatus.values.firstWhere(
        (s) => s.name == json['status'],
        orElse: () => ModelStatus.idle,
      ),
    );
  }
}
