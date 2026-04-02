// ═══════════════════════════════════════════════════
// Nexus Desktop — Renderer
// ═══════════════════════════════════════════════════

// State
let connected = false;
let serverModels = [];
let downloadedModels = new Set();
let downloadedModelsList = [];
let chatMessages = [];
let currentAbort = null;
let generating = false;
let inferenceMode = 'local'; // 'local' or 'server'
let currentServerUrl = '';
let currentChatModel = '';
let currentChatMethod = 'GGUF';
let chatReady = false;
let chatImageBase64 = null;
let chatImageFileName = null;
let metricsTimer = null;

// Token listener registry (lives outside window.nexus which is a sealed contextBridge proxy)
let _tokenListeners = [];
function addTokenListener(fn) { _tokenListeners.push(fn); }
function removeTokenListener(fn) { _tokenListeners = _tokenListeners.filter(f => f !== fn); }

// Active download state — survives DOM rebuilds from page navigation
let activeDownloadState = {}; // filename -> { downloaded, total, percent }

const $ = (id) => document.getElementById(id);

// ── Page Navigation ──
function showPage(page) {
  document.querySelectorAll('.sidebar .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`page-${page}`)?.classList.add('active');
  $('chatView')?.classList.remove('active');
  $('sidebar')?.classList.remove('hidden');

  // Clean up webcam when leaving vision page
  if (page !== 'vision' && webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
    const video = $('visionWebcamVideo');
    if (video) video.classList.add('hidden');
    const captureBtn = $('visionCaptureBtn');
    if (captureBtn) captureBtn.classList.add('hidden');
    const webcamBtn = $('webcamBtn');
    if (webcamBtn) webcamBtn.textContent = '\u{1F4F9} Webcam';
  }

  if (page === 'chat-list') renderChatList();
  if (page === 'models') refreshDownloaded();
  if (page === 'vision') fetchVisionModels();
}

// ── Logging ──
function log(msg) {
  const time = new Date().toLocaleTimeString();
  const box = $('logBox');
  if (box) {
    box.textContent += `[${time}] ${msg}\n`;
    box.scrollTop = box.scrollHeight;
  }
}

function clearLogs() {
  const el = $('logBox');
  if (el) el.textContent = '';
}

// ── Connection Status ──
function setStatus(isConnected) {
  connected = isConnected;
  $('statusDot').classList.toggle('on', isConnected);
  $('statusLabel').textContent = isConnected ? 'Connected' : 'Disconnected';
  $('statusLabel').classList.toggle('on', isConnected);
}

// ── Mode Toggle ──
function setMode(mode) {
  inferenceMode = mode;
  $('modeLocal').classList.toggle('active', mode === 'local');
  $('modeServer').classList.toggle('active', mode === 'server');
}

// ── Connection UX helpers ──
function showMsg(text, type) {
  const el = $('connectMsg');
  if (!el) return;
  el.textContent = text;
  el.className = `connect-msg ${type}`;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function friendlyError(msg) {
  if (msg.includes('ECONNREFUSED') || msg.includes('Cannot reach'))
    return 'Cannot reach server. Check URL and make sure server is running.';
  if (msg.includes('ENOTFOUND'))
    return 'Server not found. Check the URL.';
  if (msg.includes('CERT') || msg.includes('SSL') || msg.includes('self-signed'))
    return 'SSL error. Try http:// instead of https://';
  if (msg.includes('Invalid email') || msg.includes('Invalid password') || msg.includes('401'))
    return 'Login failed. Try username "admin" with password "admin-nexus-qpi".';
  if (msg.includes('not found') && (msg.includes('user') || msg.includes('User')))
    return 'User not found. Try username "admin" instead of email.';
  if (msg.includes('Timeout'))
    return 'Timed out. Server may be starting — try again.';
  return msg;
}

function onConnected() {
  setStatus(true);
  const lf = $('loginFields'); if (lf) lf.style.display = 'none';
  const dc = $('disconnectBtn'); if (dc) dc.style.display = 'inline-flex';
  refreshModels();
  fetchVisionModels();
  showPage('models');
}

async function disconnectFromServer() {
  try {
    await window.nexus.disconnectServer();
  } catch (_) {}
  setStatus(false);
  serverModels = [];
  currentServerUrl = '';
  const lf = $('loginFields'); if (lf) lf.style.display = 'block';
  const dc = $('disconnectBtn'); if (dc) dc.style.display = 'none';
  $('connectBtn').innerHTML = '&#128274; Login &amp; Connect';
  showMsg('Disconnected', 'info');
  log('Disconnected');
  renderServerModels();
  restoreActiveDownloadUI();
}

// ── Connect to Server ──
async function connectToServer() {
  const url = $('serverUrl').value.trim();
  if (!url) { showMsg('Enter a server URL', 'error'); return; }

  const btn = $('connectBtn');
  btn.disabled = true;
  currentServerUrl = url.replace(/\/$/, '');

  // Try saved token first (auto-reconnect from previous session)
  const config = await window.nexus.getConfig();
  if (config.authToken && config.deviceId) {
    btn.innerHTML = '&#9679; Reconnecting...';
    showMsg('Reconnecting...', 'info');
    try {
      const result = await window.nexus.registerDevice(url, null);
      log(`Reconnected: ${result.id}`);
      showMsg('Reconnected!', 'success');
      onConnected();
      btn.disabled = false;
      btn.innerHTML = '&#10003; Connected';
      return;
    } catch (e) {
      log(`Saved token failed: ${e.message}`);
      // Fall through to login
    }
  }

  // Login with credentials
  const email = $('loginEmail')?.value.trim();
  const password = $('loginPassword')?.value;
  if (!email || !password) {
    showMsg('Enter email/username and password', 'error');
    btn.disabled = false;
    btn.innerHTML = '&#128274; Login &amp; Connect';
    return;
  }

  btn.innerHTML = '&#9679; Logging in...';
  showMsg('Authenticating...', 'info');
  log(`Logging in to ${url}...`);

  try {
    // Step 1: Login
    const loginResult = await window.nexus.loginToServer(url, email, password);
    log(`Logged in as ${loginResult.user?.name || email}`);
    showMsg('Logged in! Registering device...', 'info');

    // Step 2: Register device with the user token
    btn.innerHTML = '&#9679; Registering...';
    const result = await window.nexus.registerDevice(url, null);
    log(`Device registered: ${result.id}`);
    showMsg(`Connected as ${loginResult.user?.name || email}`, 'success');
    onConnected();
  } catch (e) {
    showMsg(friendlyError(e.message), 'error');
    log(`Connection failed: ${e.message}`);
    setStatus(false);
  } finally {
    btn.disabled = false;
    btn.innerHTML = connected ? '&#10003; Connected' : '&#128274; Login &amp; Connect';
  }
}

// ── Fetch Models ──
async function refreshModels() {
  if (!connected) return;
  try {
    log('Fetching server models...');
    const data = await window.nexus.fetchModels();
    serverModels = data.models || [];
    log(`Found ${serverModels.length} server models`);
    renderServerModels();
    await refreshDownloaded();
  } catch (e) {
    log(`Fetch failed: ${e.message}`);
  }
}

function renderServerModels() {
  const container = $('serverModels');
  if (serverModels.length === 0) {
    const msg = connected
      ? 'No models found on server. Quantize models from the web dashboard first.'
      : 'Log in to a server to browse and download models.';
    const icon = connected ? '&#129504;' : '&#128279;';
    container.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <div class="icon">${icon}</div>
        <div class="sub">${msg}</div>
      </div>`;
    return;
  }

  container.innerHTML = serverModels.map(m => {
    const isDownloaded = downloadedModels.has(m.file);
    const badgeClass = `badge-${m.method.toLowerCase()}`;
    const canChat = m.method === 'GGUF';
    const sizeMB = m.sizeMB || 0;

    let actions = `<span class="badge ${badgeClass}">${esc(m.method)}</span>`;
    if (canChat && isDownloaded) {
      actions += `<span class="badge badge-local">Downloaded</span>`;
      actions += `<button class="btn btn-sm btn-success" onclick="openChat('${esc(m.file)}', '${esc(m.name)}', '${esc(m.method)}', 'local')">Chat Local</button>`;
    } else if (canChat) {
      actions += `<button class="btn btn-sm btn-primary" id="dl-${esc(m.file)}" onclick="downloadModel('${esc(m.file)}')">&#11015; Download</button>`;
    }
    if (canChat) {
      actions += `<button class="btn btn-sm btn-ghost" onclick="openChat('${esc(m.file)}', '${esc(m.name)}', '${esc(m.method)}', 'server')">&#9729; Server</button>`;
    }

    return `
      <div class="model-row" id="model-${esc(m.file)}">
        <div class="model-info">
          <div class="model-name">${esc(m.name)}</div>
          <div class="model-meta">${esc(m.method)} &middot; ${sizeMB} MB</div>
        </div>
        <div class="model-actions">${actions}</div>
      </div>
      <div id="progress-${esc(m.file)}" class="hidden progress-wrap">
        <div class="progress-bar"><div class="fill" id="fill-${esc(m.file)}" style="width:0%"></div></div>
        <div class="progress-text" id="ptext-${esc(m.file)}"></div>
      </div>`;
  }).join('');
}

