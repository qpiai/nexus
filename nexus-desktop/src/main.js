const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

let mainWindow = null;
let tray = null;
let serverUrl = '';
let deviceId = null;
let authToken = null;
let metricsInterval = null;
let totalInferences = 0;
let totalTokens = 0;

// ── node-llama-cpp direct inference state ──
let llamaEngine = null;   // { llama, model, context, session }
let activeModelFile = null;
let chatAbortController = null;

// Paths
const modelsDir = path.join(app.getPath('userData'), 'models');
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { serverUrl: '', deviceId: null };
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getHardwareInfo() {
  const cpus = os.cpus();
  return {
    name: `${os.hostname()} (${os.platform()})`,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
    cpuCores: cpus.length,
    ramGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    storageGB: 0, // Will be updated per-drive
  };
}

function setAuthToken(token) {
  authToken = token;
  const config = loadConfig();
  config.authToken = token;
  saveConfig(config);
}

const isMac = process.platform === 'darwin';

function createWindow() {
  const windowOptions = {
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'QpiAI Nexus',
    backgroundColor: '#0a0a12',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: !isMac,
  };

  // macOS: hidden title bar with inset traffic lights
  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 12, y: 12 };
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (e) => {
    if (isMac) {
      // macOS: hide on close instead of quitting (dock behavior)
      e.preventDefault();
      mainWindow.hide();
    } else if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createMacMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  // Use a simple label since we may not have an icon file
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Nexus', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Unload Model', click: () => disposeLlamaEngine() },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray = null; app.quit(); } },
  ]);
  tray.setToolTip('QpiAI Nexus');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

// IPC Handlers
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-hardware', () => getHardwareInfo());
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, config) => { saveConfig(config); return true; });
ipcMain.handle('get-models-dir', () => modelsDir);
ipcMain.handle('get-auth-token', () => authToken);

ipcMain.handle('set-auth-token', (_, token) => {
  authToken = token;
  return true;
});

ipcMain.handle('register-device', async (_, url, pairingToken) => {
  serverUrl = url.replace(/\/$/, '');

  const config = loadConfig();
  // Use pairing token if provided, or saved device token
  if (pairingToken) {
    authToken = pairingToken;
  } else if (config.authToken) {
    authToken = config.authToken;
  }

  const hw = getHardwareInfo();
  const payload = {
    name: hw.name,
    platform: hw.platform,
    hardware: {
      cpuModel: hw.cpuModel,
      cpuCores: hw.cpuCores,
      ramGB: hw.ramGB,
      storageGB: hw.storageGB,
    },
  };
  if (config.deviceId) payload.deviceId = config.deviceId;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${serverUrl}/api/mobile/register`);
    const client = urlObj.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const req = client.request(urlObj, {
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Registration failed: ${res.statusCode}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          deviceId = result.id;
          // Store device token from registration response
          if (result.token) {
            authToken = result.token;
            saveConfig({ serverUrl, deviceId, authToken: result.token });
          } else {
            saveConfig({ serverUrl, deviceId });
          }
          startMetricsReporting();
          startSSEListener();
          resolve(result);
        } catch (e) {
          reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
});

ipcMain.handle('fetch-models', async () => {
  if (!serverUrl) throw new Error('Not connected');

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${serverUrl}/api/chat/models`);
    const client = urlObj.protocol === 'https:' ? https : http;
    const options = { headers: {} };
    if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
    client.get(urlObj, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          reject(new Error('Unauthorized — please reconnect via QR code'));
        } else {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        }
      });
    }).on('error', reject);
  });
});

