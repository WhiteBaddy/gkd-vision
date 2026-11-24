/**
 * Headless smoke test for public/app.js: stubs just enough DOM/browser API to
 * execute the real UI code, then replays the WS protocol and a few interactions.
 * Catches reference errors, bad message handling and render-time crashes.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const errors = [];

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    names.forEach((n) => this.set.add(n));
  }
  remove(...names) {
    names.forEach((n) => this.set.delete(n));
  }
  toggle(name, force) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name) {
    return this.set.has(name);
  }
}

class El {
  constructor(id = '') {
    this.id = id;
    this.classList = new ClassList();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.value = '';
    this.checked = true;
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = {};
  }
  get lastChild() {
    return this.children[this.children.length - 1];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener() {}
  append(...nodes) {
    this.children.push(...nodes);
  }
  prepend(node) {
    this.children.unshift(node);
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  remove() {}
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

const elements = new Map(ids.map((id) => [id, new El(id)]));
const tabs = ['tree', 'selector', 'log'].map((name) => {
  const el = new El();
  el.dataset.tab = name;
  return el;
});
const modes = ['inspect', 'tap', 'longpress', 'swipe'].map((mode) => {
  const el = new El();
  el.dataset.mode = mode;
  return el;
});

const ctx = new Proxy(
  {
    canvas: {},
    setLineDash() {},
  },
  {
    get(target, key) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  },
);

const canvasEl = elements.get('screen');
canvasEl.getContext = () => ctx;
canvasEl.width = 0;
canvasEl.height = 0;

const document = {
  getElementById: (id) => elements.get(id) ?? new El(id),
  querySelectorAll: (selector) =>
    selector === '.tab' ? tabs : selector === '.panel' ? [] : selector === '.mode' ? modes : [],
  createElement: () => new El(),
  createDocumentFragment: () => new El(),
  body: new El(),
};

const frames = [];
const sockets = [];

class FakeWebSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.binaryType = 'arraybuffer';
    sockets.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data) {
    frames.push(JSON.parse(data));
  }
  close() {}
}

let bitmapCount = 0;
const sandbox = {
  document,
  window: { devicePixelRatio: 2, addEventListener() {} },
  location: { protocol: 'http:', host: '127.0.0.1:7777' },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  console,
  fetch: async () => ({ json: async () => ({ state: { error: null } }) }),
  WebSocket: FakeWebSocket,
  Blob: class {},
  createImageBitmap: async () => {
    bitmapCount += 1;
    return { close() {}, width: 1200, height: 2608 };
  },
  Uint8Array,
  Math,
  Date,
  JSON,
  Number,
  String,
  Array,
  Object,
  Error,
  isFinite,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
try {
  new vm.Script(source, { filename: 'public/app.js' }).runInContext(sandbox);
} catch (error) {
  errors.push(`top-level: ${error.stack}`);
}

await new Promise((r) => setTimeout(r, 20));
const ws = sockets[0];
if (!ws) errors.push('WebSocket 未被创建');

const send = (msg) => {
  try {
    ws.onmessage({ data: JSON.stringify(msg) });
  } catch (error) {
    errors.push(`${msg.type}: ${error.stack}`);
  }
};

send({ type: 'hello', mock: false, config: { interval: 800, cleanup: true, paused: false } });
send({
  type: 'frame',
  seq: 1,
  appId: 'com.demo',
  appName: '演示',
  activityId: 'com.demo.Main',
  screenWidth: 1200,
  screenHeight: 2608,
  nodeCount: 3,
  imageBytes: 50000,
  mime: 'image/jpeg',
  timings: { capture: 10, image: 2 },
});
try {
  ws.onmessage({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer });
} catch (error) {
  errors.push(`binary: ${error.stack}`);
}
send({
  type: 'tree',
  seq: 1,
  nodes: [
    [0, -1, 0, 0, 0, 1200, 2608, 0, 0, 0, '', '', '', 'com.demo:id/root', 'FrameLayout'],
    [1, 0, 1, 48, 200, 1152, 320, 1, 1, 0, '确定', '', 'ok', 'com.demo:id/ok', 'Button'],
    [2, 0, 1, 48, 400, 1152, 520, 0, 0, 1, '', '搜索', 'search', 'com.demo:id/search', 'EditText'],
  ],
});
send({ type: 'action', kind: 'tap', ok: true, point: { x: 600, y: 260 }, anchor: '[depth=0]' });
send({ type: 'error', error: 'SNAPSHOT_NOT_FOUND' });
send({ type: 'warn', message: '截图获取失败' });
send({ type: 'config', config: { interval: 500, cleanup: false, paused: false } });

await new Promise((r) => setTimeout(r, 60));

// interactions
try {
  for (const tab of tabs) tab.onclick?.();
  for (const mode of modes) mode.onclick?.();
  elements.get('chk-overlay').onchange?.();
  elements.get('sel-interval').onchange?.();
  elements.get('tree-search').oninput?.({ target: { value: '确定' } });
  await elements.get('btn-exec').onclick?.();
  await canvasEl.dispatch('pointerdown', { clientX: 100, clientY: 100, button: 0, buttons: 1, shiftKey: false, pointerId: 1 });
  await canvasEl.dispatch('pointermove', { clientX: 120, clientY: 140, buttons: 1 });
  await canvasEl.dispatch('pointerup', { clientX: 120, clientY: 140 });
  canvasEl.dispatch('wheel', { clientX: 100, clientY: 100, deltaY: -120, preventDefault() {} });
  elements.get('btn-fit').onclick?.();
  elements.get('btn-zoom-in').onclick?.();
  elements.get('btn-pause').onclick?.();
  elements.get('btn-back').onclick?.();
  elements.get('btn-home').onclick?.();
} catch (error) {
  errors.push(`interaction: ${error.stack}`);
}

await new Promise((r) => setTimeout(r, 60));

console.log(JSON.stringify({ elements: elements.size, sent: frames.length, bitmaps: bitmapCount, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
