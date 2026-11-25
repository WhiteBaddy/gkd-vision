import { spawn } from 'node:child_process';

const SCALE_WIDTH = 300; // 1200 宽屏幕的 25%

function magickGray(args, stdin, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn('magick', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('magick 超时'));
    }, timeout);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || `magick 退出码 ${code}`));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(stdin ?? Buffer.alloc(0));
  });
}

/** 整屏图片转指定宽度的灰度 raw。 */
export async function toGray(buffer, width = SCALE_WIDTH, crop) {
  const args = ['webp:-'];
  if (crop) args.push('-crop', `${crop.w}x${crop.h}+${crop.x}+${crop.y}`, '+repage');
  args.push('-resize', `${width}x`, '-colorspace', 'Gray', '-depth', '8', 'gray:-');
  const data = await magickGray(args, buffer);
  if (data.length % width !== 0) throw new Error('灰度图尺寸异常');
  return { data, width, height: data.length / width };
}

/** 从 PNG/WebP buffer 转灰度 raw（模板可能来自 base64 或裁剪）。 */
export async function toGrayFromImage(buffer, width) {
  const data = await magickGray(['png:-', '-resize', `${width}x`, '-colorspace', 'Gray', '-depth', '8', 'gray:-'], buffer);
  if (data.length % width !== 0) throw new Error('灰度模板尺寸异常');
  return { data, width, height: data.length / width };
}

function stats(img) {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / img.data.length;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / img.data.length - mean * mean)) };
}

/** 归一化互相关（NCC），对亮度/对比度不敏感，且天然抑制纯色区域误匹配。 */
function scan(screen, tpl, x0, y0, x1, y1, step = 1) {
  const n = tpl.width * tpl.height;
  let sumT = 0;
  let sumT2 = 0;
  for (let i = 0; i < n; i++) {
    const v = tpl.data[i];
    sumT += v;
    sumT2 += v * v;
  }
  const meanT = sumT / n;
  const varT = sumT2 / n - meanT * meanT;
  let best = -Infinity;
  let bx = x0;
  let by = y0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      let sumS = 0;
      let sumS2 = 0;
      let sumST = 0;
      for (let j = 0; j < tpl.height; j++) {
        const sOff = (y + j) * screen.width + x;
        const tOff = j * tpl.width;
        for (let i = 0; i < tpl.width; i++) {
          const sv = screen.data[sOff + i];
          const tv = tpl.data[tOff + i];
          sumS += sv;
          sumS2 += sv * sv;
          sumST += sv * tv;
        }
      }
      const meanS = sumS / n;
      const varS = sumS2 / n - meanS * meanS;
      const denom = Math.sqrt(Math.max(varS, 0) * Math.max(varT, 0));
      const score = denom < 1e-6 ? -1 : (sumST / n - meanS * meanT) / denom;
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return { x: bx, y: by, ncc: best };
}

/**
 * 粗到细 NCC：25% 灰度图上步长 2 全扫，再 ±refineRadius 逐像素精修。
 * 返回坐标基于传入的 screen（即 25% 坐标），score = (ncc+1)/2 ∈ [0,1]。
 */
export function matchTemplate(screen, tpl, { threshold = 0.9, refineRadius = 8 } = {}) {
  if (tpl.width > screen.width || tpl.height > screen.height) return { found: false, score: 0, reason: 'template-too-large' };
  if (tpl.width < 4 || tpl.height < 4) return { found: false, score: 0, reason: 'template-too-small' };
  if (stats(tpl).std < 8) return { found: false, score: 0, reason: 'template-too-flat' };

  // 大模板用更大的粗扫步长，避免 O(面积×位置) 爆炸；精修窗口至少覆盖一个步长。
  const area = tpl.width * tpl.height;
  const step = area > 4000 ? 4 : 2;
  const radius = Math.max(refineRadius, step + 4);
  const coarse = scan(screen, tpl, 0, 0, screen.width - tpl.width, screen.height - tpl.height, step);
  const x0 = Math.max(0, coarse.x - radius);
  const y0 = Math.max(0, coarse.y - radius);
  const x1 = Math.min(screen.width - tpl.width, coarse.x + radius);
  const y1 = Math.min(screen.height - tpl.height, coarse.y + radius);
  const fine = x1 >= x0 && y1 >= y0 ? scan(screen, tpl, x0, y0, x1, y1, 1) : coarse;
  const score = (fine.ncc + 1) / 2;
  return { found: score >= threshold, score, x: fine.x, y: fine.y, ncc: fine.ncc };
}

export { SCALE_WIDTH };
/** 9×8 灰度差分哈希：无 a11y 时用来区分页面（64bit）。 */
export async function dHash(buffer, input = 'webp:-') {
  const data = await magickGray([input, '-resize', '9x8!', '-colorspace', 'Gray', '-depth', '8', 'gray:-'], buffer);
  if (data.length !== 72) throw new Error('dHash 尺寸异常');
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}
