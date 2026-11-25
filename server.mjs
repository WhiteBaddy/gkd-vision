import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { GkdClient } from './src/gkd.mjs';
import { MockGkd } from './src/mock.mjs';
import { RootDriver } from './src/root.mjs';
import { Vision } from './src/vision.mjs';
import { buildFingerprint, findTextNodes } from './src/fingerprint.mjs';
import { waitFor } from './src/asserts.mjs';
import { toGray, toGrayFromImage, matchTemplate, dHash, SCALE_WIDTH } from './src/vision-match.mjs';
import { diagnoseGating, gatingHint } from './src/gating.mjs';
import { attachWebSocket } from './src/ws.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const FRAMES = join(ROOT, 'frames');

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const raw = argv[i];
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.replace(/^--/, '').split('=');
  if (rest.length) {
    args.set(key, rest.join('='));
    continue;
  }
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, 'true');
  }
}

const PORT = Number(args.get('port') ?? 7777);
const HOST = args.get('host') ?? '127.0.0.1';
const GKD = args.get('gkd') ?? 'http://127.0.0.1:8888';
const A11Y = args.get('a11y') ?? 'http://127.0.0.1:8899';
const DRIVER = (args.get('driver') ?? (args.get('mock') === 'true' ? 'mock' : 'auto')).toLowerCase();
const MOCK = DRIVER === 'mock';
const INTERVAL = Number(args.get('interval') ?? (MOCK ? 700 : 900));

function makeRoot() {
  return new RootDriver({
    stream: args.get('stream') !== 'false',
    fps: Number(args.get('fps') ?? 10),
    bitrate: args.get('bitrate') ?? '3M',
    recordLimit: Number(args.get('record-limit') ?? 180),
    forceStream: args.get('force-stream') === 'true',
  });
}

