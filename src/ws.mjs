import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Minimal RFC6455 server: text + binary, ping/pong, close. No fragmentation of outgoing frames. */
export function attachWebSocket(server, { path = '/ws', onConnection } = {}) {
  server.on('upgrade', (req, socket) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== path || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n',
    );
    socket.setNoDelay(true);
    onConnection(new Peer(socket), url);
  });
}

class Peer {
  #socket;
  #chunks = [];
  #size = 0;
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    this.handlers = { message: [], close: [] };
    socket.on('data', (chunk) => this.#feed(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
  }

  on(event, fn) {
    this.handlers[event]?.push(fn);
    return this;
  }

  sendText(value) {
    this.#frame(0x1, Buffer.from(value, 'utf8'));
  }

  sendBinary(value) {
    this.#frame(0x2, Buffer.from(value));
  }

  destroy() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#socket.destroy();
    } catch {
      /* already gone */
    }
    for (const fn of this.handlers.close) fn();
  }

  #frame(opcode, payload) {
    if (this.#closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.#socket.write(Buffer.concat([header, payload]));
    } catch {
      this.destroy();
    }
  }

  #feed(chunk) {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    if (this.#size > 8 << 20) {
      this.destroy();
      return;
    }
    for (;;) {
      const buf = this.#chunks.length === 1 ? this.#chunks[0] : Buffer.concat(this.#chunks);
      this.#chunks = [buf];
      const parsed = parseFrame(buf);
      if (!parsed) return;
      this.#chunks = [buf.subarray(parsed.consumed)];
      this.#size -= parsed.consumed;
      this.#dispatch(parsed);
      if (this.#closed) return;
    }
  }

  #dispatch({ opcode, payload }) {
    if (opcode === 0x1) {
      for (const fn of this.handlers.message) {
        try {
          fn(payload.toString('utf8'));
        } catch {
          /* ignore malformed client message */
        }
      }
    } else if (opcode === 0x8) {
      this.destroy();
    } else if (opcode === 0x9) {
      this.#frame(0xa, payload);
    }
  }
}

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > 8n << 20n) return { opcode: 0x8, payload: Buffer.alloc(0), consumed: buf.length };
    len = Number(big);
    offset = 10;
  }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  if (!fin) return { opcode: 0x0, payload: Buffer.alloc(0), consumed: offset + len };
  return { opcode, payload, consumed: offset + len };
}
