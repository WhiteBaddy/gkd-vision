const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  meta: null,
  bitmap: null,
  nodes: [],
  nodesSeq: 0,
  selectedId: null,
  hoverId: null,
  mode: 'inspect',
  view: { scale: 1, tx: 0, ty: 0, fitted: false },
  pointer: { x: 0, y: 0, inside: false },
  drag: null,
  swipeStart: null,
  lastTap: null,
  cleanup: true,
  paused: false,
  mock: false,
  decodeBusy: false,
  pendingBlob: null,
  treeFilter: '',
  logCount: 0,
};

const canvas = $('screen');
const ctx = canvas.getContext('2d');
const wrap = $('canvas-wrap');

const N = (a) => ({
  id: a[0],
  pid: a[1],
  depth: a[2],
  left: a[3],
  top: a[4],
  right: a[5],
  bottom: a[6],
  clickable: !!a[7],
  longClickable: !!a[8],
  editable: !!a[9],
  text: a[10] || '',
  desc: a[11] || '',
  vid: a[12] || '',
  viewId: a[13] || '',
  name: a[14] || '',
});

function nodeLabel(n) {
  if (n.text) return n.text;
  if (n.desc) return n.desc;
  if (n.vid) return `#${n.vid}`;
  if (n.viewId) return n.viewId.split('/').pop();
  return n.name || '?';
}

function log(kind, text) {
  const box = $('log');
  const item = document.createElement('div');
  item.className = `log-item ${kind}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  item.innerHTML = `<time>${time}</time>${text}`;
  box.prepend(item);
  if (++state.logCount > 200) box.lastChild?.remove();
}

/* ---------------------------------- view ---------------------------------- */

function resize() {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function fit() {
  const meta = state.meta;
  const rect = wrap.getBoundingClientRect();
  if (!meta || !meta.screenWidth || !meta.screenHeight) return;
  const scale = Math.min(rect.width / meta.screenWidth, rect.height / meta.screenHeight) * 0.96;
  state.view = {
    scale,
    tx: (rect.width - meta.screenWidth * scale) / 2,
    ty: (rect.height - meta.screenHeight * scale) / 2,
    fitted: true,
  };
  render();
}

function toScreen(clientX, clientY) {
  const rect = wrap.getBoundingClientRect();
  const { scale, tx, ty } = state.view;
  return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
}

function toCanvas(x, y) {
  const { scale, tx, ty } = state.view;
  return { x: x * scale + tx, y: y * scale + ty };
}

function nodeAt(x, y) {
  let best = null;
  for (const n of state.nodes) {
    if (n.right <= n.left || n.bottom <= n.top) continue;
    if (x < n.left || x >= n.right || y < n.top || y >= n.bottom) continue;
    const area = (n.right - n.left) * (n.bottom - n.top);
    const score = n.depth * 100 - Math.min(area / 1000, 999);
    if (!best || score > best.score) best = { n, score };
  }
  return best?.n ?? null;
}

function render() {
  const rect = wrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!state.bitmap || !state.meta) return;

  const { scale, tx, ty } = state.view;
  const { screenWidth: w, screenHeight: h } = state.meta;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = scale < 1.6;
  ctx.drawImage(state.bitmap, 0, 0, w, h);

  if ($('chk-overlay').checked) {
    const limit = state.nodes.length > 2500 ? 2500 : state.nodes.length;
    for (let i = 0; i < limit; i++) {
      const n = state.nodes[i];
      const bw = n.right - n.left;
      const bh = n.bottom - n.top;
      if (bw <= 1 || bh <= 1) continue;
      if (n.depth === 0) continue;
      const interactive = n.clickable || n.longClickable || n.editable;
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = interactive ? 'rgba(34,211,238,0.55)' : 'rgba(99,102,241,0.22)';
      ctx.strokeRect(n.left + 0.5, n.top + 0.5, bw - 1, bh - 1);
    }
  }

  const highlight = state.selectedId ?? state.hoverId;
  if (highlight != null) {
    const n = state.nodes.find((item) => item.id === highlight);
    if (n) {
      ctx.lineWidth = 2.5 / scale;
      ctx.strokeStyle = '#f0abfc';
      ctx.strokeRect(n.left, n.top, n.right - n.left, n.bottom - n.top);
      if (state.selectedId != null) {
        ctx.fillStyle = 'rgba(240,171,252,0.08)';
        ctx.fillRect(n.left, n.top, n.right - n.left, n.bottom - n.top);
      }
    }
  }

  if (state.lastTap && Date.now() - state.lastTap.at < 900) {
    const age = (Date.now() - state.lastTap.at) / 900;
    ctx.beginPath();
    ctx.arc(state.lastTap.x, state.lastTap.y, 20 + age * 60, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(34,211,238,${1 - age})`;
    ctx.lineWidth = 3 / scale;
    ctx.stroke();
    if (!state.rafPending) {
      state.rafPending = true;
      requestAnimationFrame(() => {
        state.rafPending = false;
        render();
      });
    }
  }

  if (state.swipeStart && state.pointer.inside) {
    ctx.beginPath();
    ctx.moveTo(state.swipeStart.x, state.swipeStart.y);
    ctx.lineTo(state.pointer.x, state.pointer.y);
    ctx.strokeStyle = 'rgba(251,191,36,0.9)';
    ctx.lineWidth = 3 / scale;
    ctx.setLineDash([8 / scale, 6 / scale]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/* --------------------------------- socket --------------------------------- */

let retry = 0;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  state.ws = ws;

  ws.onopen = () => {
    retry = 0;
    $('status-dot').classList.add('on');
    log('ok', '已连接 gkd-vision');
    applyConfig();
  };
  ws.onclose = () => {
    $('status-dot').classList.remove('on');
    state.ws = null;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * retry);
  };
  ws.onerror = () => {};
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      handleMessage(JSON.parse(event.data));
      return;
    }
    handleBinary(event.data);
  };
}

