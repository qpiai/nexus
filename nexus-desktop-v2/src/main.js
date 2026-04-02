const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
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

// ── llama-server subprocess state ──
let llamaProcess = null;   // child_process.ChildProcess
let llamaPort = null;      // HTTP port for llama-server
let activeModelFile = null;
let chatAbortController = null;

// Active download tracking (survives renderer navigation)
const activeDownloads = new Map(); // filename -> { downloaded, total, percent }

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
    { label: 'Unload Model', click: () => killLlamaServer() },
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
ipcMain.handle('get-active-downloads', () => Object.fromEntries(activeDownloads));
ipcMain.handle('open-models-dir', () => shell.openPath(modelsDir));
ipcMain.handle('get-auth-token', () => authToken);

ipcMain.handle('set-auth-token', (_, token) => {
  authToken = token;
  return true;
});

ipcMain.handle('login-to-server', async (_, url, email, password) => {
  const cleanUrl = url.replace(/\/$/, '');
  const body = JSON.stringify({ email, password });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${cleanUrl}/api/auth/login`);
    const client = urlObj.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    const req = client.request(urlObj, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          let errMsg = 'Invalid email or password';
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) errMsg = parsed.error;
          } catch (_) {}
          reject(new Error(errMsg));
          return;
        }
        if (res.statusCode !== 200) {
          let errMsg = `Login failed (${res.statusCode})`;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) errMsg = parsed.error;
          } catch (_) {}
          reject(new Error(errMsg));
          return;
        }
        try {
          const result = JSON.parse(data);
          if (result.token) setAuthToken(result.token);
          resolve(result);
        } catch (e) {
          reject(new Error('Invalid server response'));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`Cannot reach server: ${e.message}`)));
    req.write(body);
    req.end();
  });
});

ipcMain.handle('register-device', async (_, url, tokenOverride) => {
  serverUrl = url.replace(/\/$/, '');

  const config = loadConfig();
  // Use provided token if given, or saved device token
  if (tokenOverride) {
    authToken = tokenOverride;
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
        if (res.statusCode === 401) {
          // Clear expired token
          authToken = null;
          const cfg = loadConfig();
          delete cfg.authToken;
          saveConfig(cfg);
          reject(new Error('Session expired — please log in again'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Registration failed: ${res.statusCode} ${data.slice(0, 200)}`));
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

ipcMain.handle('disconnect-server', async () => {
  stopMetricsReporting();
  stopSSEListener();
  authToken = null;
  deviceId = null;
  serverUrl = '';
  const config = loadConfig();
  delete config.authToken;
  delete config.deviceId;
  config.serverUrl = '';
  saveConfig(config);
  return true;
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
          reject(new Error('Session expired — please reconnect'));
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
    // Use the public download endpoint (no auth required, works for all users)
    const urlObj = new URL(`${serverUrl}/api/quantization/download?file=${encodeURIComponent(filename)}`);
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

      activeDownloads.set(filename, { downloaded: 0, total: totalBytes, percent: 0 });

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        const percent = totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0;
        activeDownloads.set(filename, { downloaded, total: totalBytes, percent });
        mainWindow?.webContents.send('download-progress', {
          filename,
          downloaded,
          total: totalBytes,
          percent,
        });
      });

      res.on('end', () => {
        file.end(() => {
          activeDownloads.delete(filename);
          try {
            fs.renameSync(tempPath, filePath);
            mainWindow?.webContents.send('download-complete', { filename });
            resolve({ path: filePath, size: downloaded });
          } catch (err) {
            reject(new Error(`Failed to save model: ${err.message}`));
          }
        });
      });

      res.on('error', (e) => {
        activeDownloads.delete(filename);
        file.destroy();
        try { fs.unlinkSync(tempPath); } catch (_) {}
        reject(e);
      });
    }).on('error', (e) => {
      activeDownloads.delete(filename);
      reject(e);
    });
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

// ── llama-server subprocess utilities ──

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function getLlamaServerPath() {
  const platform = process.platform;   // 'win32', 'linux', 'darwin'
  const arch = process.arch;           // 'x64', 'arm64'
  const exe = platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  // In packaged app: process.resourcesPath/bin/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', exe);
  }

  // In dev: bin/{platform}-{arch}/
  let dirName;
  if (platform === 'win32') dirName = 'win-x64';
  else if (platform === 'darwin') dirName = `darwin-${arch}`;
  else dirName = 'linux-x64';

  return path.join(__dirname, '..', 'bin', dirName, exe);
}

function getLlamaServerEnv() {
  const binDir = path.dirname(getLlamaServerPath());
  const env = { ...process.env };
  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = binDir + (env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : '');
  } else if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = binDir + (env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : '');
  }
  return env;
}

function waitForHealth(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`llama-server did not become ready within ${timeoutMs / 1000}s`));
      }
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(body);
              if (json.status === 'ok' || json.status === 'no slot available') {
                return resolve(true);
              }
            } catch (_) {}
            // Status might be "loading model" — keep polling
          }
          setTimeout(check, 250);
        });
      });
      req.on('error', () => setTimeout(check, 250));
    };
    check();
  });
}

async function killLlamaServer() {
  chatAbortController?.abort();
  chatAbortController = null;

  if (llamaProcess) {
    const proc = llamaProcess;
    llamaProcess = null;
    llamaPort = null;
    activeModelFile = null;

    try {
      proc.kill('SIGTERM');
    } catch (_) {}

    // Wait up to 3s for graceful exit, then SIGKILL
    await new Promise((resolve) => {
      let done = false;
      proc.on('exit', () => { done = true; resolve(); });
      setTimeout(() => {
        if (!done) {
          try { proc.kill('SIGKILL'); } catch (_) {}
        }
        resolve();
      }, 3000);
    });
  }
}

