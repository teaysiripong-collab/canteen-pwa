import * as db from './db.js';

const statusEl = document.getElementById('sync-status');

function setStatus(state, label) {
  statusEl.className = `sync-status ${state}`;
  statusEl.textContent = label;
}

function updateOnlineStatus() {
  if (statusEl.classList.contains('syncing') || statusEl.classList.contains('error')) return;
  if (navigator.onLine) setStatus('online', 'online');
  else setStatus('', 'offline');
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

export async function syncNow({ silent = false } = {}) {
  const url = (await db.getSetting('syncUrl', '')) || '';
  if (!url) {
    if (!silent) throw new Error('No sync endpoint configured');
    return { skipped: true };
  }
  const token = (await db.getSetting('syncToken', '')) || '';
  const lastSyncAt = (await db.getSetting('lastSyncAt', 0)) || 0;

  setStatus('syncing', 'syncing…');
  try {
    const [items, tombstones] = await Promise.all([
      db.getAllItems(),
      db.getTombstones(),
    ]);
    const changes = items.filter((i) => (i.updatedAt || 0) > lastSyncAt);

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        since: lastSyncAt,
        changes,
        deletions: tombstones,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data.changes)) {
      for (const remote of data.changes) {
        if (!remote || !remote.id) continue;
        const local = await db.getItem(remote.id);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
          await db.putItem(remote);
        }
      }
    }
    if (Array.isArray(data.deletions)) {
      for (const tomb of data.deletions) {
        if (!tomb || !tomb.id) continue;
        const local = await db.getItem(tomb.id);
        if (local && (tomb.deletedAt || 0) >= (local.updatedAt || 0)) {
          await db.deleteItem(local.id);
        }
      }
    }

    if (Array.isArray(data.ackTombstones) && data.ackTombstones.length) {
      await db.clearTombstones(data.ackTombstones);
    }

    const serverTime = Number(data.serverTime) || Date.now();
    await db.setSetting('lastSyncAt', serverTime);

    setStatus('online', `synced ${new Date(serverTime).toLocaleTimeString()}`);
    setTimeout(updateOnlineStatus, 4000);
    return { ok: true };
  } catch (err) {
    setStatus('error', 'sync failed');
    setTimeout(updateOnlineStatus, 4000);
    if (!silent) throw err;
    return { ok: false, error: err };
  }
}

export async function maybeAutoSync() {
  if (!navigator.onLine) return;
  const auto = await db.getSetting('autoSync', false);
  const url = await db.getSetting('syncUrl', '');
  if (auto && url) syncNow({ silent: true });
}