function handleMessage(msg) {
  if (msg.type === 'hello') {
    state.mock = Boolean(msg.mock);
    $('device-line').textContent = msg.mock ? 'mock 设备 · 模拟数据' : 'GKD 设备';
    return;
  }
  if (msg.type === 'frame') {
    state.meta = msg;
    updateMetrics();
    if (!state.view.fitted) fit();
    render();
    return;
  }
  if (msg.type === 'tree') {
    state.nodes = msg.nodes.map(N);
    state.nodesSeq = msg.seq;
    renderTree();
    render();
    return;
  }
  if (msg.type === 'action') {
    const ok = msg.ok !== false && msg.result?.result !== false;
    log(ok ? 'ok' : 'err', `${msg.kind} ${ok ? '成功' : '失败'} ${msg.anchor != null ? `· anchor=${JSON.stringify(msg.anchor)}` : ''}`);
    if (msg.kind === 'tap' || msg.kind === 'longpress') {
      state.lastTap = { x: msg.point?.x ?? 0, y: msg.point?.y ?? 0, at: Date.now() };
      render();
    }
    return;
  }
  if (msg.type === 'error') {
    log('err', msg.error);
    $('sel-result').textContent = msg.error;
    return;
  }
  if (msg.type === 'warn') {
    log('', msg.message);
    return;
  }
  if (msg.type === 'config' && msg.config) {
    $('sel-interval').value = String(msg.config.interval);
    $('chk-cleanup').checked = msg.config.cleanup;
    state.paused = msg.config.paused;
    $('btn-pause').textContent = state.paused ? '继续' : '暂停';
  }
}

function handleBinary(buffer) {
  if (state.decodeBusy) {
    state.pendingBlob = buffer;
    return;
  }
  state.decodeBusy = true;
  const mime = state.meta?.mime || 'image/webp';
  createImageBitmap(new Blob([buffer], { type: mime }))
    .then((bitmap) => {
      state.bitmap?.close?.();
      state.bitmap = bitmap;
      if (!state.view.fitted) fit();
      $('empty').style.display = 'none';
      render();
    })
    .catch((error) => log('err', `解码失败 ${error.message}`))
    .finally(() => {
      state.decodeBusy = false;
      if (state.pendingBlob) {
        const next = state.pendingBlob;
        state.pendingBlob = null;
        handleBinary(next);
      }
    });
}

function send(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
  else log('err', '未连接');
}

function applyConfig() {
  send({ type: 'config', config: { interval: Number($('sel-interval').value), cleanup: $('chk-cleanup').checked } });
}

/* --------------------------------- metrics -------------------------------- */

function updateMetrics() {
  const meta = state.meta;
  if (!meta) return;
  const timings = meta.timings ?? {};
  const total = (timings.capture ?? 0) + (timings.image ?? 0);
  $('m-cost').textContent = `${total}ms`;
  $('m-nodes').textContent = String(meta.nodeCount ?? '–');
  $('m-size').textContent = `${meta.screenWidth}×${meta.screenHeight}`;
  $('device-line').textContent = `${meta.appName || meta.appId} · ${String(meta.activityId || '').split('.').pop()}`;
  $('frame-badge').textContent = `#${meta.seq} · ${meta.imageBytes ? Math.round(meta.imageBytes / 1024) + 'KB' : '无图'}`;
  const fps = sessionFps();
  $('m-fps').textContent = fps.toFixed(1);
}

