// --- グローバル変数 ---
let audioContext, analyser, microphone, dataArray;
let calibMultiplier = 1.0;
let strokeCycles = 3;

let currentRpm = 0;
let currentSpeed = 0.0;
let pitchAngle = 0;
let rollAngle = 0;
let yawRate = 0;

let horizonCanvas, gaugeCanvas, hCtx, gCtx;

// DOMの読み込み完了を確実に待って初期化
document.addEventListener('DOMContentLoaded', () => {
  horizonCanvas = document.getElementById('horizonCanvas');
  gaugeCanvas = document.getElementById('gaugeCanvas');
  
  if (horizonCanvas && gaugeCanvas) {
    hCtx = horizonCanvas.getContext('2d');
    gCtx = gaugeCanvas.getContext('2d');
    resizeCanvases();
  }

  // 設定イベントのバインド
  const strokeSelect = document.getElementById('stroke-cycles');
  if (strokeSelect) {
    strokeSelect.addEventListener('change', (e) => {
      strokeCycles = parseFloat(e.target.value);
    });
  }

  const calibInput = document.getElementById('calib-multiplier');
  if (calibInput) {
    calibInput.addEventListener('input', (e) => {
      calibMultiplier = parseFloat(e.target.value);
      const valDisp = document.getElementById('calib-val');
      if (valDisp) valDisp.innerText = calibMultiplier.toFixed(2);
    });
  }

  // スタートボタンイベント
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      resizeCanvases();
      
      // センサー・マイク起動
      await initAudio();
      initGPS();
      initSensors();

      // UI切り替え & 描画ループ開始
      startBtn.style.display = 'none';
      requestAnimationFrame(renderLoop);
    });
  }
});

function resizeCanvases() {
  if (!horizonCanvas || !gaugeCanvas) return;
  horizonCanvas.width = horizonCanvas.clientWidth || 300;
  horizonCanvas.height = horizonCanvas.clientHeight || 180;
  gaugeCanvas.width = gaugeCanvas.clientWidth || 300;
  gaugeCanvas.height = gaugeCanvas.clientHeight || 180;
}

window.addEventListener('resize', resizeCanvases);

// --- 描画ループ ---
function renderLoop() {
  drawAttitudeIndicator();
  drawRpmGauge();
  requestAnimationFrame(renderLoop);
}

// 1. 人工水平儀の描画
function drawAttitudeIndicator() {
  if (!hCtx) return;
  const w = horizonCanvas.width;
  const h = horizonCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  hCtx.clearRect(0, 0, w, h);
  hCtx.save();

  // 円形マスク
  hCtx.beginPath();
  hCtx.arc(cx, cy, Math.min(w, h) * 0.42, 0, Math.PI * 2);
  hCtx.clip();

  // 回転・移動
  hCtx.translate(cx, cy);
  hCtx.rotate((rollAngle * Math.PI) / 180);
  const pitchOffset = pitchAngle * 2;

  // 空と海
  hCtx.fillStyle = '#001122';
  hCtx.fillRect(-w, -h * 2 + pitchOffset, w * 2, h * 2);
  hCtx.fillStyle = '#112200';
  hCtx.fillRect(-w, pitchOffset, w * 2, h * 2);

  // 地平線
  hCtx.strokeStyle = '#00ff66';
  hCtx.lineWidth = 2;
  hCtx.beginPath();
  hCtx.moveTo(-w, pitchOffset);
  hCtx.lineTo(w, pitchOffset);
  hCtx.stroke();

  hCtx.restore();

  // 自船シンボル
  hCtx.strokeStyle = '#ff9900';
  hCtx.lineWidth = 3;
  hCtx.beginPath();
  hCtx.moveTo(cx - 30, cy);
  hCtx.lineTo(cx - 10, cy);
  hCtx.lineTo(cx - 10, cy + 8);
  hCtx.moveTo(cx + 30, cy);
  hCtx.lineTo(cx + 10, cy);
  hCtx.lineTo(cx + 10, cy + 8);
  hCtx.stroke();
}

