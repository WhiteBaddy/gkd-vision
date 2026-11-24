import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYCODES = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  recents: 'KEYCODE_APP_SWITCH',
  enter: 'KEYCODE_ENTER',
  delete: 'KEYCODE_DEL',
  power: 'KEYCODE_POWER',
  wakeup: 'KEYCODE_WAKEUP',
  sleep: 'KEYCODE_SLEEP',
  volumeUp: 'KEYCODE_VOLUME_UP',
  volumeDown: 'KEYCODE_VOLUME_DOWN',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function run(cmd, { timeout = 15000, maxBytes = 1 << 26 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('su', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`su 命令超时: ${cmd}`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill('SIGKILL');
        reject(new Error(`su 命令输出过大: ${cmd}`));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(stderr.trim() || `${cmd} 退出码 ${code}`));
    });
  });
}

/**
 * Root driver.
 *
 * Frames: `su -c screenrecord | ffmpeg` (H.264 → JPEG), throttled in Node.
 * Input:  `input tap|swipe|text|keyevent`.
 *
 * Safety invariants (a fork storm once got the whole Termux session killed by
 * Android's phantom-process killer):
 *   1. at most one screenrecord + one ffmpeg alive at any time (single-flight);
 *   2. one scheduled restart at a time, with exponential backoff;
 *   3. 5 restarts inside 20s stop the stream for good and fall back to screencap;
 *   4. no stream at all when MemAvailable < 1.5GB.
 */
export class RootDriver {
  constructor({ stream = true, fps = 10, bitrate = '3M', streamScale = 2, recordLimit = 180, forceStream = false } = {}) {
    this.mode = 'stream';
    this.stream = stream;
    this.fps = fps;
    this.bitrate = bitrate;
    this.streamScale = streamScale;
    this.recordLimit = Math.max(4, Math.min(180, Number(recordLimit) || 180));
    this.forceStream = Boolean(forceStream);

    this.width = 0;
    this.height = 0;
    this.streamWidth = 0;
    this.streamHeight = 0;

    this.seq = 0;
    this.listeners = new Set();
    // Fixed name: a new run must be able to clean up a recorder left by a crashed run.
    this.pidFile = join(tmpdir(), 'gkd-vision-screenrecord.pid');
    this.pipeline = null;
    this.generation = 0;
    this.restartTimer = null;
    this.restarts = [];
    this.restartCount = 0;
    this.janitor = null;
    this.fallbackTimer = null;
    this.busyFallback = false;
    this.lastFrameAt = 0;
    this.stopped = false;
    this.streaming = false;
    this.degraded = false;
    this.fallbackReason = null;
    this.warnings = [];
    this.focus = { appId: '', activityId: '' };

    this.framesThisSecond = 0;
    this.actualFps = 0;
    this.lastTime = 0;

    this.#focusTimer();
    process.once('exit', () => this.#killPipeline());
  }

  onFrame(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async probe() {
    const sizeOut = (await run('wm size')).toString();
    const physical = sizeOut.match(/Physical size:\s*(\d+)x(\d+)/);
    const override = sizeOut.match(/Override size:\s*(\d+)x(\d+)/);
    const [, w, h] = override ?? physical ?? [];
    this.width = Number(w) || 0;
    this.height = Number(h) || 0;
    const scale = Math.max(1, this.streamScale);
    this.streamWidth = Math.round(this.width / scale / 2) * 2;
    this.streamHeight = Math.round(this.height / scale / 2) * 2;
    return { width: this.width, height: this.height, streamWidth: this.streamWidth, streamHeight: this.streamHeight };
  }

  async startStream() {
    if (!this.width) await this.probe();
    if (!this.stream) {
      this.degraded = true;
      return { streaming: false, reason: 'disabled' };
    }
    const freeMb = await this.#memAvailableMb();
    if (!this.forceStream && freeMb !== null && freeMb < 1500) {
      this.#warn(`可用内存仅 ${freeMb}MB，跳过实时流，降级为 screencap（--force-stream 可强制）`);
      this.#startFallback('low-memory');
      return { streaming: false, reason: 'low-memory', freeMb };
    }
    this.#killScreenrecord(); // no stale recorder from a previous run
    this.streaming = true;
    this.#pipeline();
    return { streaming: true, freeMb };
  }

  async stop() {
    this.stopped = true;
    this.streaming = false;
    clearInterval(this.janitor);
    clearInterval(this.fallbackTimer);
    clearTimeout(this.restartTimer);
    this.janitor = null;
    this.fallbackTimer = null;
    this.restartTimer = null;
    this.#killPipeline();
  }

  async #memAvailableMb() {
    try {
      const text = await readFile('/proc/meminfo', 'utf8');
      const match = text.match(/MemAvailable:\s+(\d+) kB/);
      return match ? Math.round(Number(match[1]) / 1024) : null;
    } catch {
      return null;
    }
  }

  #warn(message) {
    this.warnings.push({ at: Date.now(), message });
    if (this.warnings.length > 50) this.warnings.shift();
    this.lastStreamError = message;
  }

