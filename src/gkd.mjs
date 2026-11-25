export class RpcError extends Error {
  constructor({ code, message, path, stackTrace }) {
    super(message || code || 'rpc error');
    this.name = 'RpcError';
    this.code = code;
    this.path = path;
    this.stackTrace = stackTrace;
  }
}

export function sniffImage(bytes) {
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) {
    return 'image/webp';
  }
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  const head = Buffer.from(bytes.subarray(0, 256)).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * Client for the GKD app's on-device HTTP debug server (the same protocol the
 * @gkd-kit/inspect web tool speaks).
 *
 * All endpoints are POST /api/<name> and answer with JSON, binary or a
 * `GKD-RPC-Status: ok|error` header. Older builds only flag errors in the body.
 */
export class GkdClient {
  constructor(origin = 'http://127.0.0.1:8888', { timeout = 20000, token = null, tokenProvider = null } = {}) {
    this.origin = origin;
    this.timeout = timeout;
    this.token = token;
    this.tokenProvider = tokenProvider;
  }

  async #post(name, body = {}, retried = false) {
    if (!this.token && typeof this.tokenProvider === 'function') {
      this.token = await this.tokenProvider();
    }
    const url = new URL(`/api/${name}`, this.origin);
    const headers = { 'content-type': 'application/json' };
    if (this.token) headers['x-vision-token'] = this.token;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (response.status === 401 && !retried && typeof this.tokenProvider === 'function') {
      // 令牌可能在清数据/重装后变化：强制重读并仅重试一次。
      this.token = null;
      const fresh = await this.tokenProvider();
      if (fresh) {
        this.token = fresh;
        return this.#post(name, body, true);
      }
    }
    const status = response.headers.get('gkd-rpc-status');
    if (status === 'error') {
      let error = {};
      try {
        error = await response.json();
      } catch {
        /* fall through to generic error */
      }
      throw new RpcError(error);
    }
    if (!response.ok) {
      throw new RpcError({ code: `HTTP_${response.status}`, message: `HTTP ${response.status}` });
    }
    if (!status) {
      // Legacy servers: a JSON body {__error:true,...} means failure.
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/json')) {
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new RpcError({ code: 'BAD_JSON', message: 'RPC 响应不是有效 JSON' });
        }
        if (data && data.__error === true) {
          throw new RpcError({ code: 'LEGACY_ERROR', message: data.message });
        }
        return { kind: 'json', data };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { kind: 'binary', bytes };
    }
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      return { kind: 'json', data: await response.json() };
    }
    return { kind: 'binary', bytes: new Uint8Array(await response.arrayBuffer()) };
  }

  async json(name, body) {
    const result = await this.#post(name, body);
    return result.data;
  }

  async binary(name, body) {
    const result = await this.#post(name, body);
    if (result.kind !== 'binary') throw new RpcError({ code: 'EXPECTED_BINARY', message: `${name} 未返回二进制` });
    return result.bytes;
  }

  getServerInfo() {
    return this.json('getServerInfo');
  }

  captureSnapshot() {
    return this.json('captureSnapshot');
  }

  getSnapshot(id) {
    return this.json('getSnapshot', { id });
  }

  getSnapshots() {
    return this.json('getSnapshots');
  }

  getScreenshot(id) {
    return this.binary('getScreenshot', { id });
  }

  deleteSnapshot(id) {
    return this.json('deleteSnapshot', { id });
  }

  execSelector(payload) {
    return this.json('execSelector', payload);
  }

  async ping() {
    const [info, snapshots] = await Promise.all([this.getServerInfo(), this.getSnapshots().catch(() => [])]);
    return { info, snapshotCount: Array.isArray(snapshots) ? snapshots.length : 0 };
  }
}
