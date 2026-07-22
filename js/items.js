import * as db from './db.js';
import { toast, navigate } from './app.js';

const list = document.getElementById('items-list');
const empty = document.getElementById('empty-state');
const alerts = document.getElementById('alerts');
const search = document.getElementById('search');
const filter = document.getElementById('filter');
const form = document.getElementById('item-form');
const btnDelete = document.getElementById('btn-delete');
const btnCancel = document.getElementById('btn-cancel');
const categoryList = document.getElementById('category-list');
const btnSave = form.querySelector('button[type="submit"]');

let cache = [];
let editingId = null;
let saving = false;

function status(item) {
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= item.threshold) return 'low';
  return 'ok';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderList() {
  const q = search.value.trim().toLowerCase();
  const f = filter.value;
  const filtered = cache.filter((it) => {
    if (q) {
      const hay = `${it.name} ${it.barcode} ${it.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const s = status(it);
    if (f === 'low' && s === 'ok') return false;
    if (f === 'low' && s === 'out') return false;
    if (f === 'out' && s !== 'out') return false;
    return true;
  });
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  list.innerHTML = '';
  for (const it of filtered) {
    const s = status(it);
    const li = document.createElement('li');
    li.className = `item ${s === 'ok' ? '' : s}`;
    li.dataset.id = it.id;
    const sub = [it.category, it.barcode].filter(Boolean).join(' · ');
    const badge =
      s === 'out'
        ? '<span class="badge out">out</span>'
        : s === 'low'
        ? '<span class="badge low">low</span>'
        : '';
    li.innerHTML = `
      <div class="item-main">
        <div class="item-name">${escapeHtml(it.name)}${badge}</div>
        <div class="item-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="item-qty">${it.quantity}<span class="unit">${escapeHtml(it.unit || '')}</span></div>
    `;
    li.addEventListener('click', () => openEditor(it.id));
    list.appendChild(li);
  }

  empty.hidden = cache.length !== 0;

  const lowCount = cache.filter((it) => status(it) !== 'ok').length;
  if (lowCount > 0) {
    alerts.hidden = false;
    alerts.textContent = `${lowCount} item${lowCount === 1 ? '' : 's'} need attention (low or out of stock).`;
  } else {
    alerts.hidden = true;
  }
}

async function refreshCategories() {
  const cats = await db.getCategories();
  categoryList.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

export async function loadItems() {
  cache = await db.getAllItems();
  renderList();
  refreshCategories();
}

export async function openEditor(id) {
  editingId = id || null;
  form.reset();
  btnDelete.hidden = !id;
  if (id) {
    const item = await db.getItem(id);
    if (!item) {
      toast('Item not found');
      return;
    }
    form.elements.id.value = item.id;
    form.elements.name.value = item.name;
    form.elements.barcode.value = item.barcode || '';
    form.elements.category.value = item.category || '';
    form.elements.quantity.value = item.quantity;
    form.elements.unit.value = item.unit || '';
    form.elements.price.value = item.price || 0;
    form.elements.threshold.value = item.threshold ?? 5;
    form.elements.notes.value = item.notes || '';
  } else {
    const defaultThreshold = await db.getSetting('defaultThreshold', 5);
    form.elements.threshold.value = defaultThreshold;
  }
  navigate('editor');
  setTimeout(() => form.elements.name.focus(), 50);
}

export function setBarcodeInEditor(code) {
  form.elements.barcode.value = code;
}

export async function lookupAndOpenByBarcode(code) {
  const existing = await db.findByBarcode(code);
  if (existing) {
    await openEditor(existing.id);
  } else {
    await openEditor(null);
    setBarcodeInEditor(code);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (saving) return;
  const data = Object.fromEntries(new FormData(form).entries());
  if (!data.name || !data.name.trim()) {
    toast('กรุณากรอกชื่อสินค้า');
    return;
  }
  saving = true;
  btnSave.disabled = true;
  try {
    const saved = await db.putItem({
      id: data.id || undefined,
      name: data.name,
      barcode: data.barcode,
      category: data.category,
      quantity: data.quantity,
      unit: data.unit,
      price: data.price,
      threshold: data.threshold,
      notes: data.notes,
    });
    toast(editingId ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มรายการแล้ว');
    editingId = saved.id;
    await loadItems();
    navigate('items');
  } catch (err) {
    toast(err.message || 'บันทึกรายการไม่สำเร็จ');
  } finally {
    saving = false;
    btnSave.disabled = false;
  }
});

btnDelete.addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('ต้องการลบรายการนี้หรือไม่?')) return;
  btnDelete.disabled = true;
  try {
    await db.deleteItem(editingId);
    toast('ลบรายการแล้ว');
    editingId = null;
    await loadItems();
    navigate('items');
  } catch (err) {
    toast(err.message || 'ลบรายการไม่สำเร็จ');
  } finally {
    btnDelete.disabled = false;
  }
});

btnCancel.addEventListener('click', () => navigate('items'));

search.addEventListener('input', renderList);
filter.addEventListener('change', renderList);