  /* ------------------------------ lifecycle ------------------------------ */

  #killPipeline() {
    const pipeline = this.pipeline;
    this.pipeline = null;
    // Any close/error from the old pipeline must not schedule another restart.
    this.generation += 1;
    for (const child of [pipeline?.ff, pipeline?.record]) {
      if (!child?.pid) continue;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    this.#killScreenrecord();
  }

  /** screenrecord runs as root inside su's session, so the pid file is the only handle. */
  #killScreenrecord() {
    let pid = 0;
    try {
      pid = Number(readFileSync(this.pidFile, 'utf8').trim());
    } catch {
      return;
    }
    void unlink(this.pidFile).catch(() => {});
    if (!Number.isInteger(pid) || pid <= 1) return;
    try {
      spawn('su', ['-c', `kill -9 ${pid} 2>/dev/null`], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* best effort */
    }
  }

  #scheduleRestart(reason) {
    if (this.stopped || this.restartTimer || !this.streaming) return;
    this.#killPipeline();
    const now = Date.now();
    this.restartCount += 1;
    this.restarts = this.restarts.filter((t) => now - t < 20000);
    this.restarts.push(now);
    if (this.restarts.length >= 5) {
      this.streaming = false;
      this.degraded = true;
      this.#warn(`实时流 20s 内重启 ${this.restarts.length} 次（${reason}），已停止并降级为 screencap`);
      this.#startFallback('restart-storm');
      return;
    }
    const delay = Math.min(400 * 2 ** (this.restarts.length - 1), 6000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped && this.streaming) this.#pipeline();
    }, delay);
    this.restartTimer.unref?.();
  }

  /** Slow-but-safe fallback: one screencap every ~1.2s while the stream is down. */
  #startFallback(reason) {
    if (this.fallbackTimer) return;
    this.degraded = true;
    this.fallbackReason = reason;
    this.fallbackTimer = setInterval(() => void this.#fallbackTick(), 1200);
    this.fallbackTimer.unref?.();
  }

  async #fallbackTick() {
    if (this.stopped || this.streaming || this.busyFallback) return;
    this.busyFallback = true;
    try {
      const frame = await this.captureOnce();
      this.#publish(frame);
    } catch (error) {
      this.lastStreamError = error.message;
    } finally {
      this.busyFallback = false;
    }
  }

  /* -------------------------------- frames ------------------------------- */

  #pipeline() {
    if (this.stopped || !this.streaming || this.pipeline || this.restartTimer) return;
    const size = `${this.streamWidth}x${this.streamHeight}`;
    const gen = ++this.generation;
    const command =
      process.env.GKD_VISION_SIMULATE_STREAM_FAIL === '1'
        ? 'exit 1'
        : `echo $$ > '${this.pidFile}'; exec screenrecord --output-format=h264 --time-limit ${this.recordLimit} --size ${size} --bit-rate ${this.bitrate} -`;

    const record = spawn('su', ['-c', command], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const ff = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', 'pipe:0', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '13', '-'],
      { detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.pipeline = { gen, record, ff };
    record.stdout.pipe(ff.stdin);
    record.stderr.on('data', (chunk) => {
      this.lastStreamError = chunk.toString().trim().slice(0, 200);
    });
    ff.stderr.on('data', () => {});
    ff.stdin.on('error', () => {});
    ff.stdout.on('error', () => {});
    record.stdout.on('error', () => {});

    let buffer = Buffer.alloc(0);
    let lastEmit = 0;
    const minGap = Math.max(1, Math.floor(1000 / Math.max(1, this.fps)));

    ff.stdout.on('data', (chunk) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      if (buffer.length > 12 << 20) buffer = Buffer.alloc(0);
      for (;;) {
        const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
          buffer = Buffer.alloc(0);
          return;
        }
        const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) {
          buffer = buffer.subarray(start);
          return;
        }
        const jpeg = buffer.subarray(start, end + 2);
        buffer = buffer.subarray(end + 2);
        const now = Date.now();
        if (now - lastEmit < minGap) continue;
        lastEmit = now;
        this.#emit(jpeg);
      }
    });

    const down = (reason) => {
      if (gen !== this.generation) return; // stale pipeline
      this.#scheduleRestart(reason);
    };
    record.on('close', (code) => down(`record-close:${code}`));
    record.on('error', () => down('record-error'));
    ff.on('close', (code) => down(`ffmpeg-close:${code}`));
    ff.on('error', () => down('ffmpeg-error'));

    clearInterval(this.janitor);
    this.janitor = setInterval(() => {
      if (this.stopped || !this.streaming) return;
      if (Date.now() - this.lastFrameAt > 6000) {
        this.#scheduleRestart('no-frame-6s');
      }
    }, 3000);
    this.janitor.unref?.();
  }

  #emit(jpeg) {
    this.seq += 1;
    this.#publish({
      seq: this.seq,
      at: Date.now(),
      id: this.seq,
      appId: this.focus.appId,
      appName: this.focus.appId,
      activityId: this.focus.activityId,
      screenWidth: this.width,
      screenHeight: this.height,
      isLandscape: this.width > this.height,
      nodes: [],
      image: jpeg,
      mime: 'image/jpeg',
      timings: { capture: 0, image: 0, cleanup: 0, total: 0 },
    });
  }

  #publish(frame) {
    this.lastFrameAt = Date.now();
    this.#tickFps(this.lastFrameAt);
    for (const fn of this.listeners) {
      try {
        fn(frame);
      } catch {
        /* a broken listener must not kill the stream */
      }
    }
    if (this.seq % 30 === 0) void this.#refreshFocus();
  }

  #tickFps(now) {
    if (!this.lastTime) {
      this.lastTime = now;
      return;
    }
    this.framesThisSecond += 1;
    const span = now - this.lastTime;
    if (span >= 1000) {
      this.actualFps = (this.framesThisSecond * 1000) / span;
      this.framesThisSecond = 0;
      this.lastTime = now;
    }
  }

  async #refreshFocus() {
    try {
      const out = (await run("dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp'", { timeout: 4000 })).toString();
      const focus = out.match(/mCurrentFocus=Window\{\S+\s+\S+\s+([^\s/]+)\/(\S+?)\}/);
      if (focus) this.focus = { appId: focus[1], activityId: `${focus[1]}/${focus[2]}` };
    } catch {
      /* keep previous */
    }
  }

  #focusTimer() {
    const timer = setInterval(() => void this.#refreshFocus(), 2500);
    timer.unref?.();
  }

  /** One-shot capture (fallback path, or /api/see?fresh=1). */
  async captureOnce() {
    const t0 = Date.now();
    const png = await run('screencap -p', { timeout: 20000 });
    if (!this.width) await this.probe();
    this.seq += 1;
    return {
      seq: this.seq,
      at: Date.now(),
      id: this.seq,
      appId: this.focus.appId,
      appName: this.focus.appId,
      activityId: this.focus.activityId,
      screenWidth: this.width,
      screenHeight: this.height,
      isLandscape: this.width > this.height,
      nodes: [],
      image: png,
      mime: 'image/png',
      timings: { capture: Date.now() - t0, image: 0, cleanup: 0, total: Date.now() - t0 },
    };
  }

  /* -------------------------------- input -------------------------------- */

  async tapPoint(x, y) {
    const started = Date.now();
    await run(`input tap ${Math.round(x)} ${Math.round(y)}`, { timeout: 8000 });
    return { ok: true, action: 'tap', point: { x: Math.round(x), y: Math.round(y) }, ms: Date.now() - started };
  }

  async longPressPoint(x, y, ms = 600) {
    const started = Date.now();
    await run(`input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(x)} ${Math.round(y)} ${ms}`, { timeout: 8000 });
    return { ok: true, action: 'longpress', point: { x: Math.round(x), y: Math.round(y) }, ms: Date.now() - started };
  }

  async swipePoints(x1, y1, x2, y2, duration = 300) {
    const started = Date.now();
    await run(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(duration)}`, {
      timeout: 12000,
    });
    return {
      ok: true,
      action: 'swipe',
      start: { x: Math.round(x1), y: Math.round(y1) },
      end: { x: Math.round(x2), y: Math.round(y2) },
      duration,
      ms: Date.now() - started,
    };
  }

  async key(name) {
    const keycode = KEYCODES[name] ?? (/^KEYCODE_/.test(name) ? name : null);
    if (!keycode) throw new Error(`不支持按键: ${name}`);
    await run(`input keyevent ${keycode}`, { timeout: 8000 });
    return { ok: true, action: 'key', key: keycode };
  }

  async text(value) {
    const raw = String(value ?? '');
    if (!raw) throw new Error('文本为空');
    if (!/^[\x20-\x7e]*$/.test(raw)) throw new Error('input text 只支持 ASCII；中文需要额外输入法');
    const escaped = raw.replaceAll(' ', '%s').replaceAll("'", "'\\''");
    await run(`input text '${escaped}'`, { timeout: 10000 });
    return { ok: true, action: 'text', length: raw.length };
  }

  async exec(payload) {
    const position = payload?.position;
    if (payload?.action === 'swipe' && payload?.swipeArg) {
      const s = payload.swipeArg.start ?? {};
      const e = payload.swipeArg.end ?? s;
      return this.swipePoints(Number(s.x ?? s.left), Number(s.y ?? s.top), Number(e.x ?? e.left), Number(e.y ?? e.top), payload.swipeArg.duration ?? 300);
    }
    if (payload?.action === 'back') return this.key('back');
    if (position) return this.tapPoint(Number(position.x ?? position.left), Number(position.y ?? position.top));
    throw new Error('root 驱动不支持选择器，请传 position 或使用 /api/tap');
  }

  async getServerInfo() {
    return {
      device: { device: 'root', model: 'android', manufacturer: 'android', brand: 'android', sdkInt: 0, release: '16' },
      gkdAppInfo: { id: 'root', name: 'root driver', versionCode: 0, versionName: 'root' },
    };
  }
}

export { sleep };