function restoreActiveDownloadUI() {
  for (const filename of Object.keys(activeDownloadState)) {
    const state = activeDownloadState[filename];
    const progressDiv = document.getElementById(`progress-${filename}`);
    const fill = document.getElementById(`fill-${filename}`);
    const ptext = document.getElementById(`ptext-${filename}`);
    const dlBtn = document.getElementById(`dl-${filename}`);

    if (progressDiv) progressDiv.classList.remove('hidden');
    if (fill) fill.style.width = `${state.percent}%`;
    if (ptext) {
      const dlMB = Math.round(state.downloaded / (1024 * 1024));
      const totalMB = Math.round(state.total / (1024 * 1024));
      ptext.textContent = `${dlMB} MB / ${totalMB} MB (${state.percent}%)`;
    }
    if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = '\u23F3'; }
  }
}

async function refreshDownloaded() {
  try {
    const models = await window.nexus.listDownloaded();
    downloadedModelsList = models;
    downloadedModels = new Set(models.map(m => m.name));

    const container = $('localModels');
    if (models.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px;">
          <div class="icon">&#128230;</div>
          <div class="sub">No models downloaded yet</div>
        </div>`;
    } else {
      container.innerHTML = models.map(m => `
        <div class="model-row">
          <div class="model-info">
            <div class="model-name">${esc(m.name)}</div>
            <div class="model-meta">${m.sizeMB} MB &middot; GGUF &middot; Ready</div>
          </div>
          <div class="model-actions">
            <span class="badge badge-gguf">GGUF</span>
            <button class="btn btn-sm btn-success" onclick="openChat('${esc(m.name)}', '${esc(m.name)}', 'GGUF', 'local')">&#128172; Chat</button>
            <button class="btn btn-sm btn-ghost" onclick="deleteLocalModel('${esc(m.name)}')" title="Delete model">&#128465;</button>
          </div>
        </div>`).join('');
    }
    renderServerModels();
    restoreActiveDownloadUI();
  } catch (e) {
    log(`List error: ${e.message}`);
  }
}

async function deleteLocalModel(filename) {
  if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
  try {
    await window.nexus.deleteModel(filename);
    log(`Deleted: ${filename}`);
    await refreshDownloaded();
  } catch (e) {
    log(`Delete failed: ${e.message}`);
  }
}

function renderChatList() {
  const container = $('chatModelList');
  const models = [];

  // Add downloaded models for local chat
  downloadedModels.forEach(name => {
    models.push({ name, file: name, method: 'GGUF', mode: 'local', label: 'Local' });
  });

  // Add server models for server chat
  serverModels.filter(m => m.method === 'GGUF').forEach(m => {
    models.push({ name: m.name, file: m.file, method: m.method, mode: 'server', label: 'Server' });
  });

  if (models.length === 0) {
    let title, sub;
    if (!connected && downloadedModels.size === 0) {
      title = 'No Models Available';
      sub = 'Connect to a server to download models, or use "Skip \u2014 Use Offline" if you already have models.';
    } else if (connected && downloadedModels.size === 0) {
      title = 'No GGUF Models Yet';
      sub = 'Go to the Models tab to download a GGUF model for local chat, or use Server mode.';
    } else {
      title = 'No Chat Models';
      sub = 'Download GGUF models from the Models tab for local inference.';
    }
    container.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <div class="icon">&#128172;</div>
        <div class="title">${title}</div>
        <div class="sub">${sub}</div>
      </div>`;
    return;
  }

  container.innerHTML = models.map(m => {
    const badgeClass = m.mode === 'local' ? 'badge-local' : 'badge-server';
    const icon = m.mode === 'local' ? '&#128187;' : '&#9729;';
    return `
    <div class="model-row" style="cursor:pointer;" onclick="openChat('${esc(m.file)}', '${esc(m.name)}', '${m.method}', '${m.mode}')">
      <div class="model-info">
        <div class="model-name">${esc(m.name)}</div>
        <div class="model-meta">${m.method} &middot; ${m.label}</div>
      </div>
      <div class="model-actions">
        <span class="badge ${badgeClass}">${icon} ${m.label}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Download ──
async function downloadModel(filename) {
  // Guard against duplicate downloads
  if (activeDownloadState[filename]) return;

  log(`Downloading: ${filename}`);
  activeDownloadState[filename] = { downloaded: 0, total: 0, percent: 0 };

  const dlBtn = document.getElementById(`dl-${filename}`);
  const progressDiv = document.getElementById(`progress-${filename}`);
  if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = '\u23F3'; }
  if (progressDiv) progressDiv.classList.remove('hidden');

  try {
    await window.nexus.downloadModel(filename);
    log(`Download complete: ${filename}`);
    delete activeDownloadState[filename];
    await refreshDownloaded();
  } catch (e) {
    log(`Download failed: ${e.message}`);
    delete activeDownloadState[filename];
    // Re-lookup button in case DOM was rebuilt
    const retryBtn = document.getElementById(`dl-${filename}`);
    if (retryBtn) { retryBtn.disabled = false; retryBtn.textContent = 'Retry'; }
  }
  const pd = document.getElementById(`progress-${filename}`);
  if (pd) pd.classList.add('hidden');
}

window.nexus.onDownloadProgress((data) => {
  // Keep renderer-side state in sync for DOM rebuilds
  if (activeDownloadState[data.filename]) {
    activeDownloadState[data.filename] = {
      downloaded: data.downloaded,
      total: data.total,
      percent: data.percent,
    };
  }
  const fill = document.getElementById(`fill-${data.filename}`);
  const text = document.getElementById(`ptext-${data.filename}`);
  if (fill) fill.style.width = `${data.percent}%`;
  if (text) {
    const dlMB = Math.round(data.downloaded / (1024 * 1024));
    const totalMB = Math.round(data.total / (1024 * 1024));
    text.textContent = `${dlMB} MB / ${totalMB} MB (${data.percent}%)`;
  }
});

// Download complete event from main process (fires even if renderer navigated away)
window.nexus.onDownloadComplete((data) => {
  delete activeDownloadState[data.filename];
  if (document.getElementById('page-models')?.classList.contains('active')) {
    refreshDownloaded();
  }
});

// ── Chat ──
async function openChat(modelFile, modelName, method, mode) {
  currentChatModel = modelFile;
  currentChatMethod = method;

  $('chatModelName').textContent = modelName;

  const badge = $('chatModeBadge');
  if (mode === 'local') {
    badge.textContent = '\u{1F4BB} Local';
    badge.style.color = '#34d399';
    badge.style.background = 'rgba(52,211,153,0.12)';
    badge.style.border = '1px solid rgba(52,211,153,0.2)';
  } else {
    badge.textContent = '\u2601 Server';
    badge.style.color = '#7b9fc7';
    badge.style.background = 'rgba(123,159,199,0.12)';
    badge.style.border = '1px solid rgba(123,159,199,0.2)';
  }

  $('chatMetrics').textContent = '';
  clearChatImage();

  // Highlight image button for VLM models
  const isVlm = modelName.toLowerCase().includes('vlm') || modelName.toLowerCase().includes('vision');
  $('chatImageBtn').classList.toggle('vlm-active', isVlm);

  // Hide pages, show chat
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $('chatView').classList.add('active');

  $('chatMessages').innerHTML = '';
  chatMessages = [];
  chatReady = false;
  $('sendBtn').disabled = true;

  if (mode === 'server') {
    $('stopServerBtn').classList.add('hidden');
    appendSystemMsg('Connecting to Nexus server...');
    chatReady = true;
    $('sendBtn').disabled = false;
    appendSystemMsg(`Ready to chat with ${modelName} via server.`);
  } else {
    $('stopServerBtn').classList.remove('hidden');
    appendSystemMsg('Starting local inference server...');
    appendSystemMsg('Loading model into memory...');
    log(`Loading model: ${modelFile}...`);

    try {
      await window.nexus.startLlamaServer(modelFile);
      log('Model loaded successfully');
      chatReady = true;
      $('sendBtn').disabled = false;
      appendSystemMsg('Model loaded. Ready to chat!');
    } catch (e) {
      const errMsg = e.message || String(e);
      log(`Model load error: ${errMsg}`);
      if (errMsg.includes('binary not found')) {
        appendSystemMsg('llama-server binary not found. Reinstall the app.');
      } else if (errMsg.includes('Not enough RAM') || errMsg.includes('too large')) {
        appendSystemMsg('Not enough RAM for this model. Try a smaller model or close other apps.');
      } else if (errMsg.includes('Permission denied')) {
        appendSystemMsg('Permission denied running llama-server. Check file permissions.');
      } else {
        appendSystemMsg(`Failed to load model: ${errMsg}`);
      }
    }
  }

  $('chatInput').focus();
}

function closeChat() {
  $('chatView').classList.remove('active');
  clearChatImage();
  _tokenListeners = [];
  showPage('chat-list');
}

function clearChatImage() {
  chatImageBase64 = null;
  chatImageFileName = null;
  $('chatImagePreview').style.display = 'none';
  $('chatImageInput').value = '';
}

function handleChatImageSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  chatImageFileName = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1024;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      chatImageBase64 = canvas.toDataURL('image/jpeg', 0.85);
      $('chatPreviewImg').src = chatImageBase64;
      $('chatImagePreview').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function stopServer() {
  await window.nexus.stopLlamaServer();
  log('Model unloaded');
  closeChat();
}

async function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text || generating || !chatReady) return;

  input.value = '';
  const attachedImage = chatImageBase64;
  clearChatImage();

  chatMessages.push({ role: 'user', content: text, image: attachedImage || undefined });
  if (chatMessages.length > 200) {
    chatMessages.splice(1, chatMessages.length - 200);
  }
  appendBubble('user', text, attachedImage);

  chatMessages.push({ role: 'assistant', content: '' });
  const bubbleEl = appendBubble('assistant', '');
  bubbleEl.querySelector('.bubble').innerHTML = '<span class="typing-dots"><span>&#8226;</span><span>&#8226;</span><span>&#8226;</span></span>';

  setGenerating(true);
  const startTime = Date.now();
  let tokenCount = 0;
  let fullResponse = '';

  const isServer = $('chatModeBadge').textContent.includes('Server');

  try {
    if (isServer) {
      // ── Server-mode streaming via Nexus /api/chat ──
      const controller = new AbortController();
      currentAbort = controller;

      const serverMessages = chatMessages.slice(0, -1).map(m => {
        const msg = { role: m.role, content: m.content };
        if (m.image) msg.image = m.image;
        return msg;
      });
      const reqBody = JSON.stringify({
        model: currentChatModel,
        method: currentChatMethod,
        messages: serverMessages,
        maxTokens: 1024,
      });

      const chatHeaders = { 'Content-Type': 'application/json' };
      try {
        const token = await window.nexus.getAuthToken();
        if (token) chatHeaders['Authorization'] = `Bearer ${token}`;
      } catch (_) {}

      const res = await fetch(`${currentServerUrl}/api/chat`, {
        method: 'POST',
        headers: chatHeaders,
        body: reqBody,
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server: ${res.status} ${res.statusText}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const json = JSON.parse(data);
            const token = json.text || json.content;
            const type = json.type;
            if (token && type !== 'error') {
              fullResponse += token;
              tokenCount++;
              bubbleEl.querySelector('.bubble').textContent = fullResponse;
              scrollChat();
            } else if (type === 'error') {
              const errMsg = json.message || json.error || 'Server error';
              if (!fullResponse) bubbleEl.querySelector('.bubble').textContent = `Error: ${errMsg}`;
            }
          } catch (_) {}
        }
      }

    } else {
      // ── Local-mode streaming via llama-server (IPC) ──
      await new Promise((resolve, reject) => {
        currentAbort = { abort: () => window.nexus.llamaAbort() };

        const tokenHandler = (data) => {
          if (data === '__DONE__') {
            removeTokenListener(tokenHandler);
            resolve();
          } else if (data.startsWith('__ERROR__')) {
            removeTokenListener(tokenHandler);
            reject(new Error(data.slice(9)));
          } else {
            fullResponse += data;
            tokenCount++;
            bubbleEl.querySelector('.bubble').textContent = fullResponse;
            scrollChat();
          }
        };

        addTokenListener(tokenHandler);

        window.nexus.llamaChat(chatMessages.slice(0, -1)).catch(reject);
      });
    }

    chatMessages[chatMessages.length - 1].content = fullResponse;

  } catch (e) {
    if (e.name !== 'AbortError') {
      if (!fullResponse) bubbleEl.querySelector('.bubble').textContent = `Error: ${e.message}`;
      log(`Chat error: ${e.message}`);
    }
  } finally {
    currentAbort = null;
    setGenerating(false);

    const elapsed = (Date.now() - startTime) / 1000;
    const tokPerSec = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : '0';
    if (tokenCount > 0) {
      $('chatMetrics').textContent = `${tokenCount} tokens \u2022 ${tokPerSec} tok/s \u2022 ${elapsed.toFixed(1)}s`;
      try {
        window.nexus.reportInference({
          tokensPerSec: parseFloat(tokPerSec),
          tokenCount,
          elapsed,
          model: currentChatModel,
          mode: isServer ? 'server' : 'local',
        });
      } catch (_) {}
    }
  }
}

function stopGeneration() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
}

function setGenerating(val) {
  generating = val;
  $('sendBtn').classList.toggle('hidden', val);
  $('stopGenBtn').classList.toggle('hidden', !val);
  $('chatInput').disabled = val;
  if (!val) $('chatInput').focus();
}

function appendBubble(role, text, imageData) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (imageData) {
    const img = document.createElement('img');
    img.className = 'chat-img';
    img.src = imageData;
    bubble.appendChild(img);
  }

  const textNode = document.createTextNode(text);
  bubble.appendChild(textNode);

  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(bubble.textContent.replace('Copy', '').replace('Copied!', '').trim());
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy', 1500);
    };
    bubble.appendChild(copyBtn);
  }

  div.appendChild(bubble);
  $('chatMessages').appendChild(div);
  scrollChat();
  return div;
}

function appendSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  $('chatMessages')?.appendChild(div);
  scrollChat();
}

function scrollChat() {
  const el = $('chatMessages');
  if (el) el.scrollTop = el.scrollHeight;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Llama engine events ──
window.nexus.onLlamaLog((text) => log(`[llama] ${text.trim()}`));
window.nexus.onLlamaStopped((msg) => log(`[llama] Stopped: ${msg}`));
window.nexus.onLlamaToken((data) => {
  _tokenListeners.forEach(fn => fn(data));
});

// ── System Metrics (sidebar) ──
async function updateSysMetrics() {
  try {
    const m = await window.nexus.getSystemMetrics();
    const cpuBar = $('cpuBar');
    const memBar = $('memBar');
    const cpuVal = $('cpuVal');
    const memVal = $('memVal');
    if (cpuBar) cpuBar.style.width = `${m.cpuUsage}%`;
    if (memBar) memBar.style.width = `${m.memoryUsage}%`;
    if (cpuVal) cpuVal.textContent = `${m.cpuUsage}%`;
    if (memVal) memVal.textContent = `${m.memoryUsage}%`;
  } catch (_) {}
}

// ── Vision ──
let visionModels = [];
let visionCurrentFile = null;

async function fetchVisionModels() {
  if (!connected) return;
  try {
    const token = await window.nexus.getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${currentServerUrl}/api/mobile/vision/models`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    visionModels = data.models || [];
    renderVisionModelSelect();
  } catch (e) {
    log(`Vision models: ${e.message}`);
  }
}

function renderVisionModelSelect() {
  const select = $('visionModelSelect');
  if (!select) return;
  if (visionModels.length === 0) {
    select.innerHTML = '<option value="">No vision models</option>';
    return;
  }
  select.innerHTML = visionModels.map(m =>
    `<option value="${esc(m.dirName + '/' + m.fileName)}">${esc(m.name)} (${m.format})</option>`
  ).join('');
  updateDetectBtn();
}

function selectVisionImage() {
  $('visionFileInput').click();
}

function handleVisionFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  visionCurrentFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = $('visionImg');
    img.src = e.target.result;
    img.onload = () => {
      const canvas = $('visionCanvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.width = img.clientWidth + 'px';
      canvas.style.height = img.clientHeight + 'px';
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      $('visionPreview').classList.remove('hidden');
      $('visionEmptyState').classList.add('hidden');
      $('visionResults').classList.add('hidden');
      updateDetectBtn();
    };
  };
  reader.readAsDataURL(file);
}

function updateDetectBtn() {
  const select = $('visionModelSelect');
  $('detectBtn').disabled = !visionCurrentFile || !select?.value;
}

async function runVisionDetection() {
  if (!visionCurrentFile || !connected) return;

  const select = $('visionModelSelect');
  const modelVal = select?.value;
  if (!modelVal) return;

  const parts = modelVal.split('/');
  if (parts.length < 2) { log('Error: Invalid model selection'); return; }
  const [dirName, fileName] = parts;
  const btn = $('detectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span style="animation:pulse 1s infinite">\u23F3</span> Running...';
  log('Running vision inference...');

  try {
    const token = await window.nexus.getAuthToken();
    const formData = new FormData();
    formData.append('image', visionCurrentFile);
    formData.append('modelDirName', dirName);
    formData.append('modelFile', fileName);
    formData.append('task', 'detect');
    formData.append('conf', '0.25');
    formData.append('iou', '0.45');

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${currentServerUrl}/api/mobile/vision/infer`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const result = await res.json();
    const detections = result.detections || [];

    const img = $('visionImg');
    const canvas = $('visionCanvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width = img.clientWidth + 'px';
    canvas.style.height = img.clientHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colors = ['#7b9fc7', '#3b82f6', '#34d399', '#f59e0b', '#f87171', '#d63384', '#06b6d4', '#84cc16'];

    detections.forEach((det, i) => {
      const color = colors[i % colors.length];
      const [x1, y1, x2, y2] = det.box || det.bbox || [0, 0, 0, 0];
      const w = x2 - x1;
      const h = y2 - y1;

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, w, h);

      const label = `${det.class || det.label || 'obj'} ${((det.confidence || det.conf || 0) * 100).toFixed(0)}%`;
      ctx.font = 'bold 14px Inter, -apple-system, sans-serif';
      const tm = ctx.measureText(label);
      ctx.fillStyle = color;
      ctx.fillRect(x1, y1 - 22, tm.width + 10, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x1 + 5, y1 - 6);
    });

    $('visionDetCount').textContent = detections.length;
    $('visionTime').textContent = `${result.inferenceTimeMs || 0}ms`;
    $('visionResults').classList.remove('hidden');
    log(`Detection complete: ${detections.length} objects in ${result.inferenceTimeMs}ms`);

  } catch (e) {
    log(`Detection failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9654; Detect';
    updateDetectBtn();
  }
}

// ── Vision: Webcam ──
let webcamStream = null;

async function startWebcam() {
  const video = $('visionWebcamVideo');
  const captureBtn = $('visionCaptureBtn');
  if (!video) return;

  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
    video.classList.add('hidden');
    captureBtn.classList.add('hidden');
    $('webcamBtn').textContent = '\u{1F4F9} Webcam';
    return;
  }

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = webcamStream;
    video.classList.remove('hidden');
    captureBtn.classList.remove('hidden');
    $('webcamBtn').textContent = '\u23F9 Stop Webcam';
    $('visionEmptyState').classList.add('hidden');
    log('Webcam started');
  } catch (e) {
    log(`Webcam error: ${e.message}`);
  }
}

