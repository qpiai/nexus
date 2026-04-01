import Foundation
import SwiftUI

@Observable
@MainActor
final class ModelsViewModel {
    var mobileModels: [MobileModel] = []
    var serverModels: [ServerModel] = []
    var isLoading = false
    var errorMessage: String?

    func refresh(appState: AppState) async {
        isLoading = true
        errorMessage = nil

        do {
            switch appState.inferenceMode {
            case .onDevice:
                // Try authenticated mobile endpoint first, fallback to public
                do {
                    mobileModels = try await appState.apiClient.fetchMobileModels(
                        serverUrl: appState.serverUrl
                    )
                    appState.addLog("Loaded \(mobileModels.count) mobile models")
                } catch {
                    appState.addLog("Mobile models endpoint failed, trying public endpoint...")
                    let allModels = try await appState.apiClient.fetchServerModels(
                        serverUrl: appState.serverUrl
                    )
                    // Convert server models to mobile models (GGUF only)
                    mobileModels = allModels
                        .filter { $0.method == "GGUF" }
                        .map { model in
                            MobileModel(
                                id: model.file.lowercased().replacingOccurrences(
                                    of: "[^a-z0-9]+", with: "-",
                                    options: .regularExpression
                                ),
                                name: model.name,
                                file: model.file,
                                sizeBytes: Int64(model.sizeMB) * 1024 * 1024,
                                sizeMB: model.sizeMB,
                                quantization: extractQuant(from: model.file),
                                method: model.method,
                                downloadUrl: "/api/quantization/download?file=\(model.file)",
                                recommendedRamGB: max(1, Int(Double(model.sizeMB) * 1.2 / 1024)),
                                mobileCompatible: model.sizeMB < 4096
                            )
                        }
                    appState.addLog("Loaded \(mobileModels.count) mobile-compatible models via public endpoint")
                }
            case .server:
                serverModels = try await appState.apiClient.fetchServerModels(
                    serverUrl: appState.serverUrl
                )
                appState.addLog("Loaded \(serverModels.count) server models")
            }
        } catch {
            errorMessage = error.localizedDescription
            appState.addLog("Model fetch failed: \(error.localizedDescription)")
        }

        isLoading = false
    }

    private func extractQuant(from filename: String) -> String {
        let lower = filename.lowercased()
        let patterns = ["q2_k","q3_k_s","q3_k_m","q3_k_l","q4_0","q4_1","q4_k_s","q4_k_m",
                       "q5_0","q5_1","q5_k_s","q5_k_m","q6_k","q8_0","f16","f32"]
        return patterns.first(where: { lower.contains($0) })?.uppercased() ?? "GGUF"
    }

    func downloadModel(_ model: MobileModel, appState: AppState) {
        Task {
            do {
                appState.addLog("Downloading \(model.name)...")
                try await appState.downloadManager.download(
                    model: model,
                    serverUrl: appState.serverUrl
                )
                appState.addLog("Download complete: \(model.name)")
            } catch {
                appState.addLog("Download failed: \(error.localizedDescription)")
            }
        }
    }

    func deleteModel(_ model: MobileModel, appState: AppState) {
        appState.downloadManager.deleteModel(filename: model.file)
        appState.addLog("Deleted \(model.name)")
    }

    func selectMobileModel(_ model: MobileModel, appState: AppState) {
        appState.selectedModelFile = model.file
        appState.selectedModelName = model.name
        appState.selectedModelMethod = model.method

        if appState.inferenceMode == .onDevice {
            // Load into LlamaEngine
            if let path = appState.downloadManager.modelPath(for: model.file) {
                Task {
                    do {
                        try appState.llamaEngine.loadModel(path: path, name: model.name)
                        appState.addLog("Model loaded: \(model.name)")
                    } catch {
                        appState.addLog("Load failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    func selectServerModel(_ model: ServerModel, appState: AppState) {
        appState.selectedModelFile = model.file
        appState.selectedModelName = model.name
        appState.selectedModelMethod = model.method
        appState.addLog("Selected server model: \(model.name)")
    }
}
