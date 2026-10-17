const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const confSel = document.getElementById("confSel");
const objCountEl = document.getElementById("objCount");
const fpsEl = document.getElementById("fps");

let model = null;
let stream = null;
let running = false;
let nextId = 1;
let tracks = [];
let lastFrameTime = performance.now();

statusEl.textContent = "Loading COCO-SSD model...";
cocoSsd.load().then(m => {
  model = m;
  statusEl.textContent = "Model ready. Click 'Start Camera'.";
  startBtn.disabled = false;
}).catch(err => {
  statusEl.textContent = "Failed to load model: " + err.message;
});
startBtn.disabled = true;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Detecting...";
    tracks = [];
    nextId = 1;
    detectLoop();
  } catch (err) {
    statusEl.textContent = "Camera error: " + err.message;
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach(t => t.stop());
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Stopped.";
  objCountEl.textContent = "0";
}

function centroid(box) {
  const [x, y, w, h] = box;
  return { cx: x + w / 2, cy: y + h / 2, w, h };
}

function updateTracks(predictions) {
  const now = performance.now();
  const unmatched = new Set(tracks.map((_, i) => i));
  const assigned = [];

  predictions.forEach(pred => {
    const c = centroid(pred.bbox);
    let bestIdx = -1, bestDist = Infinity;
    tracks.forEach((t, i) => {
      if (!unmatched.has(i) || t.cls !== pred.class) return;
      const d = Math.hypot(t.cx - c.cx, t.cy - c.cy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });

    const MATCH_THRESHOLD = 80;
    if (bestIdx !== -1 && bestDist < MATCH_THRESHOLD) {
      const t = tracks[bestIdx];
      t.cx = c.cx; t.cy = c.cy; t.w = c.w; t.h = c.h;
      t.lastSeen = now; t.score = pred.score; t.bbox = pred.bbox;
      unmatched.delete(bestIdx);
      assigned.push(t);
    } else {
      const t = {
        id: nextId++, cx: c.cx, cy: c.cy, w: c.w, h: c.h,
        cls: pred.class, score: pred.score, bbox: pred.bbox, lastSeen: now
      };
      tracks.push(t);
      assigned.push(t);
    }
  });

  tracks = tracks.filter(t => now - t.lastSeen < 600);
  return assigned;
}

function draw(assigned) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  assigned.forEach(t => {
    const [x, y, w, h] = t.bbox;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#22c55e";
    ctx.strokeRect(x, y, w, h);

    const label = `#${t.id} ${t.cls} ${(t.score * 100).toFixed(0)}%`;
    ctx.font = "14px sans-serif";
    const textW = ctx.measureText(label).width + 10;

    ctx.save();
    ctx.translate(x + w, y > 20 ? y - 20 : y);
    ctx.scale(-1, 1);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, 0, textW, 20);
    ctx.fillStyle = "#0f1117";
    ctx.fillText(label, 5, 15);
    ctx.restore();
  });
}

async function detectLoop() {
  if (!running || !model) return;

  const predictions = await model.detect(video);
  const minScore = parseFloat(confSel.value);
  const filtered = predictions.filter(p => p.score >= minScore);

  const assigned = updateTracks(filtered);
  draw(assigned);

  objCountEl.textContent = assigned.length;
  const now = performance.now();
  const fps = 1000 / (now - lastFrameTime);
  fpsEl.textContent = fps.toFixed(1);
  lastFrameTime = now;

  requestAnimationFrame(detectLoop);
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
