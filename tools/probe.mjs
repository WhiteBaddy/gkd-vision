const port = process.argv[2] ?? '7777';
// Observe-only by default: real drivers inject actual taps on the device.
const ACT = process.argv.includes('--act');
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
ws.binaryType = 'arraybuffer';
const seen = { hello: null, frames: 0, images: 0, trees: 0, actions: [], errors: [] };
const pending = [];
ws.onopen = () => console.log('open');
ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.type === 'hello') seen.hello = msg;
    if (msg.type === 'frame') seen.frames += 1;
    if (msg.type === 'tree') seen.trees += 1;
    if (msg.type === 'error') seen.errors.push(msg.error);
    if (msg.type === 'action') seen.actions.push({ kind: msg.kind, ok: msg.ok, anchor: msg.anchor });
  } else {
    seen.images += 1;
  }
};
if (ACT) {
  setTimeout(() => ws.send(JSON.stringify({ type: 'tap', x: 540, y: 520 })), 1500);
  setTimeout(() => ws.send(JSON.stringify({ type: 'swipe', x1: 540, y1: 1800, x2: 540, y2: 900, duration: 260 })), 2200);
}
setTimeout(() => {
  console.log(JSON.stringify(seen, null, 2));
  ws.close();
  process.exit(0);
}, 4000);
