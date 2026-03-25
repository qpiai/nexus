import Foundation
import SwiftUI

@Observable
@MainActor
final class AppState {
    // Connection
    var serverUrl: String {
        didSet { UserDefaults.standard.set(serverUrl, forKey: "serverUrl") }
    }
    var connectionState: ConnectionState = .disconnected
    var deviceId: String? {
        didSet { UserDefaults.standard.set(deviceId, forKey: "deviceId") }
    }

    // Inference
    var inferenceMode: InferenceMode {
        didSet { UserDefaults.standard.set(inferenceMode.rawValue, forKey: "inferenceMode") }
    }
    var selectedModelFile: String?
    var selectedModelName: String?
    var selectedModelMethod: String?

    // Log
    var connectionLog: [String] = []

    // Services
    let apiClient = NexusAPIClient()
    let downloadManager = ModelDownloadManager()
    let llamaEngine = LlamaEngine()
    let metricsReporter = MetricsReporter()

    // SSE
    private var sseTask: Task<Void, Never>?

    init() {
        self.serverUrl = UserDefaults.standard.string(forKey: "serverUrl") ?? ""
        self.deviceId = UserDefaults.standard.string(forKey: "deviceId")
        let modeRaw = UserDefaults.standard.string(forKey: "inferenceMode") ?? "on_device"
        self.inferenceMode = InferenceMode(rawValue: modeRaw) ?? .onDevice
    }

    // MARK: - Connection

    /// Set a pairing token received from QR scan
    var pendingPairingToken: String?

    func connect() async {
        guard !serverUrl.isEmpty else {
            connectionState = .error("Enter a server URL")
            return
        }

        // Normalize URL
        var url = serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
            url = "https://\(url)"
        }
        if url.hasSuffix("/") { url.removeLast() }
        serverUrl = url

        connectionState = .connecting
        addLog("Connecting to \(url)...")

        do {
            // Use pairing token from QR scan, or saved device token for reconnection
            if let pairingToken = pendingPairingToken {
                addLog("Using QR pairing token...")
                await apiClient.setAuthToken(pairingToken)
                pendingPairingToken = nil
            } else if let savedToken = UserDefaults.standard.string(forKey: "deviceToken") {
                addLog("Using saved device token...")
                await apiClient.setAuthToken(savedToken)
            }

            metricsReporter.configure(apiClient: apiClient)

            let response = try await apiClient.register(serverUrl: url, savedDeviceId: deviceId)
            deviceId = response.id

            // Store device token from registration
            if let token = response.token {
                UserDefaults.standard.set(token, forKey: "deviceToken")
                await apiClient.setAuthToken(token)
                addLog("Device token stored")
            }

            connectionState = .connected
            addLog("Registered — device ID: \(response.id)")
            addLog("Status: \(response.message)")

            // Start SSE listener with auth token
            startSSEListener()

            // Start metrics reporting
            metricsReporter.startReporting(serverUrl: url, deviceId: response.id)
        } catch {
            connectionState = .error(error.localizedDescription)
            addLog("Connection failed: \(error.localizedDescription)")
        }
    }

    func disconnect() {
        sseTask?.cancel()
        sseTask = nil
        metricsReporter.stopReporting()
        connectionState = .disconnected
        addLog("Disconnected")
    }

    /// Get the current auth token for passing to nonisolated streaming methods.
    func currentAuthToken() async -> String? {
        return await apiClient.getAuthToken()
    }

    // MARK: - SSE

    private func startSSEListener() {
        sseTask?.cancel()
        guard let deviceId else { return }

        sseTask = Task { [weak self] in
            guard let self else { return }

            let token = await self.apiClient.getAuthToken()

            do {
                for try await event in apiClient.listenForEvents(
                    serverUrl: serverUrl,
                    deviceId: deviceId,
                    authToken: token
                ) {
                    await MainActor.run {
                        self.handleSSEEvent(event)
                    }
                }
            } catch {
                if !Task.isCancelled {
                    await MainActor.run {
                        self.addLog("SSE error: \(error.localizedDescription)")
                        // Auto-reconnect on SSE drop
                        self.addLog("Attempting auto-reconnect...")
                    }
                    // Wait a bit, then re-login and reconnect
                    try? await Task.sleep(for: .seconds(5))
                    if !Task.isCancelled {
                        await self.connect()
                    }
                }
            }
        }
    }

    private func handleSSEEvent(_ event: SSEEvent) {
        switch event.event {
        case "deploy":
            if let data = event.data.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let modelFile = json["model"] as? String {
                addLog("Server push: \(modelFile)")
                // Auto-download GGUF models
                if modelFile.hasSuffix(".gguf") {
                    addLog("Auto-downloading \(modelFile)...")
                    Task {
                        do {
                            try await downloadManager.downloadModel(
                                serverUrl: serverUrl,
                                filename: modelFile,
                                authToken: await apiClient.getAuthToken()
                            )
                            await MainActor.run {
                                self.addLog("Download complete: \(modelFile)")
                            }
                        } catch {
                            await MainActor.run {
                                self.addLog("Download failed: \(error.localizedDescription)")
                            }
                        }
                    }
                }
            }
        default:
            addLog("Event: \(event.event)")
        }
    }

    // MARK: - Logging

    func addLog(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let timestamp = formatter.string(from: Date())
        connectionLog.append("[\(timestamp)] \(message)")
        // Keep last 100 entries
        if connectionLog.count > 100 {
            connectionLog.removeFirst(connectionLog.count - 100)
        }
    }

    // MARK: - Storage Info

    var freeStorageGB: Double {
        if let attrs = try? FileManager.default.attributesOfFileSystem(
            forPath: NSHomeDirectory()
        ), let freeSize = attrs[.systemFreeSize] as? Int64 {
            return Double(freeSize) / (1024 * 1024 * 1024)
        }
        return 0
    }

    var totalRAMGB: Double {
        Double(ProcessInfo.processInfo.physicalMemory) / (1024 * 1024 * 1024)
    }
}
