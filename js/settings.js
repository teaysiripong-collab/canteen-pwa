import * as db from './db.js';
import { toast } from './app.js';
import { loadItems } from './items.js';

const form = document.getElementById('settings-form');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const btnWipe = document.getElementById('btn-wipe');
const importFile = document.getElementById('import-file');

export async function loadSettings() {
  form.elements.syncUrl.value = (await db.getSetting('syncUrl', '')) || '';
  form.elements.syncToken.value = (await db.getSetting('syncToken', '')) || '';
  form.elements.autoSync.checked = !!(await db.getSetting('autoSync', false));
  form.elements.defaultThreshold.value = await db.getSetting('defaultThreshold', 5);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  await db.setSetting('syncUrl', (data.syncUrl || '').trim());
  await db.setSetting('syncToken', (data.syncToken || '').trim());
  await db.setSetting('autoSync', form.elements.autoSync.checked);
  await db.setSetting('defaultThreshold', Number(data.defaultThreshold) || 0);
  toast('Settings saved');
});

btnExport.addEventListener('click', async () => {
  const payload = await db.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `canteen-inventory-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const replace = confirm(
      'Replace existing data with the imported backup?\n\nOK = replace, Cancel = merge'
    );
    await db.importAll(payload, { replace });
    await loadItems();
    toast('Import complete');
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    importFile.value = '';
  }
});

btnWipe.addEventListener('click', async () => {
  if (!confirm('Delete all items, tombstones, and settings? This cannot be undone.')) return;
  await db.wipeAll();
  await loadItems();
  await loadSettings();
  toast('Wiped');
});