ipcMain.handle('download-model', async (event, filename) => {
  if (!serverUrl) throw new Error('Not connected');
  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

  const filePath = path.join(modelsDir, filename);
  const tempPath = filePath + '.tmp';

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${serverUrl}/api/deploy/download?file=${encodeURIComponent(filename)}`);
    const client = urlObj.protocol === 'https:' ? https : http;

    const reqOptions = { headers: {} };
    if (authToken) reqOptions.headers['Authorization'] = `Bearer ${authToken}`;
    client.get(urlObj, reqOptions, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = fs.createWriteStream(tempPath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        mainWindow?.webContents.send('download-progress', {
          filename,
          downloaded,
          total: totalBytes,
          percent: totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0,
        });
      });

      res.on('end', () => {
        file.end(() => {
          try {
            fs.renameSync(tempPath, filePath);
            resolve({ path: filePath, size: downloaded });
          } catch (err) {
            reject(new Error(`Failed to save model: ${err.message}`));
          }
        });
      });

      res.on('error', (e) => {
        file.destroy();
        try { fs.unlinkSync(tempPath); } catch (_) {}
        reject(e);
      });
    }).on('error', reject);
  });
});

ipcMain.handle('list-downloaded', () => {
  if (!fs.existsSync(modelsDir)) return [];
  return fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.gguf'))
    .map(f => {
      const stats = fs.statSync(path.join(modelsDir, f));
      return { name: f, sizeMB: Math.round(stats.size / (1024 * 1024)) };
    });
});

ipcMain.handle('delete-model', (_, filename) => {
  const filePath = path.join(modelsDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('get-system-metrics', () => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = Math.round((1 - freeMem / totalMem) * 100);

  // CPU usage calculation
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = Math.round(100 - (totalIdle / totalTick * 100));

  return {
    cpuUsage,
    memoryUsage: memUsage,
    totalRamGB: Math.round(totalMem / (1024 * 1024 * 1024)),
    freeRamGB: (freeMem / (1024 * 1024 * 1024)).toFixed(1),
    uptime: os.uptime(),
  };
});

// ── Load model into memory using node-llama-cpp (direct binding, no server) ──
ipcMain.handle('start-llama-server', async (_, modelFile) => {
  await disposeLlamaEngine();

  const modelPath = path.join(modelsDir, modelFile);
  if (!fs.existsSync(modelPath)) throw new Error('Model not found');

  mainWindow?.webContents.send('llama-log', 'Loading model with native llama.cpp bindings...\n');

  try {
    // Dynamic import (node-llama-cpp is ESM-only)
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    mainWindow?.webContents.send('llama-log', 'Initializing llama engine...\n');
    const llama = await getLlama();

    mainWindow?.webContents.send('llama-log', `Loading model: ${modelFile}\n`);
    const model = await llama.loadModel({ modelPath });

    mainWindow?.webContents.send('llama-log', 'Creating context (2048 tokens)...\n');
    const context = await model.createContext({ contextSize: 2048 });

    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    llamaEngine = { llama, model, context, session, LlamaChatSession };
    activeModelFile = modelFile;

    mainWindow?.webContents.send('llama-log', 'Model loaded. Ready to chat!\n');
    return { ready: true, model: modelFile };
  } catch (err) {
    mainWindow?.webContents.send('llama-log', `Load error: ${err.message}\n`);
    await disposeLlamaEngine();
    throw err;
  }
});

ipcMain.handle('stop-llama-server', async () => {
  await disposeLlamaEngine();
  return true;
});

// ── Stream chat via direct inference (IPC-based, no HTTP server) ──
ipcMain.handle('llama-chat', async (event, messages) => {
  if (!llamaEngine) throw new Error('Model not loaded');

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message');

  // Create abort controller for this generation
  chatAbortController = new AbortController();
  const signal = chatAbortController.signal;

  try {
    await llamaEngine.session.prompt(lastUserMsg.content, {
      signal,
      onTextChunk(chunk) {
        if (!signal.aborted) {
          mainWindow?.webContents.send('llama-token', chunk);
        }
      },
    });
    mainWindow?.webContents.send('llama-token', '__DONE__');
  } catch (err) {
    if (err.name === 'AbortError' || signal.aborted) {
      mainWindow?.webContents.send('llama-token', '__DONE__');
    } else {
      mainWindow?.webContents.send('llama-token', `__ERROR__${err.message}`);
    }
  } finally {
    chatAbortController = null;
  }
  return true;
});

// ── Abort ongoing generation ──
ipcMain.handle('llama-abort', () => {
  if (chatAbortController) {
    chatAbortController.abort();
    chatAbortController = null;
  }
  return true;
});

ipcMain.handle('report-inference', (_, data) => {
  totalInferences++;
  totalTokens += (data.tokenCount || 0);
  sendToServer('/api/mobile/ws', {
    type: 'inference_metrics',
    deviceId,
    data: {
      timestamp: Date.now(),
      tokensPerSec: data.tokensPerSec || 0,
      tokenCount: data.tokenCount || 0,
      elapsed: data.elapsed || 0,
      memoryUsage: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      cpuUsage: 0,
      activeModel: data.model || '',
      engineType: 'desktop-electron',
      inferenceMode: data.mode || 'local',
    },
  });
  return true;
});

ipcMain.handle('llama-health', async () => {
  return { ok: !!llamaEngine, model: activeModelFile };
});

async function disposeLlamaEngine() {
  chatAbortController?.abort();
  chatAbortController = null;
  if (llamaEngine) {
    try { await llamaEngine.context.dispose(); } catch (_) {}
    try { llamaEngine.model.dispose(); } catch (_) {}
    try { await llamaEngine.llama.dispose(); } catch (_) {}
    llamaEngine = null;
    activeModelFile = null;
  }
}

function sendToServer(endpoint, data) {
  if (!serverUrl || !deviceId) return;
  const body = JSON.stringify(data);
  try {
    const urlObj = new URL(`${serverUrl}${endpoint}`);
    const client = urlObj.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const req = client.request(urlObj, {
      method: 'POST',
      headers,
    }, (res) => { res.resume(); }); // consume response to free memory
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (_) {}
}

// ── SSE Push Listener — receives deploy events from server ──
let sseReq = null;

function startSSEListener() {
  if (!serverUrl || !deviceId) return;
  if (sseReq) { try { sseReq.destroy(); } catch (_) {} sseReq = null; }

  const urlObj = new URL(`${serverUrl}/api/mobile/ws?deviceId=${deviceId}`);
  const client = urlObj.protocol === 'https:' ? https : http;
  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  sseReq = client.get(urlObj, { headers }, (res) => {
    if (res.statusCode !== 200) {
      setTimeout(startSSEListener, 10000);
      return;
    }

    let buffer = '';
    let currentEvent = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'deploy' && mainWindow) {
              mainWindow.webContents.send('deploy-event', data);
            }
          } catch (_) {}
          currentEvent = '';
        }
      }
    });

    res.on('end', () => {
      sseReq = null;
      setTimeout(startSSEListener, 5000);
    });

    res.on('error', () => {
      sseReq = null;
      setTimeout(startSSEListener, 10000);
    });
  });

  sseReq.on('error', () => {
    sseReq = null;
    setTimeout(startSSEListener, 10000);
  });
}

function stopSSEListener() {
  if (sseReq) { try { sseReq.destroy(); } catch (_) {} sseReq = null; }
}

function startMetricsReporting() {
  if (metricsInterval) clearInterval(metricsInterval);
  metricsInterval = setInterval(() => {
    if (!serverUrl || !deviceId) return;
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) totalTick += cpu.times[type];
      totalIdle += cpu.times.idle;
    });
    const cpuUsage = Math.round(100 - (totalIdle / totalTick * 100));
    const memoryUsage = Math.round((1 - freeMem / totalMem) * 100);

    sendToServer('/api/mobile/ws', {
      type: 'metrics_update',
      deviceId,
      data: {
        cpuUsage,
        memoryUsage,
        temperature: 0,
        batteryLevel: 100,
        activeModel: activeModelFile || '',
        totalInferences,
        totalTokens,
        engineType: 'desktop-electron',
      },
    });
  }, 15000);
}

function stopMetricsReporting() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}

app.whenReady().then(() => {
  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

  const config = loadConfig();
  serverUrl = config.serverUrl || '';
  deviceId = config.deviceId || null;
  authToken = config.authToken || null;

  // macOS: set up application menu (enables Cmd+Q, Cmd+C/V, etc.)
  if (isMac) {
    createMacMenu();
  }

  createWindow();

  // Start metrics and SSE if already registered
  if (serverUrl && deviceId) {
    startMetricsReporting();
    startSSEListener();
  }

  // Create tray on non-macOS only (macOS uses the dock instead)
  if (!isMac) {
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    if (fs.existsSync(iconPath)) {
      try { createTray(); } catch (_) {}
    }
  }

  app.on('activate', () => {
    // macOS: re-show hidden window on dock click
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    disposeLlamaEngine();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopMetricsReporting();
  stopSSEListener();
  disposeLlamaEngine();
  tray = null;
});
