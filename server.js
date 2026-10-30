const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Phục vụ giao diện web (public/index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Bộ nhớ lưu dữ liệu từ ESP32 gửi lên
let telemetryData = {
  temp: 32.0,
  humidity: 65.0,
  soil: 50,
  setpoint: 32.0,
  soilThreshold: 40,
  heaterON: true,
  heaterPowerPct: 0,
  pumpON: false,
  pumpAuto: true,
  kp: 41.25,
  ki: 0.589,
  kd: 721.88,
  autoTuning: false,
  tuneCycle: 0,
  tunePmDeg: 45.0,
  tuneAlpha: 10.0,
  heaterFault: false,
  tempTrend: "on dinh",
  tempRate: 0,
  tempForecast15m: 32.0,
  timeUntilWatering: "chua du du lieu",
  maintAlerts: 0,
  maintTop: "OK",
  pumpLocked: false,
  aiHealth: 100,
  aiWorst: "",
  aiZ: 0,
  modelConf: 0
};

let maintenanceData = { status: "OK", activeAlerts: 0, alerts: [], counters: {}, system: {} };
let healthData = { opHours: 0, histMin: 60, fastMin: 5, histHours: 0, uptimeMin: 0, model: {}, anomaly: { z: [0,0,0], count24h: [0,0,0], events: [] }, components: [], usage: {}, overall: { health: 100, worst: "lamp", state: "tot" }, pid: {} };
let cloudCommands = null;

// =========================================================================
// 1. CÁC ENDPOINT ĐỂ ESP32 ĐỒNG BỘ LÊN (Hàm syncWithFirebaseCloud trong ESP32)
// =========================================================================
app.put('/esp32_farm/telemetry.json', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    telemetryData = { ...telemetryData, ...req.body, _updatedAt: Date.now() };
  }
  res.json(telemetryData);
});

app.get('/esp32_farm/telemetry.json', (req, res) => {
  res.json(telemetryData);
});

app.put('/esp32_farm/maintenance.json', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    maintenanceData = { ...maintenanceData, ...req.body };
  }
  res.json(maintenanceData);
});

app.get('/esp32_farm/maintenance.json', (req, res) => {
  res.json(maintenanceData);
});

app.put('/esp32_farm/health.json', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    healthData = { ...healthData, ...req.body };
  }
  res.json(healthData);
});

app.get('/esp32_farm/health.json', (req, res) => {
  res.json(healthData);
});

// ESP32 gọi GET /esp32_farm/commands.json mỗi 3 giây để lấy lệnh điều khiển
app.get('/esp32_farm/commands.json', (req, res) => {
  res.json(cloudCommands);
});

app.put('/esp32_farm/commands.json', (req, res) => {
  cloudCommands = { ...req.body, _ts: Date.now() };
  res.json(cloudCommands);
});

app.patch('/esp32_farm/commands.json', (req, res) => {
  cloudCommands = { ...(cloudCommands || {}), ...req.body, _ts: Date.now() };
  res.json(cloudCommands);
});

app.delete('/esp32_farm/commands/:key.json', (req, res) => {
  const key = req.params.key;
  if (cloudCommands && cloudCommands[key] !== undefined) {
    delete cloudCommands[key];
  }
  res.json({ ok: true });
});

// =========================================================================
// 2. CÁC ENDPOINT CHO GIAO DIỆN WEB (/api/sensors, /api/control, /api/health...)
// =========================================================================
app.get('/api/sensors', (req, res) => {
  res.json(telemetryData);
});

app.get('/api/control', (req, res) => {
  const q = req.query;
  const cmd = { ...(cloudCommands || {}), _ts: Date.now() };

  if (q.setpoint !== undefined) {
    cmd.setpoint = parseFloat(q.setpoint);
    telemetryData.setpoint = cmd.setpoint;
  }
  if (q.soilThreshold !== undefined) {
    cmd.soilThreshold = parseInt(q.soilThreshold, 10);
    telemetryData.soilThreshold = cmd.soilThreshold;
  }
  if (q.heater !== undefined) {
    cmd.heaterON = (q.heater === '1' || q.heater === 'true');
    telemetryData.heaterON = cmd.heaterON;
  }
  if (q.pumpAuto !== undefined) {
    cmd.pumpAuto = (q.pumpAuto === '1' || q.pumpAuto === 'true');
    telemetryData.pumpAuto = cmd.pumpAuto;
  }
  if (q.pump !== undefined) {
    cmd.pumpAuto = false;
    cmd.pumpON = (q.pump === '1' || q.pump === 'true');
    telemetryData.pumpAuto = false;
    telemetryData.pumpON = cmd.pumpON;
  }
  if (q.kp !== undefined && q.ki !== undefined && q.kd !== undefined) {
    cmd.kp = parseFloat(q.kp);
    cmd.ki = parseFloat(q.ki);
    cmd.kd = parseFloat(q.kd);
    telemetryData.kp = cmd.kp;
    telemetryData.ki = cmd.ki;
    telemetryData.kd = cmd.kd;
  }
  if (q.autotune !== undefined) {
    cmd.startAutoTune = (q.autotune === '1');
    telemetryData.autoTuning = cmd.startAutoTune;
  }

  cloudCommands = cmd;
  res.json(telemetryData);
});

app.get('/api/maintenance', (req, res) => {
  if (req.query.ack) {
    cloudCommands = { ...(cloudCommands || {}), maintAck: req.query.ack, _ts: Date.now() };
  }
  res.json(maintenanceData);
});

app.get('/api/health', (req, res) => {
  res.json(healthData);
});

app.get('/api/ai', (req, res) => {
  const q = req.query;
  if (q.rollback) {
    cloudCommands = { ...(cloudCommands || {}), aiTune: 'rollback', _ts: Date.now() };
    return res.json({ ok: true, kp: telemetryData.kp, ki: telemetryData.ki, kd: telemetryData.kd });
  }
  const method = q.apply || q.suggest;
  if (method) {
    if (q.apply) {
      cloudCommands = { ...(cloudCommands || {}), aiTune: method, _ts: Date.now() };
    }
    return res.json({
      ok: true,
      applied: Boolean(q.apply),
      method,
      model: 'rls',
      note: 'Lenh da duoc gui qua Cloud xuong ESP32',
      kp: telemetryData.kp,
      ki: telemetryData.ki,
      kd: telemetryData.kd
    });
  }
  res.json(healthData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`IoTFarm Render Server dang chay tai cong ${PORT}`);
});