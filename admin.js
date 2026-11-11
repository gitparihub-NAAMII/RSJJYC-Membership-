import { MEMBER_TYPES, RULES } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { tr } from './i18n.js';
import { mountCard, downloadButtons, wireDownloads } from './card.js';
import { buildLedger, cardStatus, esc, npr, fmtDate, isoDate, modal, toast, monthKey, addMonths, monthLabel, STATUS_TEXT, DAY, showReceipt, setModalDefaults } from './utils.js';
// Admin popups close only with the ✕ button (clicking outside does nothing)
setModalDefaults({ backdropClose: false });
import { nextDue, milestone, adminMessage } from './reminders.js';
import { changesTable } from './changereq.js';
import { mountBell, phoneNotify } from './notify.js';
const needsReview = (p) => p.status === 'pending' || (p.status === 'approved' && p.reviewed === false);

const store = await initPage();
const sess = await store.session();
if (!sess || sess.role !== 'admin') { location.replace('index.html#admin'); throw new Error('redirect'); }
document.getElementById('logout').onclick = async () => { await store.logout(); location.href = 'index.html'; };

const view = document.getElementById('view');
let members = [], payments = [], waivers = [], changeReqs = [], current = 'overview';
const charts = [];
// shared filters: year / month apply to members (join date) and payments (payment date)
const filt = { q: '', chip: 'all', from: '', to: '', type: '', year: '', month: '' };
const pfilt = { q: '', status: '' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function load() {
  [members, payments, waivers, changeReqs] = await Promise.all([store.listMembers(), store.listPayments(), store.listWaivers(), store.listChangeRequests().catch(() => [])]);
  members.forEach(enrich);
  members.sort((a, b) => b.joinMs - a.joinMs);
  const pend = payments.filter(needsReview).length + waivers.filter((w) => w.status === 'pending').length + changeReqs.filter((c) => c.status === 'pending').length;
  const b = document.getElementById('apBadge'); b.hidden = !pend; b.textContent = pend;
  const nRem = toRemind().length; const rb = document.getElementById('rmBadge'); rb.hidden = !nRem; rb.textContent = nRem;
  refreshAdminBell();
  show(current);
  goLive();
}

// ---------- real-time updates (no refresh needed) ----------
let live = false, livePending = false;
// don't redraw under the admin's hands: a popup is open or they are typing in the page
const busy = () => !!document.querySelector('.modal-backdrop')
  || (view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))
  || [...view.querySelectorAll('textarea')].some((t) => t.value.trim());
async function liveRefresh() {
  const before = new Set(adminItems().map((i) => i.id));
  [members, payments, waivers, changeReqs] = await Promise.all([store.listMembers(), store.listPayments(), store.listWaivers(), store.listChangeRequests().catch(() => [])]);
  members.forEach(enrich);
  members.sort((a, b) => b.joinMs - a.joinMs);
  const pend = payments.filter(needsReview).length + waivers.filter((w) => w.status === 'pending').length + changeReqs.filter((c) => c.status === 'pending').length;
  const b = document.getElementById('apBadge'); b.hidden = !pend; b.textContent = pend;
  const nRem = toRemind().length; const rb = document.getElementById('rmBadge'); rb.hidden = !nRem; rb.textContent = nRem;
  refreshAdminBell();
  adminItems().filter((i) => !before.has(i.id)).forEach((i) => toast(`${i.icon} ${i.title}`, 'info'));
  if (current === 'announce') return; // that page has nothing that changes from member actions
  if (busy()) { livePending = true; return; }
  livePending = false;
  const y = window.scrollY; show(current); window.scrollTo(0, y);
}
function goLive() {
  if (live) return; live = true;
  let t;
  const kick = () => { clearTimeout(t); t = setTimeout(() => liveRefresh().catch(() => {}), 400); };
  const after = () => { let first = true; return () => { if (first) { first = false; return; } kick(); }; };
  ['members', 'payments', 'waivers', 'changeRequests'].forEach((col) => store.watch(col, null, after()));
  // apply held-back updates once the admin closes the popup / leaves the field
  setInterval(() => { if (livePending && !busy()) { livePending = false; const y = window.scrollY; show(current); window.scrollTo(0, y); } }, 1500);
}
function enrich(m) {
  m._L = buildLedger(m, payments.filter((p) => p.uid === m.uid), waivers.filter((w) => w.uid === m.uid));
  m._S = cardStatus({ ...m, paidThrough: m._L.paidThrough });
  return m;
}

function go(viewName) {
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('on', x.dataset.view === viewName));
  show(viewName);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view);
});
function show(v) {
  current = v;
  charts.splice(0).forEach((c) => c.destroy());
  ({ overview, members: membersView, approvals, payments: paymentsView, reminders: remindersView, announce: announceView })[v]();
}

