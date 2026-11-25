import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasText } from './fingerprint.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(cmd, args, { stdin, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`命令超时: ${cmd}`));
    }, timeout);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/** 用 ImageMagick 计算两张图的差异像素比例。 */
export async function imageDiffRatio(before, after) {
  if (!before?.length || !after?.length) return null;
  const dir = await mkdtemp(join(tmpdir(), 'vision-diff-'));
  try {
    const a = join(dir, 'a.webp');
    const b = join(dir, 'b.webp');
    await writeFile(a, before);
    await writeFile(b, after);
    const result = await run('magick', ['compare', '-metric', 'AE', '-fuzz', '5%', a, b, 'null:']);
    const text = `${result.stdout} ${result.stderr}`;
    const match = text.match(/([0-9.e+]+)/);
    if (!match) return null;
    const pixels = Number(match[1]);
    if (!Number.isFinite(pixels)) return null;
    const total = 1200 * 2608;
    return pixels / total;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 轮询等待期望出现。expect 支持：
 *   text / textGone / fingerprintChange / imageDiff
 * 返回 { ok, attempts, elapsedMs, frame, details }.
 */
export async function waitFor(vision, expect = {}, { timeoutMs = 1500, intervalMs = 250, before } = {}) {
  const started = Date.now();
  let attempts = 0;
  let lastFrame = before?.frame ?? null;
  let details = {};
  while (true) {
    attempts += 1;
    const frame = await vision.captureOnce();
    lastFrame = frame;
    const nodes = frame.nodes ?? [];
    const checks = [];

    if (expect.text != null) checks.push({ name: 'text', pass: hasText(nodes, expect.text, expect) });
    if (expect.textGone != null) checks.push({ name: 'textGone', pass: !hasText(nodes, expect.textGone, expect) });
    if (expect.fingerprintChange) {
      checks.push({ name: 'fingerprintChange', pass: frame.fingerprint?.textHash !== before?.fingerprint?.textHash });
    }
    if (expect.imageDiff != null && before?.image) {
      const ratio = await imageDiffRatio(before.image, frame.image);
      details.imageDiff = ratio;
      checks.push({ name: 'imageDiff', pass: ratio != null && ratio >= Number(expect.imageDiff) });
    }

    const ok = checks.length > 0 && checks.every((c) => c.pass);
    details.checks = checks;
    if (ok) return { ok: true, attempts, elapsedMs: Date.now() - started, frame, details };
    if (Date.now() - started >= timeoutMs) {
      return { ok: false, attempts, elapsedMs: Date.now() - started, frame, details };
    }
    await sleep(intervalMs);
  }
}

export { run as runCommand };