// ── Load model via llama-server subprocess ──
ipcMain.handle('start-llama-server', async (_, modelFile) => {
  await killLlamaServer();

  const sanitized = path.basename(modelFile);
  const modelPath = path.join(modelsDir, sanitized);
  if (!fs.existsSync(modelPath)) throw new Error(`Model not found: ${sanitized}`);

  const serverBin = getLlamaServerPath();
  if (!fs.existsSync(serverBin)) {
    throw new Error('llama-server binary not found. Reinstall the app or place the binary in the bin/ directory.');
  }

  const stats = fs.statSync(modelPath);
  const sizeMB = Math.round(stats.size / (1024 * 1024));
  const availRamMB = Math.round(os.freemem() / (1024 * 1024));
  mainWindow?.webContents.send('llama-log', `Model size: ${sizeMB} MB, Available RAM: ${availRamMB} MB\n`);

  if (sizeMB > availRamMB * 0.9) {
    mainWindow?.webContents.send('llama-log', `Warning: Model (${sizeMB} MB) may exceed available RAM (${availRamMB} MB)\n`);
  }

  const port = await findFreePort();
  mainWindow?.webContents.send('llama-log', `Starting llama-server on port ${port}...\n`);

  const args = [
    '--model', modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', '2048',
    '--n-gpu-layers', '99',
  ];

  try {
    const proc = spawn(serverBin, args, {
      env: getLlamaServerEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Stream stderr/stdout to renderer as logs
    proc.stdout.on('data', (data) => {
      mainWindow?.webContents.send('llama-log', data.toString());
    });
    proc.stderr.on('data', (data) => {
      mainWindow?.webContents.send('llama-log', data.toString());
    });

    // Handle unexpected exit
    proc.on('exit', (code) => {
      if (llamaProcess === proc) {
        llamaProcess = null;
        llamaPort = null;
        activeModelFile = null;
        mainWindow?.webContents.send('llama-log', `llama-server exited (code ${code})\n`);
        mainWindow?.webContents.send('llama-stopped', `Process exited with code ${code}`);
      }
    });

    llamaProcess = proc;
    llamaPort = port;
    activeModelFile = sanitized;

    mainWindow?.webContents.send('llama-log', 'Waiting for model to load...\n');
    await waitForHealth(port, 60000);

    mainWindow?.webContents.send('llama-log', 'Model loaded. Ready to chat!\n');
    return { ready: true, model: sanitized };
  } catch (err) {
    let msg = err.message || String(err);
    if (msg.includes('ENOENT')) {
      msg = 'llama-server binary not found. Reinstall the app.';
    } else if (msg.includes('EACCES')) {
      msg = 'Permission denied running llama-server. Check file permissions.';
    } else if (msg.includes('did not become ready')) {
      msg = `Model failed to load within 60s. It may be too large for available RAM (${availRamMB} MB free).`;
    }
    mainWindow?.webContents.send('llama-log', `Load failed: ${msg}\n`);
    await killLlamaServer();
    throw new Error(msg);
  }
});

ipcMain.handle('stop-llama-server', async () => {
  await killLlamaServer();
  return true;
});

// ── Stream chat via llama-server HTTP API ──
ipcMain.handle('llama-chat', async (event, messages) => {
  if (!llamaProcess || !llamaPort) throw new Error('Model not loaded');

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message');

  // Build messages array for OpenAI-compatible API
  const apiMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  chatAbortController = new AbortController();
  const signal = chatAbortController.signal;

  const reqBody = JSON.stringify({
    messages: apiMessages,
    stream: true,
    max_tokens: 1024,
    temperature: 0.7,
  });

  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${llamaPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqBody),
        },
      }, resolve);

      req.on('error', reject);
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('AbortError'));
      });
      req.write(reqBody);
      req.end();
    });

    if (response.statusCode !== 200) {
      let body = '';
      for await (const chunk of response) body += chunk;
      throw new Error(`llama-server error ${response.statusCode}: ${body.slice(0, 200)}`);
    }

    // Parse SSE stream
    let buffer = '';
    for await (const chunk of response) {
      if (signal.aborted) break;
      buffer += chunk.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          mainWindow?.webContents.send('llama-token', '__DONE__');
          return true;
        }
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            mainWindow?.webContents.send('llama-token', content);
          }
        } catch (_) {}
      }
    }

    mainWindow?.webContents.send('llama-token', '__DONE__');
  } catch (err) {
    if (err.message === 'AbortError' || signal.aborted) {
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
  if (!llamaProcess || !llamaPort) return { ok: false, model: null };
  try {
    const body = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${llamaPort}/health`, (res) => {
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    const json = JSON.parse(body);
    return { ok: json.status === 'ok', model: activeModelFile };
  } catch (_) {
    return { ok: false, model: activeModelFile };
  }
});

ipcMain.handle('check-llama-available', async () => {
  const serverBin = getLlamaServerPath();
  if (fs.existsSync(serverBin)) {
    return { available: true };
  }
  return { available: false, error: 'llama-server binary not found' };
});

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

  // Clean up stale .tmp files from interrupted downloads
  try {
    fs.readdirSync(modelsDir).filter(f => f.endsWith('.tmp')).forEach(f => {
      try { fs.unlinkSync(path.join(modelsDir, f)); } catch (_) {}
    });
  } catch (_) {}

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
    killLlamaServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopMetricsReporting();
  stopSSEListener();
  killLlamaServer();
  tray = null;
});
