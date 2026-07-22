const VIEWS = ['items', 'editor', 'scanner', 'settings'];

const toastEl = document.getElementById('toast');
let toastTimer = null;

export function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

export function navigate(view) {
  if (!VIEWS.includes(view)) view = 'items';
  for (const v of VIEWS) {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('active', v === view);
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  document.getElementById('fab').hidden = view !== 'items';

  if (view === 'scanner') startScannerView();
  else stopScannerView();
}

import { loadItems, openEditor, lookupAndOpenByBarcode } from './items.js';
import { startScanner, stopScanner } from './scanner.js';
import { syncNow, maybeAutoSync } from './sync.js';
import { loadSettings } from './settings.js';

let scannerMode = 'lookup';

async function startScannerView() {
  await startScanner(async (code) => {
    if (scannerMode === 'field') {
      const { setBarcodeInEditor } = await import('./items.js');
      setBarcodeInEditor(code);
      stopScannerView();
      navigate('editor');
      toast(`Scanned: ${code}`);
    } else {
      stopScannerView();
      toast(`Scanned: ${code}`);
      lookupAndOpenByBarcode(code);
    }
  });
}

function stopScannerView() {
  stopScanner();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    scannerMode = 'lookup';
    navigate(tab.dataset.view);
  });
});

document.getElementById('fab').addEventListener('click', () => openEditor(null));

document.getElementById('btn-sync').addEventListener('click', async () => {
  try {
    await syncNow();
    await loadItems();
  } catch (err) {
    toast(err.message || 'Sync failed');
  }
});

document.getElementById('btn-scan-field').addEventListener('click', () => {
  scannerMode = 'field';
  navigate('scanner');
});

document.getElementById('btn-scan-close').addEventListener('click', () => {
  stopScannerView();
  navigate(scannerMode === 'field' ? 'editor' : 'items');
});

window.addEventListener('online', () => maybeAutoSync());

async function init() {
  await loadItems();
  await loadSettings();
  navigate('items');
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch {
      /* ignore registration failure (e.g. dev over file://) */
    }
  }
  maybeAutoSync();
}

init().catch((err) => {
  console.error('เริ่มต้นระบบไม่สำเร็จ', err);
  toast('เปิดระบบไม่สำเร็จ กรุณารีเฟรชแล้วลองอีกครั้ง');
});
