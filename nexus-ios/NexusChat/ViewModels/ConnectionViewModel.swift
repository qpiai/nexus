import Foundation

/// Manages server connection state: URL, login credentials, and registration.
@Observable
@MainActor
final class ConnectionViewModel {
    var serverURL: String = ""
    var isConnecting = false
    var errorMessage: String?
    var successMessage: String?

    let apiService: NexusAPIService

    init(apiService: NexusAPIService) {
        self.apiService = apiService
    }

    var isConnected: Bool {
        apiService.isConnected
    }

    var deviceId: String? {
        apiService.deviceId
    }

    func connect() async {
        guard !serverURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Enter a server URL"
            return
        }

        isConnecting = true
        errorMessage = nil
        successMessage = nil

        // Normalize URL
        var url = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.hasPrefix("http://") && !url.hasPrefix("https://") {
            url = "https://\(url)"
        }
        if url.hasSuffix("/") { url.removeLast() }

        apiService.serverURL = url

        // Try registration if we have a token (from QR or saved)
        do {
            try await apiService.registerDevice()
            successMessage = "Connected! Device ID: \(apiService.deviceId ?? "unknown")"
        } catch APIError.notAuthenticated {
            // No auth token — still connect for server-side chat (public endpoint)
            apiService.isConnected = true
            successMessage = "Connected (browse mode). Scan QR code for full access."
        } catch {
            // Registration failed but chat endpoint is public — still allow connection
            apiService.isConnected = true
            successMessage = "Connected (limited). Chat available via public endpoint."
        }

        isConnecting = false
    }

    func disconnect() {
        apiService.disconnect()
        successMessage = nil
        errorMessage = nil
    }
}
