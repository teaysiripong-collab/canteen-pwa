import { toast } from './app.js';

const video = document.getElementById('scanner-video');
const statusEl = document.getElementById('scanner-status');

let stream = null;
let detector = null;
let rafId = null;
let active = false;
let onCodeCallback = null;
let lastCode = null;
let lastCodeAt = 0;

function supports() {
  return (
    'BarcodeDetector' in window &&
    !!navigator.mediaDevices &&
    !!navigator.mediaDevices.getUserMedia
  );
}

async function buildDetector() {
  const formats = [
    'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39',
    'upc_a', 'upc_e', 'itf', 'codabar',
  ];
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const useFormats = formats.filter((f) => supported.includes(f));
    return new window.BarcodeDetector({ formats: useFormats.length ? useFormats : undefined });
  } catch {
    return new window.BarcodeDetector();
  }
}

async function tick() {
  if (!active) return;
  try {
    if (video.readyState >= 2) {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        const now = Date.now();
        if (value && (value !== lastCode || now - lastCodeAt > 1500)) {
          lastCode = value;
          lastCodeAt = now;
          statusEl.textContent = `Detected: ${value}`;
          if (onCodeCallback) onCodeCallback(value);
        }
      }
    }
  } catch {
    /* transient detector errors are common; keep scanning */
  }
  rafId = requestAnimationFrame(tick);
}

export async function startScanner(onCode) {
  onCodeCallback = onCode;
  if (!supports()) {
    statusEl.textContent =
      'อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการสแกน Barcode กรุณาปิดหน้าสแกนแล้วกรอกรหัสด้วยตนเอง';
    return false;
  }
  try {
    detector = await buildDetector();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    statusEl.textContent = 'Point camera at a barcode…';
    active = true;
    tick();
    return true;
  } catch (err) {
    statusEl.textContent = 'ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์การใช้กล้องหรือกรอกรหัสด้วยตนเอง';
    toast('ไม่สามารถเปิดกล้องได้');
    return false;
  }
}

export function stopScanner() {
  active = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  lastCode = null;
}