const frameTimes = [];
function sessionFps() {
  const now = performance.now();
  frameTimes.push(now);
  while (frameTimes.length && now - frameTimes[0] > 3000) frameTimes.shift();
  return frameTimes.length > 1 ? ((frameTimes.length - 1) * 1000) / (now - frameTimes[0]) : 0;
}

/* ---------------------------------- tree ---------------------------------- */

function renderTree() {
  const box = $('tree');
  if (!state.nodes.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '当前驱动没有控件树（root 驱动只有画面；需要控件树请用 --driver gkd）';
    box.replaceChildren(hint);
    return;
  }
  const filter = state.treeFilter.toLowerCase();
  const nodes = state.nodes.filter((n) => {
    if (n.right <= n.left || n.bottom <= n.top) return false;
    if (!filter) return true;
    return (
      n.text.toLowerCase().includes(filter) ||
      n.desc.toLowerCase().includes(filter) ||
      n.vid.toLowerCase().includes(filter) ||
      n.viewId.toLowerCase().includes(filter) ||
      n.name.toLowerCase().includes(filter)
    );
  });
  const limit = nodes.slice(0, 1500);
  const frag = document.createDocumentFragment();
  for (const n of limit) {
    const row = document.createElement('div');
    row.className = `node${n.id === state.selectedId ? ' sel' : ''}`;
    if (n.clickable || n.longClickable || n.editable) row.classList.add('interactive');
    row.style.paddingLeft = `${6 + Math.min(n.depth, 20) * 10}px`;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = n.name.replace(/^android\.widget\.|^android\.view\./, '');
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = nodeLabel(n);
    const dim = document.createElement('span');
    dim.className = 'box';
    dim.textContent = `${n.right - n.left}×${n.bottom - n.top}`;
    row.append(tag, txt, dim);
    row.onclick = () => {
      state.selectedId = n.id;
      renderTree();
      render();
      $('selected-info').textContent = `${n.name} ${n.viewId || n.vid} · ${nodeLabel(n)} · [${n.left},${n.top},${n.right},${n.bottom}]`;
      $('sel-input').value = suggestSelector(n);
    };
    frag.append(row);
  }
  box.replaceChildren(frag);
}

function suggestSelector(n) {
  const q = (v) => v.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  if (n.vid) return `[vid="${q(n.vid)}"]`;
  if (n.text) return `[text="${q(n.text)}"]`;
  if (n.desc) return `[desc="${q(n.desc)}"]`;
  if (n.viewId) return `[id="${q(n.viewId)}"]`;
  return '[visibleToUser=true]';
}

/* -------------------------------- controls -------------------------------- */

$('chk-overlay').onchange = render;
$('sel-interval').onchange = applyConfig;
$('chk-cleanup').onchange = applyConfig;
$('btn-pause').onclick = () => {
  state.paused = !state.paused;
  $('btn-pause').textContent = state.paused ? '继续' : '暂停';
  send({ type: 'config', config: { paused: state.paused } });
};
$('btn-back').onclick = () => send({ type: 'back' });
$('btn-home').onclick = () => send({ type: 'home' });
$('btn-fit').onclick = fit;
$('btn-zoom-in').onclick = () => zoomBy(1.25);
$('btn-zoom-out').onclick = () => zoomBy(0.8);

function zoomBy(factor) {
  const rect = wrap.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const { scale, tx, ty } = state.view;
  const next = Math.min(8, Math.max(0.15, scale * factor));
  state.view.scale = next;
  state.view.tx = cx - ((cx - tx) / scale) * next;
  state.view.ty = cy - ((cy - ty) / scale) * next;
  render();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
  };
}

for (const btn of document.querySelectorAll('.mode')) {
  btn.onclick = () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b === btn));
    canvas.style.cursor = state.mode === 'inspect' ? 'crosshair' : 'pointer';
  };
}

$('tree-search').oninput = (event) => {
  state.treeFilter = event.target.value;
  renderTree();
};

$('btn-exec').onclick = async () => {
  const selector = $('sel-input').value;
  const action = $('sel-action').value || undefined;
  let extra = {};
  const raw = $('sel-extra').value.trim();
  if (raw) {
    try {
      extra = JSON.parse(raw);
    } catch (error) {
      $('sel-result').textContent = `附加参数不是合法 JSON: ${error.message}`;
      return;
    }
  }
  const payload = { selector, fastQuery: $('chk-fast').checked, ...extra };
  if (action) payload.action = action;
  else delete payload.action;
  $('sel-result').textContent = '执行中…';
  try {
    const response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    const data = await response.json();
    $('sel-result').textContent = JSON.stringify(data, null, 2);
    log(data.result ? 'ok' : 'err', `exec ${action ?? 'query'} → ${JSON.stringify(data.result ?? data)}`);
  } catch (error) {
    $('sel-result').textContent = String(error);
  }
};

