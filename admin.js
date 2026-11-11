import { MEMBER_TYPES, RULES } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { tr } from './i18n.js';
import { mountCard, downloadButtons, wireDownloads } from './card.js';
import { buildLedger, cardStatus, esc, npr, fmtDate, isoDate, modal, toast, monthKey, addMonths, monthLabel, STATUS_TEXT, DAY } from './utils.js';

const store = await initPage();
const sess = await store.session();
if (!sess || sess.role !== 'admin') { location.replace('index.html#admin'); throw new Error('redirect'); }
document.getElementById('logout').onclick = async () => { await store.logout(); location.href = 'index.html'; };

const view = document.getElementById('view');
let members = [], payments = [], waivers = [], current = 'overview';
const charts = [];
const filt = { q: '', chip: 'all', from: '', to: '', type: '' };

async function load() {
  [members, payments, waivers] = await Promise.all([store.listMembers(), store.listPayments(), store.listWaivers()]);
  members.forEach(enrich);
  members.sort((a, b) => b.joinMs - a.joinMs);
  const pend = payments.filter((p) => p.status === 'pending').length + waivers.filter((w) => w.status === 'pending').length;
  const b = document.getElementById('apBadge'); b.hidden = !pend; b.textContent = pend;
  show(current);
}
function enrich(m) {
  m._L = buildLedger(m, payments.filter((p) => p.uid === m.uid), waivers.filter((w) => w.uid === m.uid));
  m._S = cardStatus({ ...m, paidThrough: m._L.paidThrough });
  return m;
}

document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('on', x === b));
  show(b.dataset.view);
});
function show(v) {
  current = v;
  charts.splice(0).forEach((c) => c.destroy());
  ({ overview, members: membersView, approvals, payments: paymentsView })[v]();
}

