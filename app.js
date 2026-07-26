// グローバル変数
let audioContext, analyser, microphone, dataArray;
let calibMultiplier = 1.0;
let strokeCycles = 3;

let currentRpm = 0;
let currentSpeed = 0.0;
let pitchAngle = 0;
let rollAngle = 0;
let yawRate = 0;

// キャンバス要素
const horizonCanvas = document.getElementById('horizonCanvas');
const gaugeCanvas = document.getElementById('gaugeCanvas');
const hCtx = horizonCanvas.getContext('2d');
const gCtx = gaugeCanvas.getContext('2d');

// 画面解像度の同期
function resizeCanvases() {
  horizonCanvas.width = horizonCanvas.clientWidth;
  horizonCanvas.height = horizonCanvas.clientHeight;
  gaugeCanvas.width = gaugeCanvas.clientWidth;
  gaugeCanvas.height = gaugeCanvas.clientHeight;
}
window.addEventListener('resize', resizeCanvases);

// 初期化ボタン
document.getElementById('start-btn').addEventListener('click', async () => {
  resizeCanvases();
  await initAudio();
  initGPS();
  initSensors();
  document.getElementById('start-btn').style.display = 'none';
  
  // 描画ループ開始
  requestAnimationFrame(renderLoop);
});

// 設定の入力
document.getElementById('stroke-cycles').addEventListener('change', (e) => {
  strokeCycles = parseFloat(e.target.value);
});
document.getElementById('calib-multiplier').addEventListener('input', (e) => {
  calibMultiplier = parseFloat(e.target.value);
  document.getElementById('calib-val').innerText = calibMultiplier.toFixed(2);
});

// --- 描画メインループ ---
function renderLoop() {
  drawAttitudeIndicator();
  drawRpmGauge();
  requestAnimationFrame(renderLoop);
}

// 1. 人工水平儀（Attitude Indicator）の描画
function drawAttitudeIndicator() {
  const w = horizonCanvas.width;
  const h = horizonCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  hCtx.clearRect(0, 0, w, h);
  hCtx.save();

  // クリッピング領域設定
  hCtx.beginPath();
  hCtx.arc(cx, cy, Math.min(w, h) * 0.42, 0, Math.PI * 2);
  hCtx.clip();

  // 傾き（Roll）とピッチ（Pitch）による回転・移動
  hCtx.translate(cx, cy);
  hCtx.rotate((rollAngle * Math.PI) / 180);
  const pitchOffset = pitchAngle * 3; // 感度調整

  // 空（ブラウン/ダークブルー）と海（ダークオリーブ）
  hCtx.fillStyle = '#001122'; // 天井
  hCtx.fillRect(-w, -h * 2 + pitchOffset, w * 2, h * 2);
  
  hCtx.fillStyle = '#112200'; // 地表/水面
  hCtx.fillRect(-w, pitchOffset, w * 2, h * 2);

  // 地平線ライン
  hCtx.strokeStyle = '#00ff66';
  hCtx.lineWidth = 2;
  hCtx.beginPath();
  hCtx.moveTo(-w, pitchOffset);
  hCtx.lineTo(w, pitchOffset);
  hCtx.stroke();

  hCtx.restore();

  // 固定ピッチマーク（自船シンボル）
  hCtx.strokeStyle = '#ff9900';
  hCtx.lineWidth = 3;
  hCtx.beginPath();
  // 左ウィング
  hCtx.moveTo(cx - 40, cy);
  hCtx.lineTo(cx - 15, cy);
  hCtx.lineTo(cx - 15, cy + 10);
  // 右ウィング
  hCtx.moveTo(cx + 40, cy);
  hCtx.lineTo(cx + 15, cy);
  hCtx.lineTo(cx + 15, cy + 10);
  // センター点
  hCtx.arc(cx, cy, 3, 0, Math.PI * 2);
  hCtx.stroke();
}

// 2. 円形タコメーターの描画
function drawRpmGauge() {
  const w = gaugeCanvas.width;
  const h = gaugeCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38;

  gCtx.clearRect(0, 0, w, h);

  // 背景アーク
  const startAngle = 0.75 * Math.PI;
  const endAngle = 2.25 * Math.PI;

  gCtx.lineWidth = 12;
  gCtx.strokeStyle = '#1a331a';
  gCtx.beginPath();
  gCtx.arc(cx, cy, radius, startAngle, endAngle);
  gCtx.stroke();

  // RPMに応じたプログレスアーク
  const maxRpm = 6000;
  const rpmPct = Math.min(Math.max(currentRpm / maxRpm, 0), 1);
  const currentAngle = startAngle + (endAngle - startAngle) * rpmPct;

  // ワーニングカラー（高回転で赤）
  let color = '#00ff66';
  if (currentRpm > 4500) color = '#ff3300';
  else if (currentRpm > 3500) color = '#ff9900';

  gCtx.strokeStyle = color;
  gCtx.shadowBlur = 10;
  gCtx.shadowColor = color;
  gCtx.beginPath();
  gCtx.arc(cx, cy, radius, startAngle, currentAngle);
  gCtx.stroke();
  gCtx.shadowBlur = 0; // リセット

  // 針の描画
  gCtx.save();
  gCtx.translate(cx, cy);
  gCtx.rotate(currentAngle);
  gCtx.strokeStyle = '#ffffff';
  gCtx.lineWidth = 3;
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
    alert('マイクエラー: ' + err);
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
      document.getElementById('rpm-readout').innerHTML = `${currentRpm} <span>RPM</span>`;
    }
  }
}

