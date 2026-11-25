import assert from 'node:assert/strict';
import { buildFingerprint, pickKeyTexts, hasText, findTextNodes } from '../src/fingerprint.mjs';
import { matchTemplate } from '../src/vision-match.mjs';

/* ---------------- fingerprint ---------------- */

const mkNode = (id, text, left, top, right, bottom) => ({ id, pid: 0, depth: 1, text, desc: '', left, top, right, bottom });

const frame = {
  seq: 1,
  appId: 'com.demo',
  activityId: 'com.demo/.Main',
  screenWidth: 1200,
  screenHeight: 2608,
  nodes: [
    mkNode(0, '设置', 0, 0, 1200, 100),
    mkNode(1, '12:30', 0, 110, 200, 160),
    mkNode(2, '1234', 0, 170, 200, 220),
    mkNode(3, '无线局域网', 0, 300, 800, 400),
    mkNode(4, '', 0, 410, 800, 500),
  ],
};

const fp1 = buildFingerprint(frame);
const fp2 = buildFingerprint(frame);
assert.equal(fp1.textHash, fp2.textHash, '同页指纹应稳定');
assert.equal(fp1.package, 'com.demo');
assert.ok(fp1.keyTexts.includes('设置'));
assert.ok(fp1.keyTexts.includes('无线局域网'));
assert.ok(!fp1.keyTexts.includes('12:30'), '时间不应进入指纹');
assert.ok(!fp1.keyTexts.includes('1234'), '纯数字不应进入指纹');

const fp3 = buildFingerprint({ ...frame, appId: 'com.other' });
assert.notEqual(fp1.textHash, fp3.textHash, '换包名指纹应变化');

assert.deepEqual(pickKeyTexts(frame.nodes), ['设置', '无线局域网']);
assert.equal(hasText(frame.nodes, '无线'), true);
assert.equal(hasText(frame.nodes, '不存在'), false);
assert.equal(findTextNodes(frame.nodes, '设置').length, 1);

/* ---------------- template matching ---------------- */

function makeNoise(width, height, seed) {
  // 避免 LCG 低字节的 256 周期性（会造成假匹配），用哈希混合行列坐标。
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let h = (Math.imul(x, 0x27d4eb2f) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
      data[y * width + x] = h & 0xff;
    }
  }
  return data;
}

const screen = { data: makeNoise(300, 652, 7), width: 300, height: 652 };
const TX = 120;
const TY = 240;
const TW = 40;
const TH = 30;
const tplData = Buffer.alloc(TW * TH);
for (let y = 0; y < TH; y++) {
  for (let x = 0; x < TW; x++) tplData[y * TW + x] = screen.data[(TY + y) * 300 + TX + x];
}
const tpl = { data: tplData, width: TW, height: TH };

const hit = matchTemplate(screen, tpl, { threshold: 0.9 });
assert.equal(hit.found, true, '应命中');
assert.equal(hit.x, TX);
assert.equal(hit.y, TY);
assert.ok(hit.score > 0.99, `score 应接近 1，实际 ${hit.score}`);

const miss = matchTemplate(screen, { data: makeNoise(TW, TH, 99), width: TW, height: TH }, { threshold: 0.9 });
assert.equal(miss.found, false, '随机模板不应命中');

const flat = matchTemplate(screen, { data: Buffer.alloc(TW * TH, 128), width: TW, height: TH });
assert.equal(flat.found, false);
assert.equal(flat.reason, 'template-too-flat');

const tooLarge = matchTemplate(screen, { data: Buffer.alloc(400 * 700, 1), width: 400, height: 700 });
assert.equal(tooLarge.reason, 'template-too-large');

console.log('PASS fingerprint: 9 assertions');
console.log('PASS match: 6 assertions (hit/miss/flat/large)');