/* -------------------------------- pointer --------------------------------- */

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  const point = toScreen(event.clientX, event.clientY);
  if (event.button === 1 || event.button === 2 || event.shiftKey) {
    state.drag = { startX: event.clientX, startY: event.clientY, tx: state.view.tx, ty: state.view.ty };
    return;
  }
  if (state.mode === 'swipe') {
    state.swipeStart = point;
    state.pointer = { ...point, inside: true };
    render();
    return;
  }
  state.drag = { startX: event.clientX, startY: event.clientY, tx: state.view.tx, ty: state.view.ty, candidate: point };
});

canvas.addEventListener('pointermove', (event) => {
  const point = toScreen(event.clientX, event.clientY);
  state.pointer = { ...point, inside: true };
  $('cursor-pos').textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;

  if (state.drag && (event.buttons & 1 || event.buttons & 4)) {
    const dx = event.clientX - state.drag.startX;
    const dy = event.clientY - state.drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      state.view.tx = state.drag.tx + dx;
      state.view.ty = state.drag.ty + dy;
      state.view.fitted = true;
      render();
      return;
    }
  }

  if (state.mode === 'inspect' || state.mode === 'tap') {
    const node = nodeAt(point.x, point.y);
    if ((node?.id ?? null) !== state.hoverId) {
      state.hoverId = node?.id ?? null;
      $('selected-info').textContent = node ? `${node.name} · ${nodeLabel(node)} · [${node.left},${node.top},${node.right},${node.bottom}]` : '未选中节点';
      render();
    }
  } else {
    render();
  }
});

canvas.addEventListener('pointerleave', () => {
  state.pointer.inside = false;
  render();
});

canvas.addEventListener('pointerup', async (event) => {
  const point = toScreen(event.clientX, event.clientY);
  const drag = state.drag;
  state.drag = null;

  if (state.swipeStart) {
    const start = state.swipeStart;
    state.swipeStart = null;
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    if (distance > 12) {
      const duration = Math.max(80, Math.round(distance / 2.2));
      send({ type: 'swipe', x1: start.x, y1: start.y, x2: point.x, y2: point.y, duration });
      log('', `滑动 (${Math.round(start.x)},${Math.round(start.y)}) → (${Math.round(point.x)},${Math.round(point.y)}) ${duration}ms`);
    }
    render();
    return;
  }

  if (drag?.candidate) {
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (moved > 6) return;
  }

  if (state.mode === 'inspect') {
    const node = nodeAt(point.x, point.y);
    if (node) {
      state.selectedId = node.id;
      $('sel-input').value = suggestSelector(node);
      $('selected-info').textContent = `${node.name} ${node.viewId || node.vid} · ${nodeLabel(node)} · [${node.left},${node.top},${node.right},${node.bottom}]`;
      renderTree();
      render();
    }
    return;
  }

  if (state.mode === 'tap') {
    state.lastTap = { x: point.x, y: point.y, at: Date.now() };
    render();
    send({ type: 'tap', x: point.x, y: point.y, action: 'clickCenter' });
    log('', `点击 ${Math.round(point.x)},${Math.round(point.y)}`);
    return;
  }

  if (state.mode === 'longpress') {
    state.lastTap = { x: point.x, y: point.y, at: Date.now() };
    render();
    send({ type: 'longpress', x: point.x, y: point.y });
    log('', `长按 ${Math.round(point.x)},${Math.round(point.y)}`);
  }
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0016);
    const { scale, tx, ty } = state.view;
    const next = Math.min(8, Math.max(0.15, scale * factor));
    state.view.scale = next;
    state.view.tx = cx - ((cx - tx) / scale) * next;
    state.view.ty = cy - ((cy - ty) / scale) * next;
    state.view.fitted = true;
    render();
  },
  { passive: false },
);

canvas.addEventListener('dblclick', fit);

window.addEventListener('resize', resize);

/* --------------------------------- status --------------------------------- */

setInterval(async () => {
  try {
    const response = await fetch('/api/state');
    const data = await response.json();
    const { state: s } = data;
    if (s.error) {
      $('status-dot').classList.remove('on');
      $('empty-hint').textContent = s.error;
    } else {
      $('status-dot').classList.add('on');
    }
  } catch {
    $('status-dot').classList.remove('on');
  }
}, 2500);

resize();
connect();
