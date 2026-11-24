import { sniffImage } from './gkd.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function attrOf(node) {
  return node?.attr ?? {};
}

/** Normalize the GKD snapshot node shape (both old `isClickable` and new `clickable` builds). */
export function normalizeNode(node) {
  const a = attrOf(node);
  return {
    id: node.id,
    pid: node.pid,
    name: a.name ?? a.className ?? '',
    text: a.text ?? '',
    desc: a.desc ?? '',
    vid: a.vid ?? '',
    viewId: a.id ?? '',
    clickable: Boolean(a.clickable ?? a.isClickable),
    longClickable: Boolean(a.longClickable ?? a.isLongClickable),
    editable: Boolean(a.editable),
    visible: Boolean(a.visibleToUser ?? true),
    left: a.left ?? 0,
    top: a.top ?? 0,
    right: a.right ?? 0,
    bottom: a.bottom ?? 0,
    depth: a.depth ?? 0,
    index: a.index ?? 0,
    childCount: a.childCount ?? 0,
  };
}

/** Deepest visible node that contains the point, preferring clickable/editable targets. */
export function nodeAt(nodes, x, y) {
  let best = null;
  for (const node of nodes) {
    const w = node.right - node.left;
    const h = node.bottom - node.top;
    if (w <= 0 || h <= 0) continue;
    if (x < node.left || x >= node.right || y < node.top || y >= node.bottom) continue;
    const interactive = node.clickable || node.longClickable || node.editable;
    const score = node.depth * 10 + (interactive ? 5 : 0) + Math.min(9, Math.floor(10_000 / (w * h + 1)));
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node ?? null;
}

const quote = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/** Candidate selectors used to anchor a raw-coordinate gesture (position is absolute, so the node is irrelevant). */
export function selectorCandidates(node) {
  // `[depth=0]` is the window root; `position.x/y` are absolute screen
  // coordinates, so any matched node works as the gesture anchor.
  const out = ['[depth=0]'];
  if (node) {
    if (node.vid) out.push(`[vid="${quote(node.vid)}"]`);
    if (node.text) out.push(`[text="${quote(node.text)}"]`);
    if (node.desc) out.push(`[desc="${quote(node.desc)}"]`);
  }
  out.push('[visibleToUser=true]', '[clickable=true]');
  return out;
}

/**
 * Frame pipeline: captureSnapshot (nodes + screenshot) from GKD, keep the latest
 * frame in memory, hand it to subscribers and reuse a working anchor selector.
 */
export class Vision {
  constructor({ device, interval = 800, cleanup = true, saveHistory = false } = {}) {
    this.device = device;
    this.interval = interval;
    this.cleanup = cleanup;
    this.saveHistory = saveHistory;
    this.paused = false;
    this.running = false;
    this.busy = false;
    this.frame = null;
    this.error = null;
    this.errorCount = 0;
    this.seq = 0;
    this.fps = 0;
    this.lastCost = null;
    this.anchorSelector = null;
    this.listeners = new Set();
    this.startedAt = Date.now();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        /* a broken listener must not kill the loop */
      }
    }
  }

  start() {
    if (this.running) return this;
    this.running = true;
    if (this.device.mode === 'stream') {
      this.lastTime = 0;
      this.device.onFrame?.((frame) => this.#accept(frame));
      void this.device.startStream?.();
      return this;
    }
    void this.#loop();
    return this;
  }

  stop() {
    this.running = false;
  }

  configure(patch = {}) {
    if (Number.isFinite(patch.interval)) this.interval = Math.max(250, Math.min(10_000, patch.interval));
    if (typeof patch.cleanup === 'boolean') this.cleanup = patch.cleanup;
    if (typeof patch.paused === 'boolean') this.paused = patch.paused;
    this.#emit({ type: 'config', config: this.config });
  }

  get config() {
    return {
      interval: this.interval,
      cleanup: this.cleanup,
      paused: this.paused,
      saveHistory: this.saveHistory,
    };
  }

  get state() {
    const frame = this.frame;
    return {
      seq: this.seq,
      fps: Number(this.fps.toFixed(2)),
      running: this.running,
      busy: this.busy,
      error: this.error,
      errorCount: this.errorCount,
      uptimeMs: Date.now() - this.startedAt,
      engine: {
        mode: this.device.mode ?? 'poll',
        streaming: typeof this.device.startStream === 'function',
        degraded: Boolean(this.device.degraded),
        restartCount: this.device.restartCount ?? 0,
        fallbackReason: this.device.fallbackReason ?? null,
        directInput: typeof this.device.tapPoint === 'function',
      },
      cost: this.lastCost,
      frame: frame
        ? {
            seq: frame.seq,
            at: frame.at,
            id: frame.id,
            appId: frame.appId,
            appName: frame.appName,
            activityId: frame.activityId,
            screenWidth: frame.screenWidth,
            screenHeight: frame.screenHeight,
            nodeCount: frame.nodes.length,
            imageBytes: frame.image?.length ?? 0,
            mime: frame.mime,
          }
        : null,
      config: this.config,
    };
  }

  /** Accept a frame produced by a streaming device. */
  #accept(frame) {
    const now = Date.now();
    if (this.lastTime) {
      const dt = now - this.lastTime;
      const instant = 1000 / Math.max(dt, 1);
      this.fps = this.fps ? this.fps * 0.8 + instant * 0.2 : instant;
    }
    this.lastTime = now;
    this.seq = frame.seq;
    this.frame = frame;
    this.lastCost = frame.timings ?? null;
    this.error = null;
    this.#emit({ type: 'frame', frame });
  }

  async #loop() {
    let lastAt = 0;
    while (this.running) {
      if (this.paused) {
        await sleep(200);
        continue;
      }
      if (this.busy) {
        await sleep(50);
        continue;
      }
      const started = Date.now();
      try {
        await this.#step();
        this.error = null;
      } catch (error) {
        this.errorCount += 1;
        this.error = error.code ? `${error.code}: ${error.message}` : String(error.message ?? error);
        this.#emit({ type: 'error', error: this.error });
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(40, this.interval - elapsed);
      await sleep(this.error ? Math.max(wait, 1200) : wait);
    }
  }

  async #step() {
    this.busy = true;
    const cost = { capture: 0, image: 0, cleanup: 0, total: 0 };
    const t0 = Date.now();
    try {
      const snapshot = await this.device.captureSnapshot();
      cost.capture = Date.now() - t0;
      if (!snapshot?.id) throw new Error('captureSnapshot 未返回快照');

      const nodes = (snapshot.nodes ?? []).map(normalizeNode);
      const t1 = Date.now();
      let image = null;
      let mime = 'application/octet-stream';
      try {
        const bytes = await this.device.getScreenshot(snapshot.id);
        image = bytes;
        mime = sniffImage(bytes);
      } catch (error) {
        this.#emit({ type: 'warn', message: `截图获取失败: ${error.message}` });
      }
      cost.image = Date.now() - t1;

      const frame = {
        seq: this.seq + 1,
        at: Date.now(),
        id: snapshot.id,
        appId: snapshot.appId ?? '',
        appName: snapshot.appInfo?.name ?? snapshot.appId ?? '',
        activityId: snapshot.activityId ?? '',
        screenWidth: snapshot.screenWidth ?? 0,
        screenHeight: snapshot.screenHeight ?? 0,
        isLandscape: Boolean(snapshot.isLandscape),
        nodes,
        image,
        mime,
        timings: cost,
      };
      cost.total = Date.now() - t0;
      frame.timings = cost;
      this.#accept(frame);

      if (this.cleanup && !this.saveHistory) {
        const t2 = Date.now();
        try {
          await this.device.deleteSnapshot(snapshot.id);
        } catch {
          /* keep the loop alive; stale snapshots are only disk noise */
        }
        cost.cleanup = Date.now() - t2;
      }
    } finally {
      this.busy = false;
    }
  }

  /** Capture one frame on demand (used by the "see" API when the loop is paused). */
  async captureOnce() {
    if (typeof this.device.captureOnce === 'function') {
      const frame = await this.device.captureOnce();
      this.#accept(frame);
      return this.frame;
    }
    await this.#step();
    return this.frame;
  }

  async #anchor(node) {
    if (this.anchorSelector !== null) return this.anchorSelector;
    for (const candidate of selectorCandidates(node)) {
      try {
        const result = await this.device.execSelector({ selector: candidate, action: 'none' });
        if (result && typeof result.result === 'boolean') {
          this.anchorSelector = candidate;
          return candidate;
        }
      } catch {
        /* try the next candidate */
      }
    }
    throw new Error('找不到可用的锚点选择器 (selector 锚定失败)');
  }

  invalidateAnchor() {
    this.anchorSelector = null;
  }

  async tap(x, y, { action = 'clickCenter' } = {}) {
    const point = this.#point(x, y);
    if (typeof this.device.tapPoint === 'function') {
      const result = action.startsWith('long')
        ? await this.device.longPressPoint(point.x, point.y)
        : await this.device.tapPoint(point.x, point.y);
      return { ...result, point };
    }
    const node = nodeAt(this.frame?.nodes ?? [], point.x, point.y);
    const anchor = await this.#anchor(node);
    const result = await this.device.execSelector({
      selector: anchor,
      action,
      position: { x: String(point.x), y: String(point.y) },
    });
    return { ok: Boolean(result?.result), action, point, anchor, result };
  }

  async longPress(x, y) {
    return this.tap(x, y, { action: 'longClickCenter' });
  }

  async swipe(x1, y1, x2, y2, duration = 300) {
    const start = this.#point(x1, y1);
    const end = this.#point(x2, y2);
    if (typeof this.device.swipePoints === 'function') {
      const result = await this.device.swipePoints(start.x, start.y, end.x, end.y, duration);
      return { ...result, start, end };
    }
    const node = nodeAt(this.frame?.nodes ?? [], start.x, start.y);
    const anchor = await this.#anchor(node);
    const result = await this.device.execSelector({
      selector: anchor,
      action: 'swipe',
      swipeArg: {
        start: { x: String(start.x), y: String(start.y) },
        end: { x: String(end.x), y: String(end.y) },
        duration: Math.max(20, Math.round(duration)),
      },
    });
    return { ok: Boolean(result?.result), start, end, duration, anchor, result };
  }

  async exec(payload) {
    const result = await this.device.execSelector(payload);
    return result;
  }

  async back() {
    if (typeof this.device.key === 'function') return this.device.key('back');
    const anchor = await this.#anchor(nodeAt(this.frame?.nodes ?? [], 0, 0));
    const result = await this.device.execSelector({ selector: anchor, action: 'back' });
    return { ok: Boolean(result?.result), result };
  }

  #point(x, y) {
    const width = this.frame?.screenWidth || 0;
    const height = this.frame?.screenHeight || 0;
    const px = Math.round(Number(x));
    const py = Math.round(Number(y));
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('坐标非法');
    if (width > 0 && (px < 0 || px > width)) throw new Error(`x 超出屏幕范围 0..${width}`);
    if (height > 0 && (py < 0 || py > height)) throw new Error(`y 超出屏幕范围 0..${height}`);
    return { x: px, y: py };
  }
}