function initGPS() {
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      const speedMps = pos.coords.speed || 0;
      currentSpeed = speedMps * 1.94384; // knots
      document.getElementById('speed-val').innerText = currentSpeed.toFixed(1);
    }, null, { enableHighAccuracy: true });
  }
}

function initSensors() {
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta !== null) {
      pitchAngle = Math.round(e.beta);  // ピッチ
      rollAngle = Math.round(e.gamma);   // ロール
    }
  });

  window.addEventListener('devicemotion', (e) => {
    if (e.rotationRate && e.rotationRate.alpha !== null) {
      yawRate = Math.round(e.rotationRate.alpha);
      document.getElementById('yaw-val').innerText = yawRate;
    }
  });
}
  } catch (err) {
    alert('マイクのアクセス許可が必要です: ' + err);
  }
}

function analyzeRPM() {
  requestAnimationFrame(analyzeRPM);
  if (!analyser) return;

  analyser.getFloatFrequencyData(dataArray);

  const sampleRate = audioContext.sampleRate;
  const fftSize = analyser.fftSize;
  const bufferLength = analyser.frequencyBinCount;

  // 舶用エンジン音（10Hz〜300Hz付近の基本波）のピーク検索
  let maxVolume = -Infinity;
  let targetBin = 0;

  const minBin = Math.floor(10 / (sampleRate / fftSize));  // ~10Hz
  const maxBin = Math.floor(300 / (sampleRate / fftSize)); // ~300Hz

  for (let i = minBin; i < maxBin; i++) {
    if (dataArray[i] > maxVolume) {
      maxVolume = dataArray[i];
      targetBin = i;
    }
  }

  // ピーク周波数 (Hz) の算出
  const dominantFrequency = targetBin * (sampleRate / fftSize);

  // 音量が極端に小さい場合はノイズとみなしてスキップ
  if (maxVolume > -80 && dominantFrequency > 0) {
    // HzからRPMへの換算式:
    // (周波数 Hz * 60秒) / (1回転あたりの点火・爆発数) * 校正係数
    const rawRpm = (dominantFrequency * 60) / strokeCycles;
    const finalRpm = Math.round(rawRpm * calibMultiplier);

    if (finalRpm > 400 && finalRpm < 8000) { // 一般的な回転数域フィルター
      document.getElementById('rpm-value').innerText = finalRpm;
      updateEfficiency(finalRpm);
    }
  }
}

// 3. GPSによる速度計測 & 燃費計算
let currentSpeedKnots = 0;

function initGPS() {
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      const speedMps = pos.coords.speed || 0; // m/s
      currentSpeedKnots = speedMps * 1.94384; // m/s -> knots 換算
      document.getElementById('speed-value').innerText = currentSpeedKnots.toFixed(1);
    }, (err) => {
      console.warn('GPSエラー: ', err);
    }, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 5000
    });
  }
}

// 簡易燃費指標（速度 (kt) / (RPM / 1000)）
function updateEfficiency(rpm) {
  if (rpm > 500 && currentSpeedKnots > 0.5) {
    const efficiency = currentSpeedKnots / (rpm / 1000);
    document.getElementById('efficiency-value').innerText = efficiency.toFixed(2);
  } else {
    document.getElementById('efficiency-value').innerText = '--.-';
  }
}

// 4. 船体傾き・角速度 (DeviceOrientation / Motion API)
function initSensors() {
  // 傾き (Pitch / Roll)
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta !== null) {
      const pitch = Math.round(e.beta); // 前後傾斜
      const roll = Math.round(e.gamma); // 左右傾斜
      document.getElementById('tilt-value').innerText = `${roll} / ${pitch}`;
    }
  });

  // 角速度 (Yaw rate)
  window.addEventListener('devicemotion', (e) => {
    if (e.rotationRate && e.rotationRate.alpha !== null) {
      const yawRate = Math.round(e.rotationRate.alpha);
      document.getElementById('gyro-value').innerText = yawRate;
    }
  });
}