// 2. タコメーターの描画
function drawRpmGauge() {
  if (!gCtx) return;
  const w = gaugeCanvas.width;
  const h = gaugeCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.35;

  gCtx.clearRect(0, 0, w, h);

  const startAngle = 0.75 * Math.PI;
  const endAngle = 2.25 * Math.PI;

  // 背景枠
  gCtx.lineWidth = 10;
  gCtx.strokeStyle = '#1a331a';
  gCtx.beginPath();
  gCtx.arc(cx, cy, radius, startAngle, endAngle);
  gCtx.stroke();

  // ゲージ本体
  const maxRpm = 6000;
  const rpmPct = Math.min(Math.max(currentRpm / maxRpm, 0), 1);
  const currentAngle = startAngle + (endAngle - startAngle) * rpmPct;

  let color = '#00ff66';
  if (currentRpm > 4500) color = '#ff3300';
  else if (currentRpm > 3500) color = '#ff9900';

  gCtx.strokeStyle = color;
  gCtx.beginPath();
  gCtx.arc(cx, cy, radius, startAngle, currentAngle);
  gCtx.stroke();

  // 針
  gCtx.save();
  gCtx.translate(cx, cy);
  gCtx.rotate(currentAngle);
  gCtx.strokeStyle = '#ffffff';
  gCtx.lineWidth = 2;
  gCtx.beginPath();
  gCtx.moveTo(0, 0);
  gCtx.lineTo(radius - 5, 0);
  gCtx.stroke();
  gCtx.restore();
}

// --- 音声解析・センサー連動 ---
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192;
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    dataArray = new Float32Array(analyser.frequencyBinCount);
    analyzeRPM();
  } catch (err) {
    console.warn('マイクエラーまたは許可拒否:', err);
  }
}

function analyzeRPM() {
  requestAnimationFrame(analyzeRPM);
  if (!analyser) return;

  analyser.getFloatFrequencyData(dataArray);
  const sampleRate = audioContext.sampleRate;
  const fftSize = analyser.fftSize;

  let maxVolume = -Infinity;
  let targetBin = 0;
  const minBin = Math.floor(10 / (sampleRate / fftSize));
  const maxBin = Math.floor(300 / (sampleRate / fftSize));

  for (let i = minBin; i < maxBin; i++) {
    if (dataArray[i] > maxVolume) {
      maxVolume = dataArray[i];
      targetBin = i;
    }
  }

  const dominantFrequency = targetBin * (sampleRate / fftSize);

  if (maxVolume > -80 && dominantFrequency > 0) {
    const rawRpm = (dominantFrequency * 60) / strokeCycles;
    const finalRpm = Math.round(rawRpm * calibMultiplier);

    if (finalRpm > 400 && finalRpm < 8000) {
      currentRpm = finalRpm;
      const rpmReadout = document.getElementById('rpm-readout');
      if (rpmReadout) {
        rpmReadout.innerHTML = `${currentRpm} <span>RPM</span>`;
      }
    }
  }
}

function initGPS() {
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      const speedMps = pos.coords.speed || 0;
      currentSpeed = speedMps * 1.94384;
      const speedVal = document.getElementById('speed-val');
      if (speedVal) speedVal.innerText = currentSpeed.toFixed(1);
    }, (err) => console.warn('GPSエラー:', err), { enableHighAccuracy: true });
  }
}

function initSensors() {
  // Android / iOS のセンサーイベント取得
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta !== null) {
      pitchAngle = Math.round(e.beta);
      rollAngle = Math.round(e.gamma);
    }
  });

  window.addEventListener('devicemotion', (e) => {
    if (e.rotationRate && e.rotationRate.alpha !== null) {
      yawRate = Math.round(e.rotationRate.alpha);
      const yawVal = document.getElementById('yaw-val');
      if (yawVal) yawVal.innerText = yawRate;
    }
  });
}