function captureWebcamFrame() {
  const video = $('visionWebcamVideo');
  if (!video || !webcamStream) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    visionCurrentFile = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });

    const img = $('visionImg');
    img.src = canvas.toDataURL('image/jpeg');
    img.onload = () => {
      const overlay = $('visionCanvas');
      overlay.width = img.naturalWidth;
      overlay.height = img.naturalHeight;
      overlay.style.width = img.clientWidth + 'px';
      overlay.style.height = img.clientHeight + 'px';
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      $('visionPreview').classList.remove('hidden');
      $('visionResults').classList.add('hidden');
      updateDetectBtn();
    };

    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
    video.classList.add('hidden');
    $('visionCaptureBtn').classList.add('hidden');
    $('webcamBtn').textContent = '\u{1F4F9} Webcam';
    log('Webcam frame captured');
  }, 'image/jpeg', 0.9);
}

// ── Vision: Model Download ──
async function downloadVisionModel() {
  const select = $('visionModelSelect');
  if (!select?.value || !connected) return;

  const dlParts = select.value.split('/');
  if (dlParts.length < 2) { log('Error: Invalid model selection'); return; }
  const [dirName, fileName] = dlParts;
  const dlBtn = $('visionDownloadBtn');
  if (dlBtn) {
    dlBtn.disabled = true;
    dlBtn.innerHTML = '<span style="animation:pulse 1s infinite">\u23F3</span> Downloading...';
  }

  try {
    const token = await window.nexus.getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${currentServerUrl}/api/mobile/vision/download`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dirName, fileName }),
    });

    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    log(`Vision model downloaded: ${fileName}`);
  } catch (e) {
    log(`Vision model download failed: ${e.message}`);
  } finally {
    if (dlBtn) {
      dlBtn.disabled = false;
      dlBtn.innerHTML = '\u2B07 Download';
    }
  }
}

// ── Open models directory in OS file manager ──
async function openModelsDir() {
  try { await window.nexus.openModelsDir(); } catch (_) {}
}

// ── Init ──
let currentPlatform = '';

async function init() {
  try {
    currentPlatform = await window.nexus.getPlatform();
    if (currentPlatform === 'darwin') document.body.classList.add('platform-darwin');

    const hw = await window.nexus.getHardware();
    $('deviceInfo').innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;">
        <span style="color:#7b9fc7;font-weight:600;">Host</span><span>${hw.name}</span>
        <span style="color:#7b9fc7;font-weight:600;">OS</span><span>${hw.platform}</span>
        <span style="color:#7b9fc7;font-weight:600;">CPU</span><span>${hw.cpuModel}</span>
        <span style="color:#7b9fc7;font-weight:600;">Cores</span><span>${hw.cpuCores}</span>
        <span style="color:#7b9fc7;font-weight:600;">RAM</span><span>${hw.ramGB} GB</span>
      </div>`;
    $('hwInfo').innerHTML = `${hw.cpuCores} cores &middot; ${hw.ramGB} GB`;

    updateSysMetrics();
    metricsTimer = setInterval(updateSysMetrics, 5000);

    // Check local inference engine status
    try {
      const llama = await window.nexus.checkLlamaAvailable();
      if (llama.available) {
        log('Local inference engine: ready (llama-server)');
      } else {
        log('Local inference engine: llama-server binary not found');
      }
    } catch (_) {}

    const config = await window.nexus.getConfig();
    if (config.serverUrl) {
      $('serverUrl').value = config.serverUrl;
      currentServerUrl = config.serverUrl.replace(/\/$/, '');

      // Auto-reconnect with saved device token
      if (config.deviceId && config.authToken) {
        log('Auto-reconnecting...');
        showMsg('Reconnecting...', 'info');
        const btn = $('connectBtn');
        btn.disabled = true;
        btn.innerHTML = '&#9679; Reconnecting...';

        try {
          await Promise.race([
            window.nexus.registerDevice(config.serverUrl, null),
            new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 10000)),
          ]);
          showMsg('Reconnected!', 'success');
          onConnected();
          log('Reconnected to server');
        } catch (e) {
          log(`Auto-connect failed: ${e.message}`);
          showMsg('Session expired \u2014 log in to reconnect', 'info');
        } finally {
          btn.disabled = false;
          btn.innerHTML = connected ? '&#10003; Connected' : '&#128274; Login &amp; Connect';
        }
      }
    }

    await refreshDownloaded();
    $('chatImageInput').addEventListener('change', handleChatImageSelect);

    // Show models directory path in UI
    try {
      const modelsPath = await window.nexus.getModelsDir();
      const pathEl = $('modelsDirPath');
      if (pathEl && modelsPath) pathEl.textContent = modelsPath;
    } catch (_) {}

    // Sync active downloads from main process (in case app was reloaded mid-download)
    try {
      const downloads = await window.nexus.getActiveDownloads();
      if (downloads && Object.keys(downloads).length > 0) {
        activeDownloadState = downloads;
        restoreActiveDownloadUI();
      }
    } catch (_) {}

    if (!connected && downloadedModels.size > 0) {
      log(`${downloadedModels.size} local model(s) ready for offline chat`);
      showPage('chat-list');
    }
  } catch (e) {
    log(`Init error: ${e.message}`);
  }
}

// ── Server Push (Deploy Events) ──
window.nexus.onDeployEvent((data) => {
  const model = data.model || data.file || 'Unknown model';
  log(`[Push] Server deployed: ${model}`);

  // Show notification
  const notif = document.createElement('div');
  notif.style.cssText = 'position:fixed;top:16px;right:16px;background:#1e293b;border:1px solid #7b9fc7;border-radius:8px;padding:12px 20px;color:#e2e8f0;z-index:9999;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  notif.innerHTML = `<strong>\u{1F4E6} Server Push</strong><br>${esc(model)}<br><small>Downloading...</small>`;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 8000);

  // Auto-download if it's a GGUF model
  const filename = data.file || data.model;
  if (filename && filename.endsWith('.gguf')) {
    downloadModel(filename);
  }
});

init();