async function reachableA11y() {
  try {
    const response = await fetch(`${A11Y}/api/ping`, {
      method: 'POST',
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok) return true;
  } catch {
    /* ignore */
  }
  try {
    const token = await readDriverToken();
    const response = await fetch(`${A11Y}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-vision-token': token } : {}) },
      body: '{}',
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function reachable(url) {
  try {
    const response = await fetch(`${url}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let cachedDriverToken = null;
async function readDriverToken(force = false) {
  const explicit = args.get('token');
  if (explicit === 'off') return null;
  if (explicit) return explicit;
  if (process.env.VISION_TOKEN) return process.env.VISION_TOKEN;
  if (!force && cachedDriverToken) return cachedDriverToken;
  try {
    const token = await new Promise((resolve) => {
      execFile(
        'su',
        ['-c', 'cat /data/data/dev.everything.vision/files/vision.token'],
        { timeout: 3000 },
        (error, stdout) => resolve(error ? null : String(stdout).trim() || null),
      );
    });
    if (token) {
      cachedDriverToken = token;
      return token;
    }
  } catch {
    /* fall through */
  }
  return cachedDriverToken;
}

async function hasRoot() {
  return new Promise((resolve) => {
    execFile('su', ['-c', 'id'], { timeout: 3000 }, (error, stdout) => {
      resolve(!error && String(stdout).includes('uid=0'));
    });
  });
}

async function pickDevice() {
  if (DRIVER === 'mock') return new MockGkd();
  if (DRIVER === 'root') return makeRoot();
  if (DRIVER === 'a11y') return new GkdClient(A11Y, { tokenProvider: () => readDriverToken(true) });
  if (DRIVER === 'gkd') return new GkdClient(GKD);
  // auto: a11y → root → gkd
  if (await reachableA11y()) {
    console.log(`[driver] auto → a11y (${A11Y})`);
    return new GkdClient(A11Y, { tokenProvider: () => readDriverToken(true) });
  }
  if (await hasRoot()) {
    console.log('[driver] auto → root');
    return makeRoot();
  }
  if (await reachable(GKD)) {
    console.log(`[driver] auto → gkd (${GKD})`);
    return new GkdClient(GKD);
  }
  throw new Error('没有可用驱动：a11y 不可达、无 root、GKD 未开启');
}

const device = await pickDevice();
const vision = new Vision({ device, interval: INTERVAL, cleanup: true });
const peers = new Set();
let lastTreeAt = 0;

function compactNodes(nodes) {
  return nodes.map((n) => [
    n.id,
    n.pid,
    n.depth,
    n.left,
    n.top,
    n.right,
    n.bottom,
    n.clickable ? 1 : 0,
    n.longClickable ? 1 : 0,
    n.editable ? 1 : 0,
    n.text,
    n.desc,
    n.vid,
    n.viewId,
    n.name,
  ]);
}

function broadcast(payload, binary) {
  for (const peer of peers) {
    try {
      if (binary) peer.sendBinary(binary);
      else peer.sendText(JSON.stringify(payload));
    } catch {
      peers.delete(peer);
    }
  }
}

vision.on((event) => {
  if (event.type === 'frame') {
    const { frame } = event;
    const meta = {
      type: 'frame',
      seq: frame.seq,
      at: frame.at,
      appId: frame.appId,
      appName: frame.appName,
      activityId: frame.activityId,
      screenWidth: frame.screenWidth,
      screenHeight: frame.screenHeight,
      nodeCount: frame.nodes.length,
      imageBytes: frame.image?.length ?? 0,
      mime: frame.mime,
      timings: frame.timings,
    };
    for (const peer of peers) {
      try {
        peer.sendText(JSON.stringify(meta));
        if (frame.image) peer.sendBinary(frame.image);
      } catch {
        peers.delete(peer);
      }
    }
    if (Date.now() - lastTreeAt > 1000) {
      lastTreeAt = Date.now();
      broadcast({ type: 'tree', seq: frame.seq, nodes: compactNodes(frame.nodes) });
    }
  } else if (event.type === 'error') {
    broadcast({ type: 'error', error: event.error });
  } else if (event.type === 'config') {
    broadcast({ type: 'config', config: event.config });
  } else if (event.type === 'warn') {
    broadcast({ type: 'warn', message: event.message });
  }
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

async function readBody(req, limit = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/api/state') {
      return json(res, 200, {
        driver: DRIVER,
        device: DRIVER === 'gkd' ? GKD : DRIVER === 'a11y' ? A11Y : DRIVER,
        state: vision.state,
        fingerprint: vision.frame ? buildFingerprint(vision.frame) : null,
        gating: vision.frame ? diagnoseGating(vision.frame) : null,
        warnings: device.warnings ?? [],
      });
    }

    if (req.method === 'GET' && path === '/api/frame') {
      const frame = vision.frame;
      if (!frame?.image) return json(res, 404, { error: '暂无画面' });
      res.writeHead(200, {
        'content-type': frame.mime,
        'content-length': frame.image.length,
        'cache-control': 'no-store',
        'x-frame-seq': String(frame.seq),
        'x-frame-id': String(frame.id),
      });
      return res.end(Buffer.from(frame.image));
    }

    if (req.method === 'GET' && path === '/api/tree') {
      let frame = vision.frame;
      if (!frame || url.searchParams.get('fresh') === '1') frame = await vision.captureOnce();
      if (!frame) return json(res, 404, { error: '暂无画面' });
      return json(res, 200, { seq: frame.seq, appId: frame.appId, nodes: frame.nodes });
    }

    if (req.method === 'GET' && path === '/api/see') {
      let frame = vision.frame;
      const fresh = url.searchParams.get('fresh') === '1';
      if (!frame || fresh) frame = await vision.captureOnce();
      if (!frame) return json(res, 503, { error: vision.error ?? '还没有画面' });
      let savedPath = null;
      if (url.searchParams.get('save') === '1' && frame.image) {
        const ext =
          frame.mime === 'image/webp'
            ? 'webp'
            : frame.mime === 'image/png'
              ? 'png'
              : frame.mime === 'image/jpeg'
                ? 'jpg'
                : 'bin';
        savedPath = join(FRAMES, `last.${ext}`);
        await writeFile(savedPath, Buffer.from(frame.image));
      }
      return json(res, 200, {
        seq: frame.seq,
        at: frame.at,
        appId: frame.appId,
        appName: frame.appName,
        activityId: frame.activityId,
        screenWidth: frame.screenWidth,
        screenHeight: frame.screenHeight,
        mime: frame.mime,
        savedPath,
        nodes: frame.nodes,
      });
    }

    if (req.method === 'GET' && path === '/api/tree.txt') {
      const frame = vision.frame;
      if (!frame) return json(res, 404, { error: '暂无画面' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(renderTextTree(frame.nodes));
    }

    const frameForVisual = async (fresh = false) => {
      const current = vision.frame;
      if (!fresh && current && Date.now() - current.at < 1200) return current;
      return vision.captureOnce();
    };

    if (req.method === 'POST' && path.startsWith('/api/')) {
      const body = await readBody(req);
      const action = path.slice('/api/'.length);

      if (action === 'tap') {
        const result = await vision.tap(body.x, body.y, { action: body.action ?? 'clickCenter' });
        if (!result.ok) vision.invalidateAnchor();
        return json(res, result.ok ? 200 : 502, result);
      }
      if (action === 'tapbytext' || action === 'tapByText') {
        const needle = String(body.text ?? body.value ?? '').trim();
        if (!needle) return json(res, 400, { error: '缺少 text' });
        const node = findNodeByText(vision.frame?.nodes ?? [], needle);
        if (!node) return json(res, 404, { error: `没有找到文本为「${needle}」的节点` });
        const result = await vision.exec({
          selector: `[text="${String(node.text).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`,
          action: body.action ?? 'click',
        });
        return json(res, 200, { node: { id: node.id, text: node.text, bounds: [node.left, node.top, node.right, node.bottom] }, result });
      }
      if (action === 'longpress' || action === 'longPress') {
        const result = await vision.longPress(body.x, body.y);
        return json(res, result.ok ? 200 : 502, result);
      }
      if (action === 'swipe') {
        const result = await vision.swipe(body.x1, body.y1, body.x2, body.y2, body.duration ?? 300);
        return json(res, result.ok ? 200 : 502, result);
      }
      if (action === 'exec') {
        const result = await vision.exec(body.payload ?? body);
        return json(res, 200, result);
      }
      if (action === 'back') {
        const result = await vision.back();
        return json(res, result.ok ? 200 : 502, result);
      }
      if (action === 'home') {
        if (typeof device.key === 'function') return json(res, 200, await device.key('home'));
        const result = await runAm(['start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
        return json(res, result.ok ? 200 : 500, result);
      }
      if (action === 'key') {
        if (typeof device.key !== 'function') return json(res, 501, { error: '当前驱动不支持按键' });
        return json(res, 200, await device.key(String(body.key ?? 'back')));
      }
      if (action === 'text') {
        if (typeof device.text !== 'function') return json(res, 501, { error: '当前驱动不支持文本输入' });
        return json(res, 200, await device.text(body.text));
      }
      if (action === 'recents') {
        if (typeof device.key !== 'function') return json(res, 501, { error: '当前驱动不支持按键' });
        return json(res, 200, await device.key('recents'));
      }
      if (action === 'config') {
        vision.configure(body);
        return json(res, 200, { config: vision.config });
      }
      if (action === 'fingerprint') {
        const frame = await frameForVisual(body.fresh === true);
        const fingerprint = buildFingerprint(frame);
        fingerprint.gating = diagnoseGating(frame);
        if (body.visual && frame.image?.length) {
          fingerprint.visualHash = await dHash(frame.image);
        }
        return json(res, 200, fingerprint);
      }
      if (action === 'diagnose') {
        const frame = await frameForVisual(body.fresh === true);
        const gating = diagnoseGating(frame);
        return json(res, 200, {
          package: gating.package ?? null,
          gating,
          hint: gatingHint(gating),
          fingerprint: buildFingerprint(frame),
          compat: { command: 'tools/a11y-compat.sh on', revert: 'tools/a11y-compat.sh off' },
        });
      }
      if (action === 'act') {
        const beforeFrame = await vision.captureOnce();
        const before = { frame: beforeFrame, fingerprint: buildFingerprint(beforeFrame), image: beforeFrame.image };
        if (body.expectPackage && before.fingerprint.package !== body.expectPackage) {
          return json(res, 409, {
            ok: false,
            code: 'PAGE_MISMATCH',
            message: `期望页面 ${body.expectPackage}，当前 ${before.fingerprint.package}`,
            fingerprint: before.fingerprint,
          });
        }
        const result = await vision.exec(body.payload ?? {});
        if (!body.expect) {
          return json(res, 200, { ok: true, verified: null, result, fingerprintBefore: before.fingerprint });
        }
        const waited = await waitFor(vision, body.expect, {
          timeoutMs: Number(body.timeoutMs ?? 1500),
          before,
        });
        const after = buildFingerprint(waited.frame);
        return json(res, 200, {
          ok: waited.ok,
          verified: waited.ok,
          elapsedMs: waited.elapsedMs,
          attempts: waited.attempts,
          result,
          fingerprintBefore: before.fingerprint,
          fingerprintAfter: after,
          details: waited.details,
        });
      }
      if (action === 'wait') {
        const frame = await vision.captureOnce();
        const before = { frame, fingerprint: buildFingerprint(frame), image: frame.image };
        const waited = await waitFor(vision, body.expect ?? {}, { timeoutMs: Number(body.timeoutMs ?? 1500), before });
        return json(res, 200, {
          ok: waited.ok,
          elapsedMs: waited.elapsedMs,
          attempts: waited.attempts,
          fingerprint: buildFingerprint(waited.frame),
          details: waited.details,
        });
      }
      if (action === 'tapText') {
        const frame = vision.frame ?? (await vision.captureOnce());
        const exactNodes = findTextNodes(frame.nodes, body.text, { exact: true });
        const loose = findTextNodes(frame.nodes, body.text, { exact: false });
        const nodes = (body.exact ? exactNodes : exactNodes.length ? exactNodes : loose).sort(
          (a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top),
        );
        if (!nodes.length) {
          return json(res, 404, { ok: false, code: 'NODE_NOT_FOUND', message: `未找到文本: ${body.text}` });
        }
        const node = nodes[0];
        const selector = `[text="${String(node.text).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
        try {
          const result = await vision.exec({ selector, action: 'click' });
          return json(res, 200, { ok: result?.result !== false, point: { x: Math.round((node.left + node.right) / 2), y: Math.round((node.top + node.bottom) / 2) }, selector, result });
        } catch {
          const point = { x: Math.round((node.left + node.right) / 2), y: Math.round((node.top + node.bottom) / 2) };
          const result = await vision.tap(point.x, point.y);
          return json(res, result.ok ? 200 : 502, { ok: result.ok, point, selector: null, result });
        }
      }
      if (action === 'find') {
        const started = Date.now();
        const frame = await frameForVisual(body.fresh === true);
        const scale = SCALE_WIDTH / (frame.screenWidth || 1200);
        const screen = await toGray(frame.image, SCALE_WIDTH);
        let tpl;
        if (body.region) {
          const region = body.region;
          const w = Math.max(4, Math.round(Number(region.w) * scale));
          tpl = await toGray(frame.image, w, {
            x: Math.round(Number(region.x)),
            y: Math.round(Number(region.y)),
            w: Math.round(Number(region.w)),
            h: Math.round(Number(region.h)),
          });
        } else if (body.templateBase64) {
          const fullWidth = Math.max(4, Number(body.templateWidth ?? 100));
          tpl = await toGrayFromImage(Buffer.from(String(body.templateBase64), 'base64'), Math.max(4, Math.round(fullWidth * scale)));
        } else {
          return json(res, 400, { ok: false, code: 'TEMPLATE_INVALID', message: '需要 region 或 templateBase64' });
        }
        const m = matchTemplate(screen, tpl, { threshold: Number(body.threshold ?? 0.9) });
        return json(res, 200, {
          found: m.found,
          x: m.x != null ? Math.round(m.x / scale) : null,
          y: m.y != null ? Math.round(m.y / scale) : null,
          score: Number((m.score ?? 0).toFixed(4)),
          reason: m.reason ?? null,
          template: { width: tpl.width, height: tpl.height },
          elapsedMs: Date.now() - started,
        });
      }
      if (action === 'tapImage') {
        const frame = await frameForVisual(body.fresh === true);
        const scale = SCALE_WIDTH / (frame.screenWidth || 1200);
        const screen = await toGray(frame.image, SCALE_WIDTH);
        let tpl;
        if (body.region) {
          const region = body.region;
          tpl = await toGray(frame.image, Math.max(4, Math.round(Number(region.w) * scale)), {
            x: Math.round(Number(region.x)),
            y: Math.round(Number(region.y)),
            w: Math.round(Number(region.w)),
            h: Math.round(Number(region.h)),
          });
        } else if (body.templateBase64) {
          tpl = await toGrayFromImage(Buffer.from(String(body.templateBase64), 'base64'), Math.max(4, Math.round(Number(body.templateWidth ?? 100) * scale)));
        } else {
          return json(res, 400, { ok: false, code: 'TEMPLATE_INVALID', message: '需要 region 或 templateBase64' });
        }
        const m = matchTemplate(screen, tpl, { threshold: Number(body.threshold ?? 0.9) });
        if (!m.found) {
          return json(res, 404, { ok: false, code: 'TEMPLATE_NOT_FOUND', message: '未找到模板', score: m.score, fingerprint: buildFingerprint(frame) });
        }
        const point = { x: Math.round(m.x / scale), y: Math.round(m.y / scale) };
        const tapped = await vision.tap(point.x, point.y);
        return json(res, tapped.ok ? 200 : 502, { ok: tapped.ok, point, score: Number(m.score.toFixed(4)), result: tapped });
      }
      if (action === 'capture') {
        const frame = await vision.captureOnce();
        return json(res, 200, {
          seq: frame.seq,
          appId: frame.appId,
          screenWidth: frame.screenWidth,
          screenHeight: frame.screenHeight,
          nodeCount: frame.nodes.length,
        });
      }
      return json(res, 404, { error: `未知接口 /api/${action}` });
    }

    if (path.startsWith('/frames/')) {
      const rel = path.slice('/frames/'.length);
      const file = join(FRAMES, normalize(rel));
      if (!file.startsWith(FRAMES)) return json(res, 400, { error: 'bad path' });
      try {
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(data);
      } catch {
        return json(res, 404, { error: 'not found' });
      }
    }

    if (req.method === 'GET' && (await serveStatic(res, path))) return;

    json(res, 404, { error: 'not found' });
  } catch (error) {
    json(res, 500, { error: error.message, code: error.code ?? null });
  }
});

function runAm(argv) {
  return new Promise((resolve) => {
    execFile('am', argv, { timeout: 8000 }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, error: stderr?.trim() || error.message });
      else resolve({ ok: true, output: stdout.trim() });
    });
  });
}

attachWebSocket(server, {
  path: '/ws',
  onConnection(peer) {
    peers.add(peer);
    peer.on('close', () => peers.delete(peer));
    peer.sendText(JSON.stringify({ type: 'hello', mock: MOCK, config: vision.config, state: vision.state }));
    peer.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      void handleClientMessage(peer, message);
    });
  },
});

async function handleClientMessage(peer, message) {
  try {
    if (message.type === 'config') {
      vision.configure(message.config ?? message);
      return;
    }
    if (message.type === 'tap') {
      const result = await vision.tap(message.x, message.y, { action: message.action });
      peer.sendText(JSON.stringify({ type: 'action', kind: 'tap', ...result }));
      return;
    }
    if (message.type === 'longpress') {
      const result = await vision.longPress(message.x, message.y);
      peer.sendText(JSON.stringify({ type: 'action', kind: 'longpress', ...result }));
      return;
    }
    if (message.type === 'swipe') {
      const result = await vision.swipe(message.x1, message.y1, message.x2, message.y2, message.duration);
      peer.sendText(JSON.stringify({ type: 'action', kind: 'swipe', ...result }));
      return;
    }
    if (message.type === 'exec') {
      const result = await vision.exec(message.payload ?? {});
      peer.sendText(JSON.stringify({ type: 'action', kind: 'exec', result }));
      return;
    }
    if (message.type === 'back') {
      const result = await vision.back();
      peer.sendText(JSON.stringify({ type: 'action', kind: 'back', ...result }));
      return;
    }
    if (message.type === 'key') {
      if (typeof device.key !== 'function') throw new Error('当前驱动不支持按键');
      peer.sendText(JSON.stringify({ type: 'action', kind: 'key', ...(await device.key(String(message.key ?? 'back'))) }));
      return;
    }
    if (message.type === 'text') {
      if (typeof device.text !== 'function') throw new Error('当前驱动不支持文本输入');
      peer.sendText(JSON.stringify({ type: 'action', kind: 'text', ...(await device.text(message.text)) }));
      return;
    }
    if (message.type === 'home') {
      const result = await runAm(['start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
      peer.sendText(JSON.stringify({ type: 'action', kind: 'home', ...result }));
      return;
    }
    if (message.type === 'tree') {
      const frame = vision.frame;
      peer.sendText(JSON.stringify({ type: 'tree', seq: frame?.seq ?? 0, nodes: compactNodes(frame?.nodes ?? []) }));
    }
  } catch (error) {
    peer.sendText(JSON.stringify({ type: 'error', error: error.message, code: error.code ?? null }));
  }
}

function findNodeByText(nodes, needle) {
  const exact = nodes.find((n) => n.text === needle);
  if (exact) return exact;
  const lower = needle.toLowerCase();
  return (
    nodes.find((n) => n.text.toLowerCase() === lower) ??
    nodes.find((n) => n.text.toLowerCase().includes(lower) || n.desc.toLowerCase().includes(lower)) ??
    null
  );
}

function renderTextTree(nodes) {
  const lines = [];
  for (const n of nodes) {
    const w = n.right - n.left;
    const h = n.bottom - n.top;
    if (w <= 0 || h <= 0) continue;
    const flags = [n.clickable ? 'clickable' : '', n.longClickable ? 'long' : '', n.editable ? 'editable' : '']
      .filter(Boolean)
      .join(',');
    const label = [n.text, n.desc ? `desc=${n.desc}` : '', n.vid ? `#${n.vid}` : '', n.viewId ? `id=${n.viewId}` : '']
      .filter(Boolean)
      .join(' ');
    lines.push(
      `${'  '.repeat(Math.min(n.depth, 24))}${String(n.name || '?').replace(/^android\.(widget|view)\./, '')}` +
        `${label ? ` "${label}"` : ''} [${n.left},${n.top},${n.right},${n.bottom}]${flags ? ` {${flags}}` : ''}`,
    );
  }
  return lines.join('\n');
}

await mkdir(FRAMES, { recursive: true });
server.listen(PORT, HOST, () => {
  const label =
    DRIVER === 'mock'
      ? 'mock device'
      : DRIVER === 'root'
        ? 'root (screenrecord+ffmpeg | input)'
        : DRIVER === 'a11y'
          ? `a11y @ ${A11Y}`
          : DRIVER === 'gkd'
            ? `GKD @ ${GKD}`
            : 'auto';
  console.log(`gkd-vision listening on http://${HOST}:${PORT}  (${label})`);
  console.log(`  live UI   http://${HOST}:${PORT}/`);
  console.log(`  see       curl -s "http://${HOST}:${PORT}/api/see?save=1"`);
  console.log(`  tap       curl -s -XPOST http://${HOST}:${PORT}/api/tap -d '{"x":540,"y":800}'`);
  vision.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[${signal}] 正在停止…`);
    vision.stop();
    Promise.resolve(device.stop?.())
      .catch(() => {})
      .finally(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1200).unref?.();
      });
  });
}