// ---------- year / month helpers ----------
const inYM = (d) => {
  if (!filt.year && !filt.month) return true;
  const k = monthKey(d); const [y, m] = k.split('-');
  return (!filt.year || y === filt.year) && (!filt.month || m === filt.month);
};
function yearOptions() {
  const ys = new Set([String(new Date().getFullYear())]);
  members.forEach((m) => ys.add(String(new Date(m.joinMs).getFullYear())));
  payments.forEach((p) => ys.add(p.createdAt.slice(0, 4)));
  return [...ys].sort().reverse();
}
const ymControls = () => `
  <label class="f">Year<select class="fYear"><option value="">All years</option>${yearOptions().map((y) => `<option value="${y}" ${filt.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
  <label class="f">Month<select class="fMonth"><option value="">All months</option>${MONTHS.map((m, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}" ${filt.month === v ? 'selected' : ''}>${m}</option>`; }).join('')}</select></label>`;
function wireYM(root, redraw) {
  root.querySelector('.fYear').onchange = (e) => { filt.year = e.target.value; redraw(); };
  root.querySelector('.fMonth').onchange = (e) => { filt.month = e.target.value; redraw(); };
}
const ymLabel = () => [filt.month ? MONTHS[+filt.month - 1] : '', filt.year].filter(Boolean).join(' ') || 'all-time';

// ============================ GLOBAL SEARCH ============================
const gIn = document.getElementById('gSearch'), gRes = document.getElementById('gResults');
const matches = (m, q) => [m.fullName, m.username, m.phone, m.email, m.memberNo].join(' ').toLowerCase().includes(q);
gIn.addEventListener('input', () => {
  const q = gIn.value.trim().toLowerCase();
  if (!q) { gRes.hidden = true; return; }
  const hits = members.filter((m) => matches(m, q)).slice(0, 8);
  gRes.hidden = false;
  gRes.innerHTML = hits.length
    ? hits.map((m) => `<button type="button" class="gs-item ${rowClass(m)}" data-uid="${esc(m.uid)}"><img class="av" src="${m.photo || ''}" alt=""><span><b>${esc(m.fullName)}</b><small>${esc(m.memberNo)} · ${esc(m.username || m.phone)}</small></span><span class="pill ${m._S.code}">${m._S.label}</span></button>`).join('')
      + `<button type="button" class="gs-all">See all results in Members</button>`
    : '<div class="empty" style="padding:14px">No members match.</div>';
});
gRes.addEventListener('click', (e) => {
  const it = e.target.closest('[data-uid]');
  if (it) { gRes.hidden = true; memberModal(members.find((m) => m.uid === it.dataset.uid)); return; }
  if (e.target.closest('.gs-all')) { filt.q = gIn.value.trim(); gRes.hidden = true; go('members'); }
});
gIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filt.q = gIn.value.trim(); gRes.hidden = true; go('members'); } if (e.key === 'Escape') gRes.hidden = true; });
document.addEventListener('click', (e) => { if (!e.target.closest('.gsearch')) gRes.hidden = true; });
document.getElementById('xlsBtn').onclick = () => exportExcel();

