// グローバル状態管理
let audioContext, analyser, microphone, dataArray;
let calibMultiplier = 1.0;
let strokeCycles = 3; // デフォルト：4スト6気筒想定（1回転あたり3爆発）

// 1. UIイベントリスナー
document.getElementById('start-btn').addEventListener('click', async () => {
  await initAudio();
  initGPS();
  initSensors();
  document.getElementById('start-btn').style.display = 'none';
});

document.getElementById('stroke-cycles').addEventListener('change', (e) => {
  strokeCycles = parseFloat(e.target.value);
});

document.getElementById('calib-multiplier').addEventListener('input', (e) => {
  calibMultiplier = parseFloat(e.target.value);
  document.getElementById('calib-val').innerText = calibMultiplier.toFixed(2);
});

// 2. 音声解析によるRPM推定 (Web Audio API)
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    
    // FFTサイズ設定（周波数分解能を高めるため8192に設定）
    analyser.fftSize = 8192;
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);

    dataArray = new Float32Array(analyser.frequencyBinCount);
    analyzeRPM();
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
