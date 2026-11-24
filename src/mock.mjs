/**
 * Mock GKD device. Speaks the same shape as GkdClient so the whole pipeline
 * (capture loop → WebSocket → browser UI → tap) can be exercised without the
 * GKD app or its HTTP debug server.
 */

const W = 1080;
const H = 2400;

const rows = [
  { title: '无线局域网', subtitle: '已连接 · GKD-Vision-Demo', tint: '#2563eb' },
  { title: '蓝牙', subtitle: '未连接', tint: '#0ea5e9' },
  { title: '个人热点', subtitle: '关闭', tint: '#14b8a6' },
  { title: '屏幕显示', subtitle: '深色模式 · 120Hz', tint: '#8b5cf6' },
  { title: '应用管理', subtitle: '128 个应用', tint: '#f59e0b' },
];

const ROW_TOP = 420;
const ROW_HEIGHT = 230;
const ROW_GAP = 24;
const MARGIN = 48;

export class MockGkd {
  constructor({ captureMs = 90 } = {}) {
    this.captureMs = captureMs;
    this.seq = 0;
    this.taps = 0;
    this.selected = -1;
    this.lastPoint = null;
    this.actions = [];
    this.snapshots = new Map();
    this.origin = 'mock://gkd';
  }

  rowRect(index) {
    const top = ROW_TOP + index * (ROW_HEIGHT + ROW_GAP);
    return { left: MARGIN, top, right: W - MARGIN, bottom: top + ROW_HEIGHT };
  }

  nodes() {
    const list = [
      {
        id: 0,
        pid: -1,
        attr: {
          name: 'FrameLayout',
          id: 'com.demo:id/root',
          vid: '',
          text: '',
          desc: '',
          clickable: false,
          longClickable: false,
          editable: false,
          visibleToUser: true,
          left: 0,
          top: 0,
          right: W,
          bottom: H,
          width: W,
          height: H,
          childCount: rows.length + 3,
          index: 0,
          depth: 0,
        },
      },
      {
        id: 1,
        pid: 0,
        attr: {
          name: 'TextView',
          id: 'com.demo:id/title',
          vid: 'title',
          text: '设置',
          desc: '',
          clickable: false,
          longClickable: false,
          editable: false,
          visibleToUser: true,
          left: MARGIN,
          top: 150,
          right: W - MARGIN,
          bottom: 250,
          width: W - MARGIN * 2,
          height: 100,
          childCount: 0,
          index: 0,
          depth: 1,
        },
      },
      {
        id: 2,
        pid: 0,
        attr: {
          name: 'EditText',
          id: 'com.demo:id/search',
          vid: 'search',
          text: '',
          desc: '搜索设置',
          clickable: true,
          longClickable: true,
          editable: true,
          visibleToUser: true,
          left: MARGIN,
          top: 280,
          right: W - MARGIN,
          bottom: 380,
          width: W - MARGIN * 2,
          height: 100,
          childCount: 0,
          index: 1,
          depth: 1,
        },
      },
    ];
    rows.forEach((row, index) => {
      const rect = this.rowRect(index);
      list.push({
        id: 100 + index,
        pid: 0,
        attr: {
          name: 'LinearLayout',
          id: `com.demo:id/row_${index}`,
          vid: `row_${index}`,
          text: row.title,
          desc: row.subtitle,
          clickable: true,
          longClickable: true,
          editable: false,
          visibleToUser: true,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          childCount: 2,
          index: index + 2,
          depth: 1,
        },
      });
    });
    return list;
  }

  async getServerInfo() {
    return {
      device: { device: 'mock', model: 'Mock Phone', manufacturer: 'Demo', brand: 'demo', sdkInt: 35, release: '15' },
      gkdAppInfo: { id: 'li.songe.gkd', name: 'GKD', versionCode: 102, versionName: 'mock' },
    };
  }

  async getSnapshots() {
    return [...this.snapshots.keys()].map((id) => ({ id }));
  }

