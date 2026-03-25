import SwiftUI
import PhotosUI
import CoreImage

struct VisionView: View {
    @Environment(AppState.self) private var appState
    @State private var selectedItem: PhotosPickerItem?
    @State private var selectedImage: UIImage?
    @State private var detections: [Detection] = []
    @State private var inferenceTimeMs: Int = 0
    @State private var isDetecting = false
    @State private var visionModels: [VisionModelInfo] = []
    @State private var selectedModelIndex = 0
    @State private var errorMessage: String?
    @State private var showCamera = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Model selector
                    modelSelector

                    // Image source buttons
                    imageButtons

                    // Preview + detections
                    if let image = selectedImage {
                        imagePreview(image)
                    } else {
                        emptyState
                    }

                    // Results
                    if !detections.isEmpty {
                        resultsSection
                    }

                    // Error
                    if let error = errorMessage {
                        errorBanner(error)
                    }
                }
                .padding()
            }
            .background(NexusTheme.background)
            .navigationTitle("Vision")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await fetchVisionModels()
            }
        }
    }

    // MARK: - Model Selector

    private var modelSelector: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("VISION MODEL")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundColor(NexusTheme.textTertiary)
                .tracking(1)

            if visionModels.isEmpty {
                Text("No vision models available")
                    .font(.caption)
                    .foregroundColor(NexusTheme.textSecondary)
                    .padding(.vertical, 8)
            } else {
                Picker("Model", selection: $selectedModelIndex) {
                    ForEach(Array(visionModels.enumerated()), id: \.offset) { idx, model in
                        Text("\(model.name) (\(model.format))")
                            .tag(idx)
                    }
                }
                .pickerStyle(.menu)
                .tint(NexusTheme.primary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(NexusTheme.NexusCardModifier())
    }

    // MARK: - Image Buttons

    private var imageButtons: some View {
        HStack(spacing: 12) {
            PhotosPicker(
                selection: $selectedItem,
                matching: .images,
                photoLibrary: .shared()
            ) {
                Label("Gallery", systemImage: "photo.on.rectangle")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(NexusTheme.primary.opacity(0.15))
                    .foregroundColor(NexusTheme.primary)
                    .cornerRadius(10)
            }
            .onChange(of: selectedItem) { _, newItem in
                Task {
                    if let data = try? await newItem?.loadTransferable(type: Data.self),
                       let img = UIImage(data: data) {
                        selectedImage = img
                        detections = []
                        errorMessage = nil
                    }
                }
            }

            Button {
                showCamera = true
            } label: {
                Label("Camera", systemImage: "camera")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(NexusTheme.accent.opacity(0.15))
                    .foregroundColor(NexusTheme.accent)
                    .cornerRadius(10)
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraView { image in
                    selectedImage = image
                    detections = []
                    errorMessage = nil
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "viewfinder")
                .font(.system(size: 48))
                .foregroundColor(NexusTheme.textTertiary.opacity(0.4))
            Text("Select an image to detect objects")
                .font(.subheadline)
                .foregroundColor(NexusTheme.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 200)
        .modifier(NexusTheme.NexusCardModifier())
    }

    // MARK: - Image Preview

    private func imagePreview(_ image: UIImage) -> some View {
        VStack(spacing: 12) {
            ZStack {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .cornerRadius(8)
                    .overlay(
                        GeometryReader { geo in
                            detectionOverlay(imageSize: image.size, viewSize: geo.size)
                        }
                    )
            }

            // Detect button
            Button {
                Task { await runDetection() }
            } label: {
                HStack(spacing: 8) {
                    if isDetecting {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.8)
                        Text("Detecting...")
                    } else {
                        Image(systemName: "sparkle.magnifyingglass")
                        Text("Detect Objects")
                    }
                }
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(isDetecting || visionModels.isEmpty
                    ? NexusTheme.textTertiary.opacity(0.3)
                    : NexusTheme.primary)
                .foregroundColor(.white)
                .cornerRadius(10)
            }
            .disabled(isDetecting || visionModels.isEmpty)
        }
        .modifier(NexusTheme.NexusCardModifier())
    }

    // MARK: - Detection Overlay

    private func detectionOverlay(imageSize: CGSize, viewSize: CGSize) -> some View {
        let scaleX = viewSize.width / imageSize.width
        let scaleY = viewSize.height / imageSize.height
        let colors: [Color] = [.purple, .blue, .green, .yellow, .red, .pink, .cyan, .orange]

        return ZStack {
            ForEach(Array(detections.enumerated()), id: \.element.id) { idx, det in
                let x1 = det.box[0] * scaleX
                let y1 = det.box[1] * scaleY
                let w = (det.box[2] - det.box[0]) * scaleX
                let h = (det.box[3] - det.box[1]) * scaleY
                let color = colors[idx % colors.count]

                Rectangle()
                    .stroke(color, lineWidth: 2)
                    .frame(width: w, height: h)
                    .position(x: x1 + w / 2, y: y1 + h / 2)

                Text("\(det.label) \(Int(det.confidence * 100))%")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(color)
                    .cornerRadius(3)
                    .position(x: x1 + w / 2, y: max(y1 - 10, 8))
            }
        }
    }

    // MARK: - Results

    private var resultsSection: some View {
        HStack(spacing: 20) {
            VStack {
                Text("\(detections.count)")
                    .font(.title2.bold())
                    .foregroundColor(NexusTheme.primary)
                Text("Detections")
                    .font(.caption2)
                    .foregroundColor(NexusTheme.textTertiary)
            }
            Divider().frame(height: 30)
            VStack {
                Text("\(inferenceTimeMs)ms")
                    .font(.title2.bold())
                    .foregroundColor(NexusTheme.accent)
                Text("Inference")
                    .font(.caption2)
                    .foregroundColor(NexusTheme.textTertiary)
            }
            Divider().frame(height: 30)
            VStack {
                let uniqueClasses = Set(detections.map(\.label))
                Text("\(uniqueClasses.count)")
                    .font(.title2.bold())
                    .foregroundColor(.orange)
                Text("Classes")
                    .font(.caption2)
                    .foregroundColor(NexusTheme.textTertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .modifier(NexusTheme.NexusCardModifier())
    }

    // MARK: - Error

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(NexusTheme.error)
            Text(message)
                .font(.caption)
                .foregroundColor(NexusTheme.error)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NexusTheme.error.opacity(0.1))
        .cornerRadius(8)
    }

    // MARK: - Network

    private func fetchVisionModels() async {
        guard appState.connectionState.isConnected,
              let serverUrl = URL(string: "\(appState.serverUrl)/api/mobile/vision/models") else { return }
        do {
            var request = URLRequest(url: serverUrl)
            if let token = await appState.apiClient.getAuthToken() {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
            let (data, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(VisionModelsResponse.self, from: data)
            visionModels = response.models
        } catch {
            // Silently fail — models may not be available
        }
    }

    private func runDetection() async {
        guard let image = selectedImage,
              !visionModels.isEmpty,
              selectedModelIndex < visionModels.count,
              appState.connectionState.isConnected else { return }

        isDetecting = true
        errorMessage = nil
        detections = []

        let model = visionModels[selectedModelIndex]

        do {
            guard let jpegData = image.jpegData(compressionQuality: 0.85) else {
                throw NSError(domain: "", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to encode image"])
            }

            let boundary = UUID().uuidString
            guard let inferUrl = URL(string: "\(appState.serverUrl)/api/mobile/vision/infer") else {
                errorMessage = "Invalid server URL"
                return
            }
            var request = URLRequest(url: inferUrl)
            request.httpMethod = "POST"
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            if let token = await appState.apiClient.getAuthToken() {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }

            var body = Data()
            let fields: [(String, String)] = [
                ("modelDirName", model.dirName),
                ("modelFile", model.fileName),
                ("task", "detect"),
                ("conf", "0.25"),
                ("iou", "0.45"),
            ]
            for (key, value) in fields {
                body.append("--\(boundary)\r\n".data(using: .utf8)!)
                body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
                body.append("\(value)\r\n".data(using: .utf8)!)
            }
            // Image file
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"image\"; filename=\"photo.jpg\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
            body.append(jpegData)
            body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
            request.httpBody = body

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw NSError(domain: "", code: -1, userInfo: [NSLocalizedDescriptionKey: "Server error"])
            }

            let result = try JSONDecoder().decode(VisionInferenceResponse.self, from: data)
            detections = result.detections
            inferenceTimeMs = result.inferenceTimeMs

        } catch {
            errorMessage = error.localizedDescription
        }

        isDetecting = false
    }
}

// MARK: - Models

struct VisionModelInfo: Codable, Identifiable {
    var id: String { "\(dirName)/\(fileName)" }
    let name: String
    let dirName: String
    let fileName: String
    let format: String
    let sizeMB: Int?

    enum CodingKeys: String, CodingKey {
        case name, dirName, fileName, format, sizeMB
    }
}

struct VisionModelsResponse: Codable {
    let models: [VisionModelInfo]
}

struct Detection: Codable, Identifiable {
    let id = UUID()
    let box: [CGFloat]
    let confidence: Double
    let label: String

    enum CodingKeys: String, CodingKey {
        case box, confidence
        case label = "class"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        box = try container.decode([CGFloat].self, forKey: .box)
        confidence = try container.decode(Double.self, forKey: .confidence)
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? "object"
    }
}

struct VisionInferenceResponse: Codable {
    let detections: [Detection]
    let inferenceTimeMs: Int
    let detectionCount: Int

    enum CodingKeys: String, CodingKey {
        case detections, inferenceTimeMs, detectionCount
    }
}

// MARK: - Camera View

struct CameraView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, dismiss: dismiss)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void
        let dismiss: DismissAction

        init(onCapture: @escaping (UIImage) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}
