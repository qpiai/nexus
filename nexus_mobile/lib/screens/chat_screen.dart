import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../services/inference_service.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _imagePicker = ImagePicker();
  final List<_ChatMessage> _messages = [];
  List<ServerModel> _models = [];
  ServerModel? _selectedModel;
  bool _generating = false;
  bool _loadingModels = true;
  String? _error;
  Uint8List? _attachedImageBytes;
  String? _attachedImageBase64;

  @override
  void initState() {
    super.initState();
    _loadModels();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadModels() async {
    setState(() {
      _loadingModels = true;
      _error = null;
    });

    final inferenceService = ref.read(inferenceServiceProvider);
    final models = await inferenceService.fetchModels();
    final ggufModels = models.where((m) => m.isGGUF).toList();

    if (mounted) {
      setState(() {
        _models = ggufModels;
        if (ggufModels.isNotEmpty) {
          _selectedModel = ggufModels.first;
        }
        _loadingModels = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _pickImage() async {
    final picked = await _imagePicker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 80,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    setState(() {
      _attachedImageBytes = bytes;
      _attachedImageBase64 = base64Encode(bytes);
    });
  }

  void _clearImage() {
    setState(() {
      _attachedImageBytes = null;
      _attachedImageBase64 = null;
    });
  }

  Future<void> _sendMessage() async {
    final text = _controller.text.trim();
    final imageBytes = _attachedImageBytes;
    final imageBase64 = _attachedImageBase64;
    if ((text.isEmpty && imageBase64 == null) || _generating || _selectedModel == null) return;

    final content = text.isEmpty ? 'What\'s in this image?' : text;

    setState(() {
      _messages.add(_ChatMessage(role: 'user', content: content, imageBytes: imageBytes));
      _messages.add(_ChatMessage(role: 'assistant', content: ''));
      _generating = true;
      _error = null;
      _attachedImageBytes = null;
      _attachedImageBase64 = null;
    });
    _controller.clear();
    _scrollToBottom();

    final inferenceService = ref.read(inferenceServiceProvider);

    // Build message history
    final history = _messages
        .where((m) => m.content.isNotEmpty || m.role == 'user')
        .take(_messages.length - 1) // Exclude the empty assistant placeholder
        .map((m) => {'role': m.role, 'content': m.content})
        .toList();

    try {
      final stream = inferenceService.generateStream(
        _selectedModel!,
        history,
        imageBase64: imageBase64,
      );
      await for (final token in stream) {
        if (!mounted) return;
        setState(() {
          _messages.last.content += token;
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          if (_messages.last.content.isEmpty) {
            _messages.last.content = 'Error: ${e.toString().replaceAll('Exception: ', '')}';
          }
          _error = e.toString().replaceAll('Exception: ', '');
        });
      }
    }

    if (mounted) {
      setState(() {
        _generating = false;
      });
    }
  }

  void _stopGeneration() {
    ref.read(inferenceServiceProvider).cancel();
    setState(() {
      _generating = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: _loadModels,
            tooltip: 'Reload models',
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 20),
            onPressed: () => setState(() {
              _messages.clear();
              _error = null;
              _attachedImageBytes = null;
              _attachedImageBase64 = null;
            }),
          ),
        ],
      ),
      body: Column(
        children: [
          // Model selector bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF0C0E1A),
              border: Border(bottom: BorderSide(color: Colors.grey[800]!)),
            ),
            child: _loadingModels
                ? Row(
                    children: [
                      const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 8),
                      Text('Loading models from server...',
                          style: TextStyle(fontSize: 13, color: Colors.grey[500])),
                    ],
                  )
                : _models.isEmpty
                    ? Row(
                        children: [
                          Icon(Icons.warning_amber, size: 16, color: Colors.amber[400]),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'No GGUF models on server. Check Settings for server URL.',
                              style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                            ),
                          ),
                        ],
                      )
                    : Row(
                        children: [
                          const Icon(Icons.smart_toy, size: 16, color: Color(0xFF7B9FC7)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: DropdownButton<String>(
                              value: _selectedModel?.file,
                              dropdownColor: const Color(0xFF121522),
                              style: const TextStyle(fontSize: 13, color: Colors.white),
                              isExpanded: true,
                              underline: const SizedBox(),
                              items: _models
                                  .map((m) => DropdownMenuItem(
                                        value: m.file,
                                        child: Text(
                                          '${m.name} (${m.sizeMB} MB)',
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ))
                                  .toList(),
                              onChanged: (v) {
                                setState(() {
                                  _selectedModel = _models.firstWhere((m) => m.file == v);
                                });
                              },
                            ),
                          ),
                          if (_selectedModel != null) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF7B9FC7).withAlpha(25),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: const Color(0xFF7B9FC7).withAlpha(60)),
                              ),
                              child: Text(
                                _selectedModel!.method,
                                style: const TextStyle(
                                    fontSize: 10, color: Color(0xFF7B9FC7), fontWeight: FontWeight.w500),
                              ),
                            ),
                          ],
                        ],
                      ),
          ),

          // Error banner
          if (_error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.red.withAlpha(20),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, size: 14, color: Colors.red),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_error!, style: const TextStyle(fontSize: 12, color: Colors.red)),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 14),
                    onPressed: () => setState(() => _error = null),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
            ),

          // Messages
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.chat_bubble_outline, size: 48, color: Colors.grey[700]),
                        const SizedBox(height: 16),
                        Text(
                          'Chat with your model',
                          style: TextStyle(fontSize: 18, color: Colors.grey[400]),
                        ),
                        const SizedBox(height: 8),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 32),
                          child: Text(
                            _models.isNotEmpty
                                ? 'Select a GGUF model above and start chatting.\nInference runs on the Nexus server.'
                                : 'Connect to your Nexus server in Settings,\nthen quantize a model to start chatting.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 13, color: Colors.grey[600]),
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final msg = _messages[index];
                      final isUser = msg.role == 'user';

                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment:
                              isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
                          children: [
                            if (!isUser) ...[
                              CircleAvatar(
                                radius: 14,
                                backgroundColor: const Color(0xFF7B9FC7).withAlpha(40),
                                child: const Icon(Icons.smart_toy, size: 14, color: Color(0xFF7B9FC7)),
                              ),
                              const SizedBox(width: 8),
                            ],
                            Flexible(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                decoration: BoxDecoration(
                                  color: isUser
                                      ? const Color(0xFF7B9FC7).withAlpha(40)
                                      : const Color(0xFF121522),
                                  borderRadius: BorderRadius.circular(16).copyWith(
                                    topRight: isUser ? const Radius.circular(4) : null,
                                    topLeft: !isUser ? const Radius.circular(4) : null,
                                  ),
                                  border: Border.all(
                                    color: isUser
                                        ? const Color(0xFF7B9FC7).withAlpha(60)
                                        : const Color(0xFF1A1D2E),
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (msg.imageBytes != null)
                                      Padding(
                                        padding: const EdgeInsets.only(bottom: 8),
                                        child: ClipRRect(
                                          borderRadius: BorderRadius.circular(8),
                                          child: Image.memory(
                                            msg.imageBytes!,
                                            width: 180,
                                            fit: BoxFit.cover,
                                          ),
                                        ),
                                      ),
                                    Text(
                                      msg.content.isEmpty && _generating && index == _messages.length - 1
                                          ? '...'
                                          : msg.content,
                                      style: TextStyle(
                                        fontSize: 14,
                                        color: Colors.grey[300],
                                        height: 1.4,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            if (isUser) ...[
                              const SizedBox(width: 8),
                              CircleAvatar(
                                radius: 14,
                                backgroundColor: Colors.grey[800],
                                child: Icon(Icons.person, size: 14, color: Colors.grey[400]),
                              ),
                            ],
                          ],
                        ),
                      );
                    },
                  ),
          ),

          // Image preview
          if (_attachedImageBytes != null)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: const Color(0xFF0C0E1A),
              child: Row(
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.memory(
                          _attachedImageBytes!,
                          width: 56,
                          height: 56,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(
                        top: -6,
                        right: -6,
                        child: GestureDetector(
                          onTap: _clearImage,
                          child: Container(
                            width: 20,
                            height: 20,
                            decoration: const BoxDecoration(
                              color: Color(0xFFF87171),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.close, size: 12, color: Colors.white),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                ],
              ),
            ),

          // Input
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF0C0E1A),
              border: Border(top: BorderSide(color: Colors.grey[800]!)),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  // Image picker button
                  IconButton(
                    onPressed: _models.isNotEmpty && !_generating ? _pickImage : null,
                    icon: Icon(
                      Icons.image_outlined,
                      color: _attachedImageBytes != null
                          ? const Color(0xFFD63384)
                          : Colors.grey[600],
                      size: 22,
                    ),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: InputDecoration(
                        hintText: _models.isEmpty
                            ? 'No models available...'
                            : _generating
                                ? 'Waiting for response...'
                                : 'Type a message...',
                        hintStyle: TextStyle(color: Colors.grey[600]),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.grey[800]!),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.grey[800]!),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(color: Color(0xFF7B9FC7)),
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        filled: true,
                        fillColor: const Color(0xFF121522),
                      ),
                      style: const TextStyle(fontSize: 14),
                      maxLines: 3,
                      minLines: 1,
                      enabled: _models.isNotEmpty && !_generating,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _generating
                      ? IconButton(
                          onPressed: _stopGeneration,
                          icon: const Icon(Icons.stop_circle, color: Colors.red, size: 28),
                        )
                      : IconButton(
                          onPressed: _models.isEmpty ? null : _sendMessage,
                          icon: Icon(
                            Icons.send,
                            color: _models.isEmpty ? Colors.grey[700] : const Color(0xFF7B9FC7),
                          ),
                        ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatMessage {
  String role;
  String content;
  Uint8List? imageBytes;

  _ChatMessage({required this.role, required this.content, this.imageBytes});
}