  async captureSnapshot() {
    await new Promise((resolve) => setTimeout(resolve, this.captureMs));
    this.seq += 1;
    const id = 1000 + this.seq;
    const snapshot = {
      id,
      appId: 'com.demo.settings',
      activityId: 'com.demo.settings.MainActivity',
      screenWidth: W,
      screenHeight: H,
      isLandscape: false,
      appInfo: { id: 'com.demo.settings', name: '演示设置', versionCode: 1, versionName: '1.0', isSystem: false, mtime: Date.now(), hidden: false },
      gkdAppInfo: { id: 'li.songe.gkd', name: 'GKD', versionCode: 102, versionName: 'mock' },
      device: { device: 'mock', model: 'Mock Phone', manufacturer: 'Demo', brand: 'demo', sdkInt: 35, release: '15' },
      nodes: this.nodes(),
    };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  async getScreenshot(id) {
    if (!this.snapshots.has(id)) throw Object.assign(new Error('SNAPSHOT_NOT_FOUND'), { code: 'SNAPSHOT_NOT_FOUND' });
    return Buffer.from(this.#svg(), 'utf8');
  }

  async deleteSnapshot(id) {
    this.snapshots.delete(id);
    return { message: 'success' };
  }

  async execSelector(payload) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (String(payload?.selector ?? '').includes('!!!')) {
      throw Object.assign(new Error('INVALID_SELECTOR'), { code: 'INVALID_SELECTOR' });
    }
    const position = payload?.position;
    const point = position ? { x: Number(position.x ?? position.left ?? 0), y: Number(position.y ?? position.top ?? 0) } : null;
    if (payload?.action === 'swipe' && payload?.swipeArg) {
      const end = payload.swipeArg.end ?? payload.swipeArg.start;
      this.actions.push({ at: Date.now(), kind: 'swipe', to: end });
      this.lastPoint = { x: Number(end?.x ?? 0), y: Number(end?.y ?? 0) };
      return { action: 'swipe', result: true, position: [this.lastPoint.x, this.lastPoint.y] };
    }
    if (payload?.action === 'back') {
      this.actions.push({ at: Date.now(), kind: 'back' });
      return { action: 'back', result: true };
    }
    if (payload?.action === 'none') {
      return { action: 'none', result: true };
    }
    if (point) {
      this.taps += 1;
      this.lastPoint = point;
      this.selected = rows.findIndex((_, index) => {
        const rect = this.rowRect(index);
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      });
      this.actions.push({ at: Date.now(), kind: payload.action ?? 'clickCenter', point });
      return { action: payload.action ?? 'clickCenter', result: true, position: [point.x, point.y] };
    }
    return { action: payload?.action ?? 'click', result: true };
  }

  async ping() {
    return { info: await this.getServerInfo(), snapshotCount: this.snapshots.size };
  }

  #svg() {
    const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const rowMarkup = rows
      .map((row, index) => {
        const rect = this.rowRect(index);
        const active = index === this.selected;
        const x = rect.left;
        const y = rect.top;
        const w = rect.right - rect.left;
        const h = rect.bottom - rect.top;
        return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="${active ? '#1e293b' : '#111827'}" stroke="${active ? row.tint : '#1f2937'}" stroke-width="${active ? 6 : 3}"/>
        <rect x="${x + 32}" y="${y + 62}" width="96" height="96" rx="28" fill="${row.tint}" opacity="0.85"/>
        <text x="${x + 176}" y="${y + 108}" font-family="sans-serif" font-size="46" fill="#e5e7eb">${esc(row.title)}</text>
        <text x="${x + 176}" y="${y + 164}" font-family="sans-serif" font-size="34" fill="#94a3b8">${esc(row.subtitle)}</text>
        <text x="${x + w - 48}" y="${y + 128}" text-anchor="end" font-size="44" fill="#475569">›</text>
      </g>`;
      })
      .join('');
    const point = this.lastPoint
      ? `<circle cx="${this.lastPoint.x}" cy="${this.lastPoint.y}" r="54" fill="none" stroke="#22d3ee" stroke-width="6" opacity="0.9"/>
         <circle cx="${this.lastPoint.x}" cy="${this.lastPoint.y}" r="10" fill="#22d3ee"/>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#030712"/>
      <text x="${MARGIN}" y="110" font-family="sans-serif" font-size="64" font-weight="600" fill="#f8fafc">设置</text>
      <text x="${W - MARGIN}" y="110" text-anchor="end" font-family="sans-serif" font-size="30" fill="#64748b">MOCK · ${this.seq}</text>
      <rect x="${MARGIN}" y="280" width="${W - MARGIN * 2}" height="100" rx="50" fill="#0f172a" stroke="#1f2937" stroke-width="3"/>
      <text x="${MARGIN + 48}" y="345" font-family="sans-serif" font-size="36" fill="#475569">搜索设置</text>
      ${rowMarkup}
      ${point}
      <rect x="0" y="${H - 200}" width="${W}" height="200" fill="#0b1120"/>
      <text x="${MARGIN}" y="${H - 100}" font-family="sans-serif" font-size="32" fill="#64748b">taps: ${this.taps}</text>
      <text x="${MARGIN}" y="${H - 56}" font-family="sans-serif" font-size="28" fill="#334155">mock device · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</text>
    </svg>`;
  }
}