// ============================ OVERVIEW ============================
function overview() {
  const now = new Date(), cm = monthKey(now);
  const approved = payments.filter((p) => p.status === 'approved');
  const raised = approved.reduce((a, p) => a + p.amount, 0);
  const newThisMonth = members.filter((m) => monthKey(m.joinMs) === cm).length;
  const cnt = (c) => members.filter((m) => m._S.code === c).length;
  const owing = members.filter((m) => m._L.outstanding > 0);
  const dues = owing.reduce((a, m) => a + m._L.outstanding, 0);
  const pend = payments.filter((p) => p.status === 'pending').length + waivers.filter((w) => w.status === 'pending').length;

  view.innerHTML = `
    <div class="stats">
      <div class="stat green"><span>Total money raised</span><b>${npr(raised)}</b><small>${approved.length} verified payment(s)</small></div>
      <div class="stat"><span>Total members</span><b>${members.length}</b><small>${cnt('active')} active</small></div>
      <div class="stat crimson"><span>New members (this month)</span><b>${newThisMonth}</b><small>${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</small></div>
      <div class="stat amber"><span>About to expire / due</span><b>${cnt('expiring')}</b><small>within ${RULES.expiringSoonDays} days or payment due</small></div>
      <div class="stat red"><span>Expired</span><b>${cnt('expired')}</b><small>date passed or ${RULES.suspendAfterMissedMonths}+ months unpaid</small></div>
      <div class="stat red"><span>Outstanding dues</span><b>${npr(dues)}</b><small>${owing.length} member(s) owing</small></div>
      <div class="stat ${pend ? 'amber' : 'green'}"><span>Pending approvals</span><b>${pend}</b><small><a href="#" id="goAp">review now →</a></small></div>
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
  view.querySelector('#goAp').onclick = (e) => { e.preventDefault(); document.querySelector('[data-view=approvals]').click(); };
  wireRows(view);

  if (!window.Chart) return;
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.font.family = document.documentElement.lang === 'ne' ? 'Mukta, Poppins, sans-serif' : 'Poppins, sans-serif';
  Chart.defaults.color = css.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--line').trim();
  Chart.defaults.elements.arc.borderColor = css.getPropertyValue('--surface').trim();
  const months = Array.from({ length: 12 }, (_, i) => addMonths(cm, i - 11));
  const raisedBy = months.map((k) => approved.filter((p) => monthKey(p.reviewedAt || p.createdAt) === k).reduce((a, p) => a + p.amount, 0));
  const joinedBy = months.map((k) => members.filter((m) => monthKey(m.joinMs) === k).length);
  charts.push(new Chart(view.querySelector('#c1'), {
    data: { labels: months.map(monthLabel).map(tr), datasets: [
      { type: 'bar', label: tr('Money raised (NPR)'), data: raisedBy, backgroundColor: 'rgba(22,163,74,.75)', borderRadius: 6, yAxisID: 'y' },
      { type: 'line', label: tr('New members'), data: joinedBy, borderColor: '#c8102e', backgroundColor: '#c8102e', tension: .2, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, title: { display: true, text: tr('NPR') } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0 }, title: { display: true, text: tr('Members') } } } },
  }));
  charts.push(new Chart(view.querySelector('#c2'), {
    type: 'doughnut',
    data: { labels: ['Active', 'Expiring / due', 'Expired'].map(tr), datasets: [{ data: [cnt('active'), cnt('expiring'), cnt('expired')], backgroundColor: ['#16a34a', '#d97706', '#dc2626'] }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } },
      onClick: (_, el) => { if (el[0]) { filt.chip = ['active', 'expiring', 'expired'][el[0].index]; document.querySelector('[data-view=members]').click(); } } },
  }));
  const prof = {};
  members.forEach((m) => { const k = m.profession.startsWith('Other') ? 'Other' : m.profession; prof[k] = (prof[k] || 0) + 1; });
  const pk = Object.keys(prof).sort((a, b) => prof[b] - prof[a]);
  charts.push(new Chart(view.querySelector('#c3'), {
    type: 'bar', data: { labels: pk.map(tr), datasets: [{ label: tr('Members'), data: pk.map((k) => prof[k]), backgroundColor: '#3466c2', borderRadius: 6 }] },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  }));
  const clear = members.filter((m) => !m._L.outstanding).length;
  charts.push(new Chart(view.querySelector('#c4'), {
    type: 'pie', data: { labels: ['Paid-up', 'Owing dues'].map(tr), datasets: [{ data: [clear, owing.length], backgroundColor: ['#16a34a', '#dc2626'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  }));
}

// ============================ MEMBERS ============================
const CHIPS = [['all', 'All'], ['new', 'New members (30 days)'], ['active', 'Active'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['owing', 'Has dues'], ['clear', 'Paid-up']];
function filtered() {
  const now = Date.now();
  return members.filter((m) => {
    if (filt.q) { const q = filt.q.toLowerCase(); if (![m.fullName, m.memberNo, m.phone, m.email, m.profession].join(' ').toLowerCase().includes(q)) return false; }
    if (filt.type && m.memberType !== filt.type) return false;
    if (filt.from && isoDate(m.joinMs) < filt.from) return false;
    if (filt.to && isoDate(m.joinMs) > filt.to) return false;
    switch (filt.chip) {
      case 'new': return now - m.joinMs <= 30 * DAY;
      case 'active': case 'expiring': case 'expired': return m._S.code === filt.chip;
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
        <label class="f" style="flex:2">Search<input id="fq" placeholder="Name, member no., phone, profession…" value="${esc(filt.q)}"></label>
        <label class="f">Joined from<input type="date" id="ffrom" value="${filt.from}"></label>
        <label class="f">Joined to<input type="date" id="fto" value="${filt.to}"></label>
        <label class="f">Member type<select id="ftype"><option value="">All types</option>${MEMBER_TYPES.map((t) => `<option value="${t}" ${filt.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn btn-ghost" id="fclear">Reset</button>
        <button class="btn" id="csv">⬇ Export CSV</button>
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
  view.querySelector('#chips').onclick = (e) => { const b = e.target.closest('[data-chip]'); if (!b) return; filt.chip = b.dataset.chip; view.querySelectorAll('#chips button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  view.querySelector('#fclear').onclick = () => { Object.assign(filt, { q: '', chip: 'all', from: '', to: '', type: '' }); membersView(); };
  view.querySelector('#csv').onclick = () => exportCsv(filtered());
  draw();
}

const rowClass = (m) => (m._S.code === 'expired' || m._L.outstanding ? 'row-red' : m._S.code === 'expiring' ? 'row-amber' : 'row-green');
function memberTable(list) {
  if (!list.length) return '<div class="empty">No members match.</div>';
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th></th><th>Member no.</th><th>Name</th><th>Type</th><th>Phone</th><th>Joined</th><th>Expires</th><th>Monthly</th><th>Paid</th><th>Dues</th><th>Status</th></tr></thead><tbody>
    ${list.map((m) => `<tr class="click ${rowClass(m)}" data-uid="${esc(m.uid)}">
      <td><img class="av" src="${m.photo || ''}" alt=""></td><td class="mono">${esc(m.memberNo)}</td><td><b>${esc(m.fullName)}</b><br><small class="hint">${esc(m.profession)}</small></td>
      <td>${esc(m.memberType)}</td><td>${esc(m.phone)}</td><td>${fmtDate(m.joinMs)}</td><td>${fmtDate(m.expiryMs)}<br><small class="hint">${m._S.daysLeft > 0 ? m._S.daysLeft + ' days' : 'expired'}</small></td>
      <td>${npr(m.pledge)}</td><td style="color:var(--green);font-weight:600">${npr(m._L.paidTotal)}</td>
      <td style="color:${m._L.outstanding ? 'var(--red)' : 'var(--green)'};font-weight:600">${npr(m._L.outstanding)}</td>
      <td><span class="pill ${m._S.code}">${m._S.label}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}
function wireRows(root) { root.querySelectorAll('tr[data-uid]').forEach((r) => (r.onclick = () => memberModal(members.find((m) => m.uid === r.dataset.uid)))); }

function memberModal(m) {
  const a = (x = {}) => esc([x.tole, x.municipality && `${x.municipality}-${x.ward}`, x.district, x.province].filter(Boolean).join(', '));
  const { el, close } = modal(`
    <h3>${esc(m.fullName)} <span class="pill ${m._S.code}">${m._S.label}</span></h3>
    <div class="dash" style="grid-template-columns:380px 1fr">
      <div><div id="mCard"></div>${downloadButtons()}
        <label class="f" style="margin-top:16px">Member type (shown on card)
          <div style="display:flex;gap:8px"><select id="mType">${MEMBER_TYPES.map((t) => `<option value="${t}" ${t === m.memberType ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn btn-sm" id="mTypeSave">Save</button></div></label>
      </div>
      <div>
        <dl class="kv">
          <dt>Member no.</dt><dd class="mono">${esc(m.memberNo)}</dd><dt>DOB</dt><dd>${fmtDate(m.dob)} · ${esc(m.dobBS || '')} BS · age ${m.ageAtApplication} at joining</dd>
          <dt>Gender</dt><dd>${esc(m.gender || '—')}</dd><dt>Profession</dt><dd>${esc(m.profession)}</dd>
          <dt>Phone / e-mail</dt><dd>${esc(m.phone)} ${m.email ? '· ' + esc(m.email) : ''}</dd><dt>Username</dt><dd>${esc(m.username)}</dd>
          <dt>Permanent</dt><dd>${a(m.permanentAddress)}</dd><dt>Temporary</dt><dd>${a(m.temporaryAddress)}</dd>
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
    try { await store.updateMember(m.uid, { memberType: t }); await store.updatePublicCard(m.cardToken, { memberType: t }); toast('Member type updated', 'success'); close(); load(); }
    catch (e) { toast(friendlyError(e), 'error'); }
  };
}

function exportCsv(list) {
  const cols = ['memberNo', 'fullName', 'memberType', 'phone', 'email', 'profession', 'dob', 'dobBS', 'pledge', 'joined', 'expires', 'status', 'paid', 'dues'];
  const rows = list.map((m) => [m.memberNo, m.fullName, m.memberType, m.phone, m.email, m.profession, m.dob, m.dobBS, m.pledge, isoDate(m.joinMs), isoDate(m.expiryMs), m._S.label, m._L.paidTotal, m._L.outstanding]);
  const csv = [cols, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `rsjjyc-members-${isoDate(new Date())}.csv`; a.click();
}

// ============================ APPROVALS ============================
function approvals() {
  const pw = waivers.filter((w) => w.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pp = payments.filter((p) => p.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
      <div class="panel"><h3>💳 Payments awaiting verification (${pp.length})</h3>
        ${pp.length ? pp.map((p) => `<div class="req-card" data-kind="payment" data-id="${p.id}">
          <div class="top"><b>${esc(p.name)} <span class="mono hint">${esc(p.memberNo)}</span></b><small class="hint">${fmtDate(p.createdAt)}</small></div>
          <p><b>${npr(p.amount)}</b> via ${esc(p.method)} · Ref: <span class="mono">${esc(p.ref || '—')}</span></p>
          <p><b>Months:</b> ${months(p)}${p.note ? ` · <i>${esc(p.note)}</i>` : ''}</p>
          <label class="f">Admin note <span class="hint">(required to reject)</span><textarea rows="2"></textarea></label>
          <div class="actions" style="margin-top:8px"><button class="btn btn-green btn-sm" data-act="approved">Verify &amp; approve</button><button class="btn btn-red btn-sm" data-act="rejected">Reject</button></div>
        </div>`).join('') : '<div class="empty">✔ No payments waiting</div>'}
      </div>
    </div>
    <div class="panel"><h3>Waiver decisions history</h3>
      ${done.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Decided</th><th>Member</th><th>Months</th><th>Member reason</th><th>Decision</th><th>Admin reason</th></tr></thead><tbody>
      ${done.map((w) => `<tr class="${w.status === 'approved' ? 'row-green' : 'row-red'}"><td>${fmtDate(w.reviewedAt)}</td><td>${esc(w.name)}<br><small class="mono hint">${esc(w.memberNo)}</small></td><td>${months(w)}</td><td>${esc(w.reason)}</td><td><span class="pill ${w.status}">${w.status}</span></td><td>${esc(w.adminReason)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No decisions yet.</div>'}
    </div>`;

  view.querySelectorAll('.req-card [data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.req-card'); const kind = card.dataset.kind; const id = card.dataset.id; const act = btn.dataset.act;
    const ta = card.querySelector('textarea'); const reason = ta.value.trim();
    if ((kind === 'waiver' || act === 'rejected') && reason.length < 5) { ta.classList.add('bad'); ta.focus(); return toast('Please write the reason for this decision.', 'error'); }
    const rec = (kind === 'waiver' ? waivers : payments).find((x) => x.id === id);
    const patch = { status: act, reviewedAt: new Date().toISOString(), reviewedBy: sess.uid, ...(kind === 'waiver' ? { adminReason: reason } : { adminNote: reason }) };
    try {
      await (kind === 'waiver' ? store.updateWaiver(id, patch) : store.updatePayment(id, patch));
      Object.assign(rec, patch);
      await syncPublic(rec.uid);
      toast(`${kind === 'waiver' ? 'Waiver' : 'Payment'} ${act}.`, act === 'approved' ? 'success' : 'info');
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

/** Recompute paid-through month and push it to the member + public QR card */
async function syncPublic(uid) {
  const m = members.find((x) => x.uid === uid); if (!m) return;
  enrich(m);
  const pt = m._L.paidThrough;
  await store.updateMember(uid, { paidThrough: pt });
  await store.updatePublicCard(m.cardToken, { paidThrough: pt });
}

// ============================ PAYMENTS ============================
function paymentsView() {
  const list = [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (s) => list.filter((p) => p.status === s).reduce((a, p) => a + p.amount, 0);
  view.innerHTML = `
    <div class="stats">
      <div class="stat green"><span>Verified</span><b>${npr(sum('approved'))}</b></div>
      <div class="stat amber"><span>Awaiting verification</span><b>${npr(sum('pending'))}</b></div>
      <div class="stat red"><span>Rejected</span><b>${npr(sum('rejected'))}</b></div>
    </div>
    <div class="panel"><h3>All payments</h3>
      ${list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Member</th><th>Months</th><th>Amount</th><th>Method / ref</th><th>Status</th><th>Admin note</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="${p.status === 'approved' ? 'row-green' : p.status === 'rejected' ? 'row-red' : 'row-amber'}"><td>${fmtDate(p.createdAt)}</td><td>${esc(p.name)}<br><small class="mono hint">${esc(p.memberNo)}</small></td>
        <td>${p.months.map(monthLabel).join(', ')}</td><td><b>${npr(p.amount)}</b></td><td>${esc(p.method)}<br><small class="mono hint">${esc(p.ref || '')}</small></td>
        <td><span class="pill ${p.status}">${p.status}</span></td><td>${esc(p.adminNote || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No payments yet.</div>'}
    </div>`;
}

['langchange', 'themechange'].forEach((ev) => window.addEventListener(ev, () => { if (members.length || current) show(current); }));
load().catch((e) => { view.innerHTML = `<div class="panel empty">Could not load data: ${esc(friendlyError(e))}</div>`; });
