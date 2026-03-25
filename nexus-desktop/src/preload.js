const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  // Platform
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Config
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Server connection
  registerDevice: (url, pairingToken) => ipcRenderer.invoke('register-device', url, pairingToken),
  fetchModels: () => ipcRenderer.invoke('fetch-models'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),

  // Model management
  getModelsDir: () => ipcRenderer.invoke('get-models-dir'),
  downloadModel: (filename) => ipcRenderer.invoke('download-model', filename),
  listDownloaded: () => ipcRenderer.invoke('list-downloaded'),
  deleteModel: (filename) => ipcRenderer.invoke('delete-model', filename),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_, data) => callback(data));
  },

  // Llama direct inference (node-llama-cpp)
  startLlamaServer: (modelFile) => ipcRenderer.invoke('start-llama-server', modelFile),
  stopLlamaServer: () => ipcRenderer.invoke('stop-llama-server'),
  llamaHealth: () => ipcRenderer.invoke('llama-health'),
  llamaChat: (messages) => ipcRenderer.invoke('llama-chat', messages),
  llamaAbort: () => ipcRenderer.invoke('llama-abort'),
  onLlamaToken: (callback) => {
    ipcRenderer.on('llama-token', (_, data) => callback(data));
  },
  onLlamaLog: (callback) => {
    ipcRenderer.on('llama-log', (_, data) => callback(data));
  },
  onLlamaStopped: (callback) => {
    ipcRenderer.on('llama-stopped', (_, data) => callback(data));
  },

  // System metrics
  getSystemMetrics: () => ipcRenderer.invoke('get-system-metrics'),

  // Inference reporting
  reportInference: (data) => ipcRenderer.invoke('report-inference', data),

  // Server push events (SSE)
  onDeployEvent: (callback) => {
    ipcRenderer.on('deploy-event', (_, data) => callback(data));
  },
});
