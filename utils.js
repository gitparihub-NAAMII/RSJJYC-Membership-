import { ORG, RULES, PHONE_LOGIN_DOMAIN } from './config.js';

export const DAY = 86400000;

// ---------- formatting ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const npr = (n) => 'NPR ' + Number(n || 0).toLocaleString('en-IN');
export const pad = (n, l = 2) => String(n).padStart(l, '0');
export const isoDate = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const uid = (n = 20) => {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
};
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- age ----------
export function ageOn(dobISO, on = new Date()) {
  const b = new Date(dobISO + 'T00:00:00');
  let y = on.getFullYear() - b.getFullYear();
  let m = on.getMonth() - b.getMonth();
  if (on.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  return { years: y, months: m };
}

// ---------- month keys "YYYY-MM" ----------
export const monthKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
export function addYears(ms, n = 1) { const d = new Date(ms); d.setFullYear(d.getFullYear() + n); return d.getTime(); }

/** All month keys covered by membership periods [{start:'YYYY-MM', months:12}] */
export function periodMonths(periods = []) {
  const set = new Set();
  periods.forEach((p) => { for (let i = 0; i < p.months; i++) set.add(addMonths(p.start, i)); });
  return [...set].sort();
}

// ---------- membership number ----------
export function memberNumber(year, seq, first, last) {
  const yy = String(year).slice(-3);
  return `${yy}-${ORG.memberCode}-${pad(seq, 3)}-${(first[0] || 'X')}${(last[0] || 'X')}`.toUpperCase();
}

// ---------- username -> auth e-mail ----------
export function normalizeUsername(u) {
  u = String(u || '').trim().toLowerCase();
  if (u.includes('@')) return u;
  u = u.replace(/[^\d]/g, '');
  if (u.startsWith('977') && u.length > 10) u = u.slice(3);
  return u;
}
export const authEmailFor = (u) => { u = normalizeUsername(u); return u.includes('@') ? u : `${u}@${PHONE_LOGIN_DOMAIN}`; };

// ---------- ledger ----------
/**
 * Month-by-month contribution sheet.
 * status: paid | waived | pending | waiver-pending | due | missed | upcoming
 */
export function buildLedger(member, payments = [], waivers = [], now = new Date()) {
  const cur = monthKey(now);
  const months = periodMonths(member.periods);
  const map = {};
  const mark = (list, okStatus, pendStatus) => list.forEach((x) => {
    if (x.status === 'rejected') return;
    (x.months || []).forEach((m) => {
      const s = x.status === 'approved' ? okStatus : pendStatus;
      if (!map[m] || rank(s) > rank(map[m].status)) map[m] = { status: s, ref: x };
    });
  });
  const rank = (s) => ({ paid: 5, waived: 4, pending: 3, 'waiver-pending': 2 }[s] || 0);
  mark(waivers, 'waived', 'waiver-pending');
  mark(payments, 'paid', 'pending');

  const rows = months.map((m) => {
    let status = map[m]?.status;
    if (!status) status = m > cur ? 'upcoming' : m === cur ? 'due' : 'missed';
    return { month: m, label: monthLabel(m), amount: member.pledge, status };
  });

  const paidTotal = payments.filter((p) => p.status === 'approved').reduce((a, p) => a + Number(p.amount || 0), 0);
  const count = (s) => rows.filter((r) => r.status === s).length;
  const outstandingRows = rows.filter((r) => ['missed', 'due'].includes(r.status));
  const outstanding = outstandingRows.reduce((a, r) => a + r.amount, 0);
  const upcoming = rows.filter((r) => r.status === 'upcoming').reduce((a, r) => a + r.amount, 0);
  const pendingAmt = rows.filter((r) => r.status === 'pending').reduce((a, r) => a + r.amount, 0);

  // paidThrough = last month of the unbroken covered (paid/waived) run
  let paidThrough = null;
  for (const r of rows) { if (r.status === 'paid' || r.status === 'waived') paidThrough = r.month; else break; }

  return {
    rows, paidTotal, outstanding, upcoming, pendingAmt, paidThrough,
    missed: count('missed'), due: count('due'), pending: count('pending') + count('waiver-pending'),
    allClear: outstandingRows.length === 0 && count('pending') === 0 && count('waiver-pending') === 0,
    totalCommitment: rows.reduce((a, r) => a + r.amount, 0),
  };
}

// ---------- card status (shared by dashboard + public QR page) ----------
export function cardStatus({ expiryMs, periods, paidThrough }, now = new Date()) {
  const daysLeft = Math.ceil((expiryMs - now.getTime()) / DAY);
  const cur = monthKey(now);
  const unpaidPast = periodMonths(periods).filter((m) => m < cur && (!paidThrough || m > paidThrough)).length;
  if (daysLeft <= 0) return { code: 'expired', label: 'EXPIRED', reason: 'Membership period has ended', daysLeft, unpaidPast };
  if (unpaidPast >= RULES.suspendAfterMissedMonths)
    return { code: 'expired', label: 'EXPIRED', reason: `Contribution unpaid for ${unpaidPast} months`, daysLeft, unpaidPast };
  if (daysLeft <= RULES.expiringSoonDays) return { code: 'expiring', label: 'EXPIRING SOON', reason: `Expires in ${daysLeft} day(s)`, daysLeft, unpaidPast };
  if (unpaidPast > 0) return { code: 'expiring', label: 'PAYMENT DUE', reason: `${unpaidPast} month(s) contribution pending`, daysLeft, unpaidPast };
  return { code: 'active', label: 'ACTIVE', reason: `Valid for ${daysLeft} more day(s)`, daysLeft, unpaidPast };
}

// ---------- image ----------
export function compressImage(file, maxW = 420, maxH = 520, quality = 0.85) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Invalid image'));
      img.onload = () => {
        // centre-crop to 4:5 portrait
        const ratio = 4 / 5;
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (sw / sh > ratio) { sw = sh * ratio; sx = (img.width - sw) / 2; } else { sh = sw / ratio; sy = (img.height - sh) / 2; }
        const w = Math.min(maxW, sw), h = w / ratio;
        const c = document.createElement('canvas');
        c.width = w; c.height = Math.min(h, maxH);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', quality));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/** Payment receipt -> { data, type, name }. Images are shrunk; PDFs must be small (database limit). */
export function readReceipt(file) {
  return new Promise((res, rej) => {
    const isImg = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type);
    const isPdf = file.type === 'application/pdf';
    if (!isImg && !isPdf) return rej(new Error('Receipt must be a photo/screenshot (JPG, PNG) or a PDF.'));
    if (isPdf && file.size > 600 * 1024) return rej(new Error('PDF receipt is too large (max 600 KB). Please upload a screenshot or photo instead.'));
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Could not read that file'));
    fr.onload = () => {
      if (isPdf) return res({ data: fr.result, type: 'pdf', name: file.name });
      const img = new Image();
      img.onerror = () => rej(new Error('Could not read that file'));
      img.onload = () => {
        const s = Math.min(1, 1400 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        res({ data: c.toDataURL('image/jpeg', 0.8), type: 'image', name: file.name });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/** Open a receipt (from store.getReceipt) in a viewer modal */
export function showReceipt(r) {
  if (!r) return toast('Receipt not found', 'error');
  let pdfUrl = '';
  if (r.type === 'pdf') {
    const bin = atob(r.data.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }
  modal(`<h3>🧾 Payment receipt</h3>${r.type === 'pdf'
    ? `<iframe src="${pdfUrl}" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px"></iframe>`
    : `<img src="${r.data}" alt="Receipt" style="width:100%;border-radius:10px;border:1px solid var(--line)">`}
    <div class="dl-row"><a class="btn btn-sm btn-ghost" href="${r.data}" download="${esc(r.name || 'receipt')}">⬇ Download receipt</a></div>`, { wide: true });
}

// ---------- UI helpers ----------
export function toast(msg, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

export function modal(html, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
    <button class="modal-x" aria-label="Close">&times;</button>${html}</div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.classList.contains('modal-x') || e.target.dataset.close !== undefined) close(); });
  document.body.appendChild(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

export const STATUS_TEXT = {
  paid: 'Paid', waived: 'Waived', pending: 'Payment pending verification', 'waiver-pending': 'Waiver requested',
  due: 'Due this month', missed: 'Missed', upcoming: 'Upcoming',
};