// ============================ OVERVIEW ============================
function overview() {
  const now = new Date(), cm = monthKey(now), today = isoDate(now);
  const approved = payments.filter((p) => p.status === 'approved');
  const raised = approved.reduce((a, p) => a + p.amount, 0);
  const newToday = members.filter((m) => isoDate(m.joinMs) === today).length;
  const newThisMonth = members.filter((m) => monthKey(m.joinMs) === cm).length;
  const cnt = (c) => members.filter((m) => m._S.code === c || (c === 'expired' && m._S.code === 'inactive')).length;
  const owing = members.filter((m) => m._L.outstanding > 0);
  const dues = owing.reduce((a, m) => a + m._L.outstanding, 0);
  const pend = payments.filter(needsReview).length + waivers.filter((w) => w.status === 'pending').length + changeReqs.filter((c) => c.status === 'pending').length;
  const alert = (n) => (n > 0 ? 'red alert' : 'green');

  view.innerHTML = `
    <p class="hint" style="margin:0 0 10px">Tip: click any number to see the people behind it.</p>
    <div class="stats">
      <div class="stat green click" data-go="payments"><span>Total money raised</span><b>${npr(raised)}</b><small>${approved.length} verified payment(s)</small></div>
      <div class="stat click" data-go="members:all"><span>Total members</span><b>${members.length}</b><small>${cnt('active')} active</small></div>
      <div class="stat crimson click" data-go="members:today"><span>Registered today</span><b>${newToday}</b><small>${fmtDate(now)}</small></div>
      <div class="stat crimson click" data-go="members:thismonth"><span>New members (this month)</span><b>${newThisMonth}</b><small>${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</small></div>
      <div class="stat ${alert(cnt('expiring'))} click" data-go="members:expiring"><span>About to expire / due</span><b>${cnt('expiring')}</b><small>within ${RULES.expiringSoonDays} days or payment due</small></div>
      <div class="stat ${alert(cnt('expired'))} click" data-go="members:expired"><span>Expired</span><b>${cnt('expired')}</b><small>date passed or ${RULES.suspendAfterMissedMonths}+ months unpaid</small></div>
      <div class="stat ${alert(owing.length)} click" data-go="members:owing"><span>Outstanding dues</span><b>${npr(dues)}</b><small>${owing.length} member(s) owing</small></div>
      <div class="stat ${pend ? 'amber' : 'green'} click" data-go="approvals"><span>Pending approvals</span><b>${pend}</b><small>review now →</small></div>
    </div>
    <div class="charts">
      <div class="panel"><h3>Money raised &amp; new members — last 12 months</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="panel"><h3>Membership status</h3><div class="chart-box"><canvas id="c2"></canvas></div></div>
    </div>
    <div class="charts">
      <div class="panel"><h3>Members by profession</h3><div class="chart-box"><canvas id="c3"></canvas></div></div>
      <div class="panel"><h3>Dues: paid-up vs owing</h3><div class="chart-box"><canvas id="c4"></canvas></div></div>
    </div>
    <div class="panel"><h3>Members needing attention</h3>${memberTable(members.filter((m) => m._S.code !== 'active' || m._L.outstanding).slice(0, 15))}</div>`;
  view.querySelectorAll('[data-go]').forEach((s) => (s.onclick = () => {
    const [v, chip] = s.dataset.go.split(':');
    if (chip) Object.assign(filt, { chip, q: '', from: '', to: '', type: '', year: '', month: '' });
    go(v);
  }));
  wireRows(view);

  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.font.family = document.documentElement.lang === 'ne' ? 'Mukta, Poppins, sans-serif' : 'Poppins, sans-serif';
  Chart.defaults.color = css.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--line').trim();
  Chart.defaults.elements.arc.borderColor = css.getPropertyValue('--surface').trim();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cm, i - 11));
  const raisedBy = months.map((k) => approved.filter((p) => monthKey(p.paidAt || p.reviewedAt || p.createdAt) === k).reduce((a, p) => a + p.amount, 0));
  const joinedBy = months.map((k) => members.filter((m) => monthKey(m.joinMs) === k).length);
  const toMonth = (i) => { const [y, m] = months[i].split('-'); Object.assign(filt, { year: y, month: m }); };
  charts.push(new Chart(view.querySelector('#c1'), {
    data: { labels: months.map(monthLabel).map(tr), datasets: [
      { type: 'bar', label: tr('Money raised (NPR)'), data: raisedBy, backgroundColor: 'rgba(22,163,74,.75)', borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: tr('New members'), data: joinedBy, borderColor: '#c8102e', backgroundColor: '#c8102e', tension: .2, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      onClick: (_, el) => { if (!el[0]) return; toMonth(el[0].index); Object.assign(filt, { chip: 'all', q: '' }); go(el[0].datasetIndex === 0 ? 'payments' : 'members'); },
      scales: { y: { beginAtZero: true, title: { display: true, text: tr('NPR') } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 }, title: { display: true, text: tr('Members') } } } },
  }));
  charts.push(new Chart(view.querySelector('#c2'), {
    type: 'doughnut',
    data: { labels: ['Active', 'Expiring / due', 'Expired'].map(tr), datasets: [{ data: [cnt('active'), cnt('expiring'), cnt('expired')], backgroundColor: ['#16a34a', '#d97706', '#dc2626'] }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } },
      onClick: (_, el) => { if (el[0]) { Object.assign(filt, { chip: ['active', 'expiring', 'expired'][el[0].index], year: '', month: '' }); go('members'); } } },
  }));
  const prof = {};
  members.forEach((m) => { const k = m.profession.startsWith('Other') ? 'Other' : m.profession; prof[k] = (prof[k] || 0) + 1; });
  const pk = Object.keys(prof).sort((a, b) => prof[b] - prof[a]);
  charts.push(new Chart(view.querySelector('#c3'), {
    type: 'bar', data: { labels: pk.map(tr), datasets: [{ label: tr('Members'), data: pk.map((k) => prof[k]), backgroundColor: '#3466c2', borderRadius: 6 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      onClick: (_, el) => { if (el[0]) { Object.assign(filt, { chip: 'all', q: pk[el[0].index], year: '', month: '' }); go('members'); } } },
  }));
  const clear = members.filter((m) => !m._L.outstanding).length;
  charts.push(new Chart(view.querySelector('#c4'), {
    type: 'pie', data: { labels: ['Paid-up', 'Owing dues'].map(tr), datasets: [{ data: [clear, owing.length], backgroundColor: ['#16a34a', '#dc2626'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } },
      onClick: (_, el) => { if (el[0]) { Object.assign(filt, { chip: el[0].index ? 'owing' : 'clear', year: '', month: '' }); go('members'); } } },
  }));
}

// ============================ MEMBERS ============================
const CHIPS = [['all', 'All'], ['today', 'Registered today'], ['thismonth', 'This month'], ['new', 'New members (30 days)'], ['active', 'Active'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['inactive', 'Inactive (receipt rejected)'], ['owing', 'Has dues'], ['clear', 'Paid-up']];
function filtered() {
  const now = Date.now(), today = isoDate(new Date()), cm = monthKey(new Date());
  return members.filter((m) => {
    if (filt.q) { const q = filt.q.toLowerCase(); if (![m.fullName, m.memberNo, m.phone, m.email, m.username, m.profession].join(' ').toLowerCase().includes(q)) return false; }
    if (filt.type && m.memberType !== filt.type) return false;
    if (filt.from && isoDate(m.joinMs) < filt.from) return false;
    if (filt.to && isoDate(m.joinMs) > filt.to) return false;
    if (!inYM(m.joinMs)) return false;
    switch (filt.chip) {
      case 'today': return isoDate(m.joinMs) === today;
      case 'thismonth': return monthKey(m.joinMs) === cm;
      case 'new': return now - m.joinMs <= 30 * DAY;
      case 'active': case 'expiring': case 'inactive': return m._S.code === filt.chip;
      case 'expired': return m._S.code === 'expired' || m._S.code === 'inactive';
      case 'owing': return m._L.outstanding > 0;
      case 'clear': return !m._L.outstanding;
      default: return true;
    }
  });
}
function membersView() {
  view.innerHTML = `
    <div class="panel">
      <div class="filters">
        <label class="f" style="flex:2">Search<input id="fq" placeholder="Name, username, phone, member no.…" value="${esc(filt.q)}"></label>
        ${ymControls()}
        <label class="f">Joined from<input type="date" id="ffrom" value="${filt.from}"></label>
        <label class="f">Joined to<input type="date" id="fto" value="${filt.to}"></label>
        <label class="f">Member type<select id="ftype"><option value="">All types</option>${MEMBER_TYPES.map((t) => `<option value="${t}" ${filt.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn btn-ghost" id="fclear">Reset</button>
        <button class="btn btn-green" id="xlsM">⬇ Download Excel</button>
      </div>
      <div class="chips" id="chips">${CHIPS.map(([k, l]) => `<button data-chip="${k}" class="${filt.chip === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="hint" id="count"></p>
      <div id="tbl"></div>
    </div>`;
  const draw = () => { const list = filtered(); view.querySelector('#count').textContent = `${list.length} of ${members.length} member(s)`; view.querySelector('#tbl').innerHTML = memberTable(list); wireRows(view); };
  view.querySelector('#fq').oninput = (e) => { filt.q = e.target.value; draw(); };
  view.querySelector('#ffrom').onchange = (e) => { filt.from = e.target.value; draw(); };
  view.querySelector('#fto').onchange = (e) => { filt.to = e.target.value; draw(); };
  view.querySelector('#ftype').onchange = (e) => { filt.type = e.target.value; draw(); };
  wireYM(view, draw);
  view.querySelector('#chips').onclick = (e) => { const b = e.target.closest('[data-chip]'); if (!b) return; filt.chip = b.dataset.chip; view.querySelectorAll('#chips button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  view.querySelector('#fclear').onclick = () => { Object.assign(filt, { q: '', chip: 'all', from: '', to: '', type: '', year: '', month: '' }); membersView(); };
  view.querySelector('#xlsM').onclick = () => exportExcel();
  draw();
}

// expiring soon and members with dues are highlighted red
const rowClass = (m) => (m._S.code !== 'active' || m._L.outstanding ? 'row-red' : 'row-green');
function memberTable(list) {
  if (!list.length) return '<div class="empty">No members match.</div>';
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>Member no.</th><th>Name</th><th>Type</th><th>Phone</th><th>Joined</th><th>Expires</th><th>Monthly</th><th>Paid</th><th>Dues</th><th>Status</th></tr></thead><tbody>
    ${list.map((m) => `<tr class="click ${rowClass(m)}" data-uid="${esc(m.uid)}">
      <td><img class="av" src="${m.photo || ''}" alt=""></td><td class="mono">${esc(m.memberNo)}</td><td><b>${esc(m.fullName)}</b><br><small class="hint">${esc(m.username || '')}</small></td>
      <td>${esc(m.memberType)}</td><td>${esc(m.phone)}</td><td>${fmtDate(m.joinMs)}</td><td>${fmtDate(m.expiryMs)}<br><small class="hint">${m._S.daysLeft > 0 ? m._S.daysLeft + ' days' : 'expired'}</small></td>
      <td>${npr(m.pledge)}</td><td style="color:var(--green);font-weight:600">${npr(m._L.paidTotal)}</td>
      <td style="color:${m._L.outstanding ? 'var(--red)' : 'var(--green)'};font-weight:600">${npr(m._L.outstanding)}</td>
      <td><span class="pill ${m._S.code}">${m._S.label}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}
function wireRows(root) { root.querySelectorAll('tr[data-uid]').forEach((r) => (r.onclick = () => memberModal(members.find((m) => m.uid === r.dataset.uid)))); }

const addrText = (x = {}) => esc([x.tole, x.municipality && `${x.municipality}-${x.ward}`, x.district, x.province].filter(Boolean).join(', '));
function memberModal(m) {
  const { el, close } = modal(`
    <h3>${esc(m.fullName)} <span class="pill ${m._S.code}">${m._S.label}</span></h3>
    <div class="dash" style="grid-template-columns:380px 1fr">
      <div><div id="mCard"></div>${downloadButtons()}
        <label class="f" style="margin-top:16px">Member type (shown on card)
          <div style="display:flex;gap:8px"><select id="mType">${MEMBER_TYPES.map((t) => `<option value="${t}" ${t === m.memberType ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn btn-sm" id="mTypeSave">Save</button></div></label>
        <p class="hint" style="margin-top:12px">🔒 Admins can view member details but cannot edit or delete members.</p>
      </div>
      <div>
        <dl class="kv">
          <dt>Member no.</dt><dd class="mono">${esc(m.memberNo)}</dd><dt>Member type</dt><dd>${esc(m.memberType)}</dd>
          <dt>DOB</dt><dd>${fmtDate(m.dob)} · ${esc(m.dobBS || '')} BS · age ${m.ageAtApplication} at joining</dd>
          <dt>Gender</dt><dd>${esc(m.gender || '—')}</dd><dt>Blood group</dt><dd>${esc(m.bloodGroup || '—')}</dd><dt>Profession</dt><dd>${esc(m.profession)}</dd>
          <dt>Phone / e-mail</dt><dd>${esc(m.phone)} ${m.email ? '· ' + esc(m.email) : ''}</dd><dt>Username</dt><dd>${esc(m.username)}</dd>
          <dt>Permanent</dt><dd>${addrText(m.permanentAddress)}</dd><dt>Temporary</dt><dd>${addrText(m.temporaryAddress)}</dd>
          <dt>Joined / expires</dt><dd>${fmtDate(m.joinMs)} → ${fmtDate(m.expiryMs)} (${(m.renewals || []).length} renewal(s))</dd>
          <dt>Pledge</dt><dd>${npr(m.pledge)} / month</dd><dt>Paid / dues</dt><dd><span style="color:var(--green)">${npr(m._L.paidTotal)}</span> / <span style="color:var(--red)">${npr(m._L.outstanding)}</span></dd>
        </dl>
        <div class="sheet ${m._L.outstanding ? 'owing' : 'clear'}" style="margin-top:14px"><div class="months">${m._L.rows.map((r) => `<div class="mo ${r.status}"><b>${r.label}</b><span>${STATUS_TEXT[r.status]}</span></div>`).join('')}</div></div>
      </div>
    </div>`, { wide: true });
  const data = cardData(m, m._L.paidThrough);
  mountCard(el.querySelector('#mCard'), data);
  wireDownloads(el, () => data);
  el.querySelector('#mTypeSave').onclick = async () => {
    const t = el.querySelector('#mType').value;
    try { await store.updateMember(m.uid, { memberType: t }); await store.updatePublicCard(m.cardToken, { memberType: t }); tellMember(m.uid, { icon: '🎖️', type: 'memberType', title: 'Your member type was updated', body: `You are now listed as ${t}. Your membership card shows the new type.` }); toast('Member type updated', 'success'); close(); load(); }
    catch (e) { toast(friendlyError(e), 'error'); }
  };
}

// ============================ EXCEL EXPORT ============================
function exportExcel() {
  if (!window.XLSX) return toast('Excel library did not load. Check your internet connection.', 'error');
  const X = window.XLSX;
  const mList = members.filter((m) => inYM(m.joinMs));
  const pList = payments.filter((p) => inYM(p.paidAt || p.createdAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const wList = waivers.filter((w) => inYM(w.createdAt));
  const byUid = Object.fromEntries(members.map((m) => [m.uid, m]));
  const addr = (a = {}) => [a.tole, a.municipality && `${a.municipality}-${a.ward}`, a.district, a.province].filter(Boolean).join(', ');
  const sheet = (rows, widths) => { const s = X.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records for this period' }]); s['!cols'] = widths.map((w) => ({ wch: w })); return s; };

  const membersRows = mList.map((m) => ({
    'Member No': m.memberNo, 'Full name': m.fullName, Username: m.username, Phone: m.phone, 'E-mail': m.email || '',
    Gender: m.gender || '', 'Blood group': m.bloodGroup || '', 'DOB (AD)': m.dob, 'DOB (BS)': m.dobBS || '', 'Age at joining': m.ageAtApplication,
    Profession: m.profession, 'Member type': m.memberType, 'Monthly (NPR)': m.pledge,
    Joined: isoDate(m.joinMs), Expires: isoDate(m.expiryMs), Status: m._S.label, 'Status reason': m._S.reason,
    'Total paid (NPR)': m._L.paidTotal, 'Dues (NPR)': m._L.outstanding, 'Missed months': m._L.missed,
    'Permanent address': addr(m.permanentAddress), 'Temporary address': addr(m.temporaryAddress),
  }));
  const paymentRows = pList.map((p) => ({
    Date: (p.paidAt || p.createdAt).slice(0, 10), 'Member No': p.memberNo, Name: p.name, Phone: byUid[p.uid]?.phone || '',
    'Months covered': p.months.map(monthLabel).join(', '), 'Amount (NPR)': p.amount, Method: p.method || '', 'Transaction ID': p.ref || '',
    Status: p.status === 'approved' ? 'Paid' : p.status, 'Receipt uploaded': p.hasReceipt ? 'Yes' : 'No',
    'Checked by admin': p.reviewed === false ? 'Not yet' : (p.reviewedAt ? 'Yes' : '—'), 'Admin note': p.adminNote || '',
  }));
  // month-by-month record: one row per member, one column per month
  let monthsAll = [...new Set(members.flatMap((m) => m._L.rows.map((r) => r.month)))].sort();
  if (filt.year) monthsAll = monthsAll.filter((k) => k.startsWith(filt.year));
  if (filt.month) monthsAll = monthsAll.filter((k) => k.endsWith('-' + filt.month));
  const ledgerRows = members.map((m) => {
    const row = { 'Member No': m.memberNo, Name: m.fullName, 'Monthly (NPR)': m.pledge };
    const map = Object.fromEntries(m._L.rows.map((r) => [r.month, r.status]));
    monthsAll.forEach((k) => { row[monthLabel(k)] = map[k] ? STATUS_TEXT[map[k]] : ''; });
    row['Total paid (NPR)'] = m._L.paidTotal; row['Dues (NPR)'] = m._L.outstanding;
    return row;
  });
  const waiverRows = wList.map((w) => ({
    Requested: w.createdAt.slice(0, 10), 'Member No': w.memberNo, Name: w.name, 'Months': w.months.map(monthLabel).join(', '),
    'Amount (NPR)': w.amount, 'Member reason': w.reason, Decision: w.status, 'Admin reason': w.adminReason || '', Decided: (w.reviewedAt || '').slice(0, 10),
  }));
  const paidSum = pList.filter((p) => p.status === 'approved').reduce((a, p) => a + p.amount, 0);
  const summary = [
    ['Royal Star Jan Jyoti Youth Club — membership report'], ['Period', ymLabel()], ['Generated', new Date().toLocaleString('en-GB')], [],
    ['Members joined in period', mList.length], ['Total members (all time)', members.length],
    ['Active', members.filter((m) => m._S.code === 'active').length], ['Expiring soon / payment due', members.filter((m) => m._S.code === 'expiring').length],
    ['Expired', members.filter((m) => m._S.code === 'expired').length], [],
    ['Payments in period', pList.length], ['Money raised in period (NPR)', paidSum],
    ['Receipts not yet checked', pList.filter(needsReview).length], ['Rejected payments', pList.filter((p) => p.status === 'rejected').length],
    ['Outstanding dues now (NPR)', members.reduce((a, m) => a + m._L.outstanding, 0)], ['Waiver requests in period', wList.length],
  ];
  const wb = X.utils.book_new();
  const s0 = X.utils.aoa_to_sheet(summary); s0['!cols'] = [{ wch: 34 }, { wch: 28 }];
  X.utils.book_append_sheet(wb, s0, 'Summary');
  X.utils.book_append_sheet(wb, sheet(membersRows, [18, 24, 22, 13, 24, 9, 8, 12, 12, 8, 24, 14, 10, 12, 12, 14, 30, 12, 10, 10, 36, 36]), 'Members');
  X.utils.book_append_sheet(wb, sheet(paymentRows, [12, 18, 22, 13, 30, 10, 18, 18, 10, 10, 12, 30]), 'Payments');
  X.utils.book_append_sheet(wb, sheet(ledgerRows, [18, 22, 10, ...monthsAll.map(() => 14), 12, 10]), 'Monthly record');
  X.utils.book_append_sheet(wb, sheet(waiverRows, [12, 18, 22, 24, 10, 40, 10, 36, 12]), 'Waivers');
  X.writeFile(wb, `RSJJYC-records-${ymLabel().replace(/\s+/g, '-')}-${isoDate(new Date())}.xlsx`);
  toast('Excel file downloaded.', 'success');
}

// ============================ APPROVALS ============================
function approvals() {
  const pw = waivers.filter((w) => w.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pp = payments.filter(needsReview).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = [...waivers.filter((w) => w.status !== 'pending')].sort((a, b) => (b.reviewedAt || '').localeCompare(a.reviewedAt || ''));
  const months = (x) => x.months.map(monthLabel).join(', ');
  view.innerHTML = `
    <div class="charts" style="grid-template-columns:1fr 1fr">
      <div class="panel"><h3>🙏 Waiver / excuse requests (${pw.length})</h3>
        ${pw.length ? pw.map((w) => `<div class="req-card" data-kind="waiver" data-id="${w.id}">
          <div class="top"><b>${esc(w.name)} <span class="mono hint">${esc(w.memberNo)}</span></b><small class="hint">${fmtDate(w.createdAt)}</small></div>
          <p><b>Months:</b> ${months(w)} · <b>${npr(w.amount)}</b></p>
          <p><b>Member's reason:</b> ${esc(w.reason)}</p>
          <label class="f">Admin decision reason <span class="req">*</span><textarea rows="2" placeholder="Why are you approving / rejecting?"></textarea></label>
          <div class="actions" style="margin-top:8px"><button class="btn btn-green btn-sm" data-act="approved">Approve</button><button class="btn btn-red btn-sm" data-act="rejected">Reject</button></div>
        </div>`).join('') : '<div class="empty">🎉 No pending waiver requests</div>'}
      </div>
      <div class="panel"><h3>🧾 New payments — check receipts (${pp.length})</h3>
        <p class="hint" style="margin-top:-6px">Payments count as paid as soon as the member uploads a receipt. Check each receipt; reject it if it is fake or wrong.</p>
        ${pp.length ? pp.map((p) => `<div class="req-card" data-kind="payment" data-id="${p.id}">
          <div class="top"><b>${esc(p.name)} <span class="mono hint">${esc(p.memberNo)}</span></b><small class="hint">${fmtDate(p.createdAt)}</small></div>
          <p><b>${npr(p.amount)}</b> via ${esc(p.method)} · Ref: <span class="mono">${esc(p.ref || '—')}</span></p>
          <p><b>Months:</b> ${months(p)}${p.note ? ` · <i>${esc(p.note)}</i>` : ''}</p>
          ${p.hasReceipt ? `<button class="btn btn-sm btn-ghost" data-receipt="${esc(p.id)}">🧾 View receipt</button>` : '<p class="err">No receipt uploaded</p>'}
          <label class="f" style="margin-top:8px">Admin note <span class="hint">(required to reject)</span><textarea rows="2"></textarea></label>
          <div class="actions" style="margin-top:8px"><button class="btn btn-green btn-sm" data-act="approved">Receipt OK ✔</button><button class="btn btn-red btn-sm" data-act="rejected">Reject receipt</button></div>
        </div>`).join('') : '<div class="empty">✔ No payments waiting</div>'}
      </div>
    </div>
    ${changeRequestsPanel()}
    <div class="panel"><h3>Waiver decisions history</h3>
      ${done.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Decided</th><th>Member</th><th>Months</th><th>Member reason</th><th>Decision</th><th>Admin reason</th></tr></thead><tbody>
      ${done.map((w) => `<tr class="${w.status === 'approved' ? 'row-green' : 'row-red'}"><td>${fmtDate(w.reviewedAt)}</td><td>${esc(w.name)}<br><small class="mono hint">${esc(w.memberNo)}</small></td><td>${months(w)}</td><td>${esc(w.reason)}</td><td><span class="pill ${w.status}">${w.status}</span></td><td>${esc(w.adminReason)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No decisions yet.</div>'}
    </div>`;

  wireReceipts(view);
  wireChangeRequests(view);
  view.querySelectorAll('.req-card [data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.req-card'); const kind = card.dataset.kind; const id = card.dataset.id; const act = btn.dataset.act;
    const ta = card.querySelector('textarea'); const reason = ta.value.trim();
    if ((kind === 'waiver' || act === 'rejected') && reason.length < 5) { ta.classList.add('bad'); ta.focus(); return toast('Please write the reason for this decision.', 'error'); }
    const rec = (kind === 'waiver' ? waivers : payments).find((x) => x.id === id);
    const patch = { status: act, reviewedAt: new Date().toISOString(), reviewedBy: sess.uid, ...(kind === 'waiver' ? { adminReason: reason } : { adminNote: reason, reviewed: true }) };
    try {
      await (kind === 'waiver' ? store.updateWaiver(id, patch) : store.updatePayment(id, patch));
      Object.assign(rec, patch);
      // payment receipt rejected -> card INACTIVE; receipt approved -> card ACTIVE again
      await syncPublic(rec.uid, kind === 'payment' ? { inactive: act === 'rejected' } : {});
      tellMember(rec.uid, decisionNote(kind, act, rec, reason));
      toast(`${kind === 'waiver' ? 'Waiver' : 'Payment'} ${act}.`, act === 'approved' ? 'success' : 'info');
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

// ---------- member detail change requests ----------
function changeRequestsPanel() {
  const pend = changeReqs.filter((c) => c.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `<div class="panel"><h3>📝 Detail change requests (${pend.length})</h3>
    <p class="hint" style="margin-top:-6px">Members cannot change their details themselves. Approving a request updates their details and membership card.</p>
    ${pend.length ? pend.map((c) => `<div class="req-card" data-cr="${esc(c.id)}">
      <div class="top"><b>${esc(c.name)} <span class="mono hint">${esc(c.memberNo)}</span></b><small class="hint">${fmtDate(c.createdAt)}</small></div>
      ${c.note ? `<p><b>Member's note:</b> ${esc(c.note)}</p>` : ''}
      ${changesTable(c)}
      <label class="f" style="margin-top:8px">Admin reason <span class="hint">(required to reject)</span><textarea rows="2" placeholder="Why are you approving / rejecting?"></textarea></label>
      <div class="actions" style="margin-top:8px"><button class="btn btn-green btn-sm" data-cra="approve">Approve changes</button><button class="btn btn-red btn-sm" data-cra="reject">Reject</button></div>
    </div>`).join('') : '<div class="empty">✔ No change requests waiting</div>'}
  </div>`;
}
function wireChangeRequests(root) {
  root.querySelectorAll('[data-cra]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-cr]'); const req = changeReqs.find((c) => c.id === card.dataset.cr);
    const ta = card.querySelector('textarea'); const reason = ta.value.trim();
    const approve = btn.dataset.cra === 'approve';
    if (!approve && reason.length < 5) { ta.classList.add('bad'); ta.focus(); return toast('Please write the reason for this decision.', 'error'); }
    const review = { reviewedAt: new Date().toISOString(), reviewedBy: sess.uid, adminReason: reason };
    const m = members.find((x) => x.uid === req.uid);
    btn.disabled = true;
    try {
      if (approve) {
        if (!m) throw new Error('Member not found');
        await store.approveChangeRequest(req, m, review);
        tellMember(req.uid, { icon: '✅', type: 'change', title: 'Your detail change request was approved', body: 'Your details and membership card have been updated.' + (reason ? ' Admin note: ' + reason : '') });
        toast('Changes approved — member details and card updated.', 'success');
      } else {
        await store.rejectChangeRequest(req.id, review);
        tellMember(req.uid, { icon: '✖️', type: 'change', title: 'Your detail change request was rejected', body: 'Reason: ' + reason });
        toast('Change request rejected.', 'info');
      }
      load();
    } catch (e) { toast(friendlyError(e), 'error'); btn.disabled = false; }
  }));
}

/** Recompute paid-through month and push it to the member + public QR card */
async function syncPublic(uid, extra = {}) {
  const m = members.find((x) => x.uid === uid); if (!m) return;
  Object.assign(m, extra);
  enrich(m);
  const patch = { paidThrough: m._L.paidThrough, ...extra };
  await store.updateMember(uid, patch);
  await store.updatePublicCard(m.cardToken, patch);
}

// ============================ PAYMENTS ============================
function paymentsView() {
  view.innerHTML = `
    <div class="stats" id="payStats"></div>
    <div class="panel">
      <div class="filters">
        <label class="f" style="flex:2">Search<input id="pq" placeholder="Name, member no., transaction ID…" value="${esc(pfilt.q)}"></label>
        ${ymControls()}
        <label class="f">Status<select id="pst"><option value="">All</option>${[['approved', 'Paid'], ['check', 'Receipts to check'], ['rejected', 'Rejected']].map(([v, l]) => `<option value="${v}" ${pfilt.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn btn-ghost" id="preset">Reset</button>
        <button class="btn btn-green" id="xlsP">⬇ Download Excel</button>
      </div>
      <p class="hint" id="pcount"></p>
      <div id="ptbl"></div>
    </div>`;
  const draw = () => {
    const q = pfilt.q.toLowerCase();
    const list = payments.filter((p) => inYM(p.paidAt || p.createdAt)
      && (!q || [p.name, p.memberNo, p.ref, members.find((m) => m.uid === p.uid)?.phone].join(' ').toLowerCase().includes(q))
      && (!pfilt.status || (pfilt.status === 'check' ? needsReview(p) : p.status === pfilt.status)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const sum = (s) => list.filter((p) => p.status === s).reduce((a, p) => a + p.amount, 0);
    const toCheck = list.filter(needsReview).reduce((a, p) => a + p.amount, 0);
    view.querySelector('#payStats').innerHTML = `
      <div class="stat green"><span>Paid (receipt uploaded)</span><b>${npr(sum('approved'))}</b><small>${ymLabel()}</small></div>
      <div class="stat amber"><span>Receipts to check</span><b>${npr(toCheck)}</b></div>
      <div class="stat red"><span>Rejected</span><b>${npr(sum('rejected'))}</b></div>`;
    view.querySelector('#pcount').textContent = `${list.length} of ${payments.length} payment(s)`;
    view.querySelector('#ptbl').innerHTML = list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Member</th><th>Months</th><th>Amount</th><th>Method / ref</th><th>Receipt</th><th>Status</th><th>Admin note</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="${p.status === 'approved' ? 'row-green' : p.status === 'rejected' ? 'row-red' : 'row-amber'}"><td>${fmtDate(p.paidAt || p.createdAt)}</td><td>${esc(p.name)}<br><small class="mono hint">${esc(p.memberNo)}</small></td>
        <td>${p.months.map(monthLabel).join(', ')}</td><td><b>${npr(p.amount)}</b></td><td>${esc(p.method)}<br><small class="mono hint">${esc(p.ref || '')}</small></td>
        <td>${p.hasReceipt ? `<button class="btn btn-sm btn-ghost" data-receipt="${esc(p.id)}">🧾 View</button>` : '—'}</td>
        <td><span class="pill ${p.status === 'approved' ? 'paid' : p.status}">${p.status === 'approved' ? 'paid' : p.status}</span>${needsReview(p) ? '<br><small class="hint">not checked yet</small>' : ''}</td><td>${esc(p.adminNote || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No payments yet.</div>';
    wireReceipts(view);
  };
  view.querySelector('#pq').oninput = (e) => { pfilt.q = e.target.value; draw(); };
  view.querySelector('#pst').onchange = (e) => { pfilt.status = e.target.value; draw(); };
  wireYM(view, draw);
  view.querySelector('#preset').onclick = () => { Object.assign(pfilt, { q: '', status: '' }); Object.assign(filt, { year: '', month: '' }); paymentsView(); };
  view.querySelector('#xlsP').onclick = () => exportExcel();
  draw();
}

// ============================ REMINDERS ============================
/** members whose next payment is due within 7 days, or overdue */
function toRemind() {
  return members.map((m) => ({ m, d: nextDue(m, m._L) }))
    .filter((x) => x.d && x.d.daysLeft <= 7)
    .sort((a, b) => a.d.daysLeft - b.d.daysLeft);
}
function remindersView() {
  const list = toRemind();
  const tag = (d) => { const ms = milestone(d.daysLeft); return ms === 'overdue' ? `<span class="pill rejected">Overdue ${-d.daysLeft} day(s)</span>` : `<span class="pill ${d.daysLeft <= 3 ? 'rejected' : 'due'}">${d.daysLeft === 0 ? 'Due today' : `Due in ${d.daysLeft} day(s)`}</span>`; };
  const phone = (m) => '977' + String(m.phone || '').replace(/[^\d]/g, '').slice(-10);
  view.innerHTML = `
    <div class="panel">
      <h3>🔔 Payment reminders (${list.length})</h3>
      <p class="hint" style="margin-top:-6px">Members whose next monthly contribution is due within 7 days or is overdue. Members with notifications turned on are reminded automatically 7, 3 and 1 day before; use these buttons to also send a WhatsApp or SMS.</p>
      ${list.length ? `<div class="remind-list">${list.map(({ m, d }) => {
        const msg = adminMessage(m, d);
        return `<div class="req-card ${d.overdue || d.daysLeft <= 3 ? 'urgent' : ''}">
          <div class="top"><b>${esc(m.fullName)} <span class="mono hint">${esc(m.memberNo)}</span></b>${tag(d)}</div>
          <p>${npr(d.amount)} for ${esc(d.label)} · due ${fmtDate(d.due)} · 📞 ${esc(m.phone)}</p>
          <div class="actions">
            <a class="btn btn-sm btn-green" target="_blank" rel="noopener" href="https://wa.me/${phone(m)}?text=${encodeURIComponent(msg)}">WhatsApp</a>
            <a class="btn btn-sm" href="sms:+${phone(m)}?body=${encodeURIComponent(msg)}">SMS</a>
            <button class="btn btn-sm btn-ghost" data-copy="${esc(msg)}">Copy message</button>
          </div>
        </div>`;
      }).join('')}</div>` : '<div class="empty">✔ Nobody is due in the next 7 days.</div>'}
    </div>`;
  view.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Message copied.', 'success'); } catch { toast(b.dataset.copy, 'info'); }
  }));
}

function wireReceipts(root) {
  root.querySelectorAll('[data-receipt]').forEach((b) => (b.onclick = async () => showReceipt(await store.getReceipt(b.dataset.receipt))));
}

['langchange', 'themechange'].forEach((ev) => window.addEventListener(ev, () => { if (members.length || current) show(current); }));
// ============================ NOTIFICATIONS ============================
/** personal notification to ONE member (never to others) */
function tellMember(uid, n) { store.notify(uid, n).catch(() => {}); }
function decisionNote(kind, act, rec, reason) {
  const months = (rec.months || []).map(monthLabel).join(', ');
  if (kind === 'payment') return act === 'approved'
    ? { icon: '✅', type: 'payment', title: 'Payment approved', body: `Your ${npr(rec.amount)} payment for ${months} was checked and approved. Thank you!${reason ? ' Admin note: ' + reason : ''}` }
    : { icon: '⛔', type: 'payment', title: 'Payment receipt rejected — card INACTIVE', body: `Your ${npr(rec.amount)} payment for ${months} was rejected. Reason: ${reason}. Please pay again and upload a valid receipt to make your card active.` };
  return act === 'approved'
    ? { icon: '🙏', type: 'waiver', title: 'Waiver request approved', body: `Your waiver for ${months} was approved. Reason: ${reason}` }
    : { icon: '✖️', type: 'waiver', title: 'Waiver request rejected', body: `Your waiver for ${months} was rejected. Reason: ${reason}` };
}

// admin bell: things waiting for the admin
let adminBell;
const seenKey = 'rsjjyc_admin_seen';
function adminItems() {
  const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]'));
  const list = [];
  payments.filter(needsReview).forEach((p) => list.push({ id: 'p-' + p.id, icon: '🧾', title: 'New payment receipt to check', body: `${p.name} · ${npr(p.amount)} · ${(p.months || []).map(monthLabel).join(', ')}`, at: p.createdAt }));
  waivers.filter((w) => w.status === 'pending').forEach((w) => list.push({ id: 'w-' + w.id, icon: '🙏', title: 'New waiver request', body: `${w.name} · ${(w.months || []).map(monthLabel).join(', ')} — ${w.reason}`, at: w.createdAt }));
  changeReqs.filter((c) => c.status === 'pending').forEach((c) => list.push({ id: 'c-' + c.id, icon: '📝', title: 'Detail change request', body: `${c.name} wants to change: ${Object.keys(c.changes).join(', ')}`, at: c.createdAt }));
  members.filter((m) => Date.now() - m.joinMs < 7 * DAY).forEach((m) => list.push({ id: 'r-' + m.uid, icon: '🆕', title: 'New member registered', body: `${m.fullName} · ${m.memberNo}`, at: new Date(m.joinMs).toISOString() }));
  return list.map((n) => ({ ...n, unread: !seen.has(n.id), url: 'admin.html' }));
}
function refreshAdminBell() {
  if (!adminBell) adminBell = mountBell({ onOpen: (items) => {
    const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]')); items.forEach((i) => seen.add(i.id));
    localStorage.setItem(seenKey, JSON.stringify([...seen].slice(-500)));
  } });
  const items = adminItems();
  adminBell?.set(items);
  phoneNotify('admin', items);
}

// ============================ ANNOUNCEMENTS ============================
let announcements = [];
async function announceView() {
  announcements = await store.listAnnouncements().catch(() => []);
  const list = [...announcements].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  view.innerHTML = `
    <div class="panel">
      <h3>📢 Announcement board</h3>
      <p class="hint" style="margin-top:-6px">Write a message for ALL members. It appears in every member's 🔔 notifications and as a phone notification for members who turned notifications on.</p>
      <label class="f">Title <span class="req">*</span><input id="anTitle" maxlength="120" placeholder="e.g. General meeting on Saturday"></label>
      <label class="f" style="margin-top:10px">Message <span class="req">*</span><textarea id="anBody" rows="5" maxlength="2000" placeholder="Write the full announcement here…"></textarea></label>
      <div class="err" id="anErr"></div>
      <button class="btn btn-primary btn-block" id="anSend">📢 Publish to all members</button>
    </div>
    <div class="panel"><h3>Published announcements (${list.length})</h3>
      ${list.length ? list.map((a) => `<div class="req-card announce-card">
        <div class="top"><b>📢 ${esc(a.title)}</b><small class="hint">${fmtDate(a.createdAt)}</small></div>
        <p style="white-space:pre-wrap">${esc(a.body)}</p>
        <div class="actions"><button class="btn btn-sm btn-ghost" data-andel="${esc(a.id)}">Remove</button></div>
      </div>`).join('') : '<div class="empty">No announcements yet.</div>'}
    </div>`;
  view.querySelector('#anSend').onclick = async () => {
    const title = view.querySelector('#anTitle').value.trim(), body = view.querySelector('#anBody').value.trim();
    const err = view.querySelector('#anErr'); err.textContent = '';
    if (title.length < 3 || body.length < 5) { err.textContent = 'Please write a title and a message.'; return; }
    const b = view.querySelector('#anSend'); b.disabled = true;
    try { await store.createAnnouncement({ title, body, by: sess.uid }); toast('Announcement published to all members.', 'success'); announceView(); }
    catch (e) { err.textContent = friendlyError(e); b.disabled = false; }
  };
  view.querySelectorAll('[data-andel]').forEach((b) => (b.onclick = async () => {
    try { await store.deleteAnnouncement(b.dataset.andel); toast('Announcement removed.', 'info'); announceView(); } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

load().catch((e) => { view.innerHTML = `<div class="panel empty">Could not load data: ${esc(friendlyError(e))}</div>`; });
