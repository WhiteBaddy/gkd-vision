import { createHash } from 'node:crypto';

/** 纯数字 / 时间 / 时长这类会漂移的文本不参与指纹。 */
const NOISY = /^[\s\d:：./\\\-—–%~+]+$/;
const UNIT_ONLY = /^\d+(\.\d+)?(万|亿|千|k|K|w|W)?$/;

const area = (n) => Math.max(0, (n.right - n.left) * (n.bottom - n.top));

export function pickKeyTexts(nodes, limit = 5) {
  return (nodes ?? [])
    .filter((n) => {
      const text = (n.text ?? '').trim();
      if (!text) return false;
      if (NOISY.test(text) || UNIT_ONLY.test(text)) return false;
      if (text.length > 80) return false;
      return area(n) > 0;
    })
    .sort((a, b) => area(b) - area(a))
    .slice(0, limit)
    .map((n) => n.text.trim());
}

/**
 * 页面指纹：包名 + 面积最大的若干文本。
 * 不依赖 activityId（当前驱动常为空），只要求“同一页面稳定、切页会变”。
 */
export function buildFingerprint(frame) {
  const keyTexts = pickKeyTexts(frame?.nodes ?? []);
  const hash = createHash('sha1')
    .update([frame?.appId ?? '', ...keyTexts].join('\u0001'))
    .digest('hex')
    .slice(0, 16);
  return {
    package: frame?.appId ?? '',
    activity: frame?.activityId || null,
    title: keyTexts[0] ?? '',
    keyTexts,
    textHash: hash,
    nodeCount: (frame?.nodes ?? []).length,
    screen: frame ? `${frame.screenWidth}x${frame.screenHeight}` : null,
    seq: frame?.seq ?? 0,
    at: Date.now(),
  };
}

export function hasText(nodes, text, { exact = false } = {}) {
  const needle = String(text ?? '').trim();
  if (!needle) return false;
  return (nodes ?? []).some((n) => {
    const value = (n.text ?? '').trim();
    if (!value) return false;
    return exact ? value === needle : value.includes(needle);
  });
}

export function findTextNodes(nodes, text, { exact = false } = {}) {
  const needle = String(text ?? '').trim();
  if (!needle) return [];
  return (nodes ?? []).filter((n) => {
    const value = (n.text ?? '').trim();
    if (!value) return false;
    return exact ? value === needle : value.includes(needle);
  });
}
