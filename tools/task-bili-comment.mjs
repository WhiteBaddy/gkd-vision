// 真实任务：在 B 站读取当前视频「发布时间最晚」的一条评论。
// 用法：node tools/task-bili-comment.mjs   （服务需以 --driver a11y 运行在 7788）
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://127.0.0.1:7788';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let fails = 0;
const bad = (msg) => { fails += 1; console.error('FAIL', msg); };

async function post(path, body = {}) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}
async function tree() {
  const res = await fetch(BASE + '/api/tree?fresh=1');
  return res.json();
}
const waitText = (text, timeoutMs = 3000) => post('/api/wait', { expect: { text }, timeoutMs });

const t0 = Date.now();
execFileSync('su', ['-c', 'am force-stop tv.danmaku.bili']);
execFileSync('su', ['-c', 'am start -n tv.danmaku.bili/.MainActivityV2'], { stdio: 'ignore' });

let fp;
for (let i = 0; i < 24; i++) {
  fp = await post('/api/fingerprint', { fresh: true });
  if (fp.package === 'tv.danmaku.bili') break;
  await sleep(400);
}
if (fp.package !== 'tv.danmaku.bili') { bad(`前台是 ${fp.package}，不是 B 站`); process.exit(1); }
log(`OK 指纹：${fp.package} | ${fp.title.slice(0, 24)} | ${Date.now() - t0}ms`);

const CHROME = /^(直播|推荐|热门|动画|影视|新征程|首页|关注|消息|我的|会员购|搜索视频|登录|发布|动态|频道)/;
const pickCards = (listing) => (listing.nodes ?? [])
  .filter((n) => {
    const text = (n.text ?? '').trim();
    const unitOnly = /^[\d.]+(万|亿|千|k|K)?$/.test(text);
    return text.length >= 6 && !unitOnly && !CHROME.test(text) && n.top > 300 && n.right > n.left;
  })
  .sort((a, b) => a.top - b.top);
let listing = await tree();
let cards = pickCards(listing);
for (let i = 0; i < 12 && !cards.length; i++) {
  await sleep(500);
  listing = await tree();
  cards = pickCards(listing);
}
if (!cards.length) {
  bad('推荐流没有找到可点击的标题节点');
  log('候选节点：', (listing.nodes ?? []).filter((n) => (n.text ?? '').trim()).slice(0, 12).map((n) => n.text.trim().slice(0, 20)));
  process.exit(1);
}
const card = cards[0];
log(`OK 目标卡片：${card.text.trim().slice(0, 32)} @ ${card.left},${card.top}`);

const tapped = await post('/api/tapText', { text: card.text.trim(), fresh: true });
log(`tapText -> ok=${tapped.ok} via=${tapped.selector ?? 'coords'} point=${JSON.stringify(tapped.point)}`);
if (!tapped.ok) bad('点击卡片失败');

const detail = await waitText('简介', 5000);
if (!detail.ok) bad(`未进入详情页（${detail.elapsedMs}ms）`);
else log(`OK 进入详情页（${detail.elapsedMs}ms，${detail.attempts} 次）`);

const tab = await post('/api/tapText', { text: '评论', exact: true, fresh: true });
log(`tapText 评论 -> ok=${tab.ok} via=${tab.selector ?? 'coords'}`);
let panel = await waitText('按热度', 2500);
if (!panel.ok) {
  log('评论面板未出现，向下滑动后重试');
  await post('/api/swipe', { x1: 600, y1: 1900, x2: 600, y2: 1300, duration: 250 });
  await sleep(600);
  const again = await post('/api/tapText', { text: '评论', exact: true, fresh: true });
  log(`重试 tapText 评论 -> ok=${again.ok}`);
  panel = await waitText('按热度', 2500);
}
if (!panel.ok) bad(`评论面板未打开（${panel.elapsedMs}ms）`);
else log(`OK 评论面板打开（${panel.elapsedMs}ms）`);

const sort = await post('/api/tapText', { text: '按热度', fresh: true });
log(`tapText 按热度 -> ok=${sort.ok}`);
const newest = await waitText('最新评论', 3000);
if (!newest.ok) bad(`未切到最新评论（${newest.elapsedMs}ms）`);
else log(`OK 已切到最新评论（${newest.elapsedMs}ms）`);

const after = await tree();
const clean = (s) => s.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim();
const nodes = (after.nodes ?? []).filter((n) => clean(n.text).length > 0);
const header = nodes.find((n) => clean(n.text).includes('最新评论'));
const videoTitle = clean(fp.title).slice(0, 12);
const top = nodes
  .filter((n) => header && n.top > header.bottom && clean(n.text).length >= 20)
  .filter((n) => !clean(n.text).startsWith(videoTitle))
  .filter((n) => !/^(回复|分享|收藏|举报|复制|赞|打赏)/.test(clean(n.text)))
  .sort((a, b) => a.top - b.top)
  .slice(0, 3)
  .map((n) => ({ text: clean(n.text).slice(0, 80), top: n.top }));

log('---- 最新评论区前 3 条 ----');
for (const item of top) log(`y=${item.top}  ${item.text}`);
log(`---- 结果：${fails === 0 ? 'PASS' : 'FAIL'} (${Date.now() - t0}ms) ----`);
process.exit(fails === 0 ? 0 : 1);
