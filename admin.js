import { MEMBER_TYPES, RULES, PROFESSIONS, PROVINCES, BLOOD_GROUPS, DONATION_TIERS } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { tr } from './i18n.js';
import { mountCard, downloadButtons, wireDownloads } from './card.js';
import { buildLedger, cardStatus, esc, npr, fmtDate, isoDate, modal, toast, monthKey, addMonths, monthLabel, STATUS_TEXT, DAY, showReceipt } from './utils.js';
import { nextDue, milestone, adminMessage } from './reminders.js';
const needsReview = (p) => p.status === 'pending' || (p.status === 'approved' && p.reviewed === false);

const store = await initPage();
const sess = await store.session();
if (!sess || sess.role !== 'admin') { location.replace('index.html#admin'); throw new Error('redirect'); }
document.getElementById('logout').onclick = async () => { await store.logout(); location.href = 'index.html'; };

const view = document.getElementById('view');
let members = [], payments = [], waivers = [], current = 'overview';
const charts = [];
// shared filters: year / month apply to members (join date) and payments (payment date)
const filt = { q: '', chip: 'all', from: '', to: '', type: '', year: '', month: '' };
const pfilt = { q: '', status: '' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function load() {
  [members, payments, waivers] = await Promise.all([store.listMembers(), store.listPayments(), store.listWaivers()]);
  members.forEach(enrich);
  members.sort((a, b) => b.joinMs - a.joinMs);
  const pend = payments.filter(needsReview).length + waivers.filter((w) => w.status === 'pending').length;
  const b = document.getElementById('apBadge'); b.hidden = !pend; b.textContent = pend;
  const nRem = toRemind().length; const rb = document.getElementById('rmBadge'); rb.hidden = !nRem; rb.textContent = nRem;
  show(current);
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
  ({ overview, members: membersView, approvals, payments: paymentsView, reminders: remindersView })[v]();
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
  const cnt = (c) => members.filter((m) => m._S.code === c).length;
  const owing = members.filter((m) => m._L.outstanding > 0);
  const dues = owing.reduce((a, m) => a + m._L.outstanding, 0);
  const pend = payments.filter(needsReview).length + waivers.filter((w) => w.status === 'pending').length;
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
const CHIPS = [['all', 'All'], ['today', 'Registered today'], ['thismonth', 'This month'], ['new', 'New members (30 days)'], ['active', 'Active'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['owing', 'Has dues'], ['clear', 'Paid-up']];
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
        <button class="btn btn-block" id="mEdit" style="margin-top:14px">✏️ Edit member details</button>
        <div class="danger-zone">
          <b>Danger zone</b>
          <p class="hint">Permanently removes this membership: details, card, QR page, payments, receipts and waiver requests. Their mobile number and e-mail become free to register again.</p>
          <button class="btn btn-red btn-sm" id="mDelete">🗑 Delete member</button>
        </div>
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
  el.querySelector('#mEdit').onclick = () => { close(); editMember(m); };
  el.querySelector('#mDelete').onclick = () => { close(); confirmDelete(m); };
}

// ---------- edit member ----------
function editMember(m) {
  const opt = (list, v) => list.map((x) => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const profs = PROFESSIONS.map((p) => p.label);
  const profVal = m.profession?.startsWith('Other') ? 'Other' : m.profession;
  const tiers = [...new Set([...DONATION_TIERS.notEmployed, ...DONATION_TIERS.employed, m.pledge])].sort((a, b) => a - b);
  const addrBlock = (k, a = {}) => `
    <div class="grid g4" data-ea="${k}">
      <label class="f">Province<select name="${k}Province"><option value="">—</option>${opt(Object.keys(PROVINCES), a.province)}</select></label>
      <label class="f">District<select name="${k}District"><option value="">—</option>${opt(PROVINCES[a.province] || [], a.district)}</select></label>
      <label class="f">Municipality / Rural Mun.<input name="${k}Municipality" value="${esc(a.municipality || '')}"></label>
      <label class="f">Ward no.<input name="${k}Ward" type="number" min="1" max="35" value="${esc(a.ward || '')}"></label>
      <label class="f" style="grid-column:1/-1">Tole / Street<input name="${k}Tole" value="${esc(a.tole || '')}"></label>
    </div>`;
  const { el, close } = modal(`
    <h3>✏️ Edit member — <span class="mono">${esc(m.memberNo)}</span></h3>
    <form id="editForm" novalidate>
      <fieldset><legend>Personal details</legend>
        <div class="grid g3">
          <label class="f">First name<input name="firstName" value="${esc(m.firstName)}" required></label>
          <label class="f">Middle name<input name="middleName" value="${esc(m.middleName || '')}"></label>
          <label class="f">Surname<input name="lastName" value="${esc(m.lastName)}" required></label>
          <label class="f">Date of birth (AD)<input name="dob" type="date" value="${esc(m.dob || '')}"></label>
          <label class="f">Gender<select name="gender"><option value="">—</option>${opt(['Male', 'Female', 'Other', 'Prefer not to say'], m.gender)}</select></label>
          <label class="f">Blood group<select name="bloodGroup"><option value="">—</option>${opt(BLOOD_GROUPS, m.bloodGroup)}</select></label>
          <label class="f">Mobile number<input name="phone" value="${esc(m.phone)}" required></label>
          <label class="f">E-mail<input name="email" type="email" value="${esc(m.email || '')}"></label>
          <label class="f">Member type (shown on card)<select name="memberType">${opt(MEMBER_TYPES, m.memberType)}</select></label>
        </div>
      </fieldset>
      <fieldset><legend>Profession &amp; contribution</legend>
        <div class="grid g3">
          <label class="f">Profession<select name="profession">${opt(profs, profVal)}</select></label>
          <label class="f">If other, specify<input name="professionOther" value="${esc(m.profession?.startsWith('Other: ') ? m.profession.slice(7) : '')}"></label>
          <label class="f">Monthly contribution<select name="pledge">${tiers.map((t) => `<option value="${t}" ${t === m.pledge ? 'selected' : ''}>${npr(t)}</option>`).join('')}</select></label>
        </div>
      </fieldset>
      <fieldset><legend>Permanent address</legend>${addrBlock('permanent', m.permanentAddress)}</fieldset>
      <fieldset><legend>Temporary address</legend>${addrBlock('temporary', m.temporaryAddress)}</fieldset>
      <p class="hint">Login username (<b>${esc(m.username)}</b>) and member number stay the same. Changing the mobile number or e-mail also updates the one-membership check.</p>
      <div class="err" id="eErr"></div>
      <div class="actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="eSave">Save changes</button></div>
    </form>`, { wide: true });
  const f = el.querySelector('#editForm');
  ['permanent', 'temporary'].forEach((k) => {
    f.elements[k + 'Province'].onchange = (e) => {
      f.elements[k + 'District'].innerHTML = '<option value="">—</option>' + (PROVINCES[e.target.value] || []).map((d) => `<option value="${d}">${d}</option>`).join('');
    };
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const E = f.elements, err = el.querySelector('#eErr'); err.textContent = '';
    const v = (n) => E[n].value.trim();
    const phone = v('phone').replace(/[^\d]/g, '').replace(/^977(?=\d{10}$)/, '');
    const email = v('email').toLowerCase();
    if (!v('firstName') || !v('lastName')) { err.textContent = 'Please fill in all required fields.'; return; }
    if (!/^9\d{9}$/.test(phone)) { err.textContent = 'Enter a valid 10-digit Nepali mobile number (98XXXXXXXX).'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Enter a valid e-mail address.'; return; }
    const readA = (k) => ({ province: v(k + 'Province'), district: v(k + 'District'), municipality: v(k + 'Municipality'), ward: v(k + 'Ward'), tole: v(k + 'Tole') });
    const prof = v('profession') === 'Other' && v('professionOther') ? `Other: ${v('professionOther')}` : v('profession');
    const fullName = [v('firstName'), v('middleName'), v('lastName')].filter(Boolean).join(' ');
    const patch = {
      firstName: v('firstName'), middleName: v('middleName'), lastName: v('lastName'), fullName,
      dob: v('dob') || m.dob, gender: v('gender'), bloodGroup: v('bloodGroup'), phone, email,
      memberType: v('memberType'), profession: prof, employed: !!PROFESSIONS.find((p) => p.label === v('profession'))?.employed,
      pledge: Number(v('pledge')), permanentAddress: readA('permanent'), temporaryAddress: readA('temporary'),
      updatedAt: new Date().toISOString(), updatedBy: 'admin',
    };
    const pubPatch = { fullName, dob: patch.dob, bloodGroup: patch.bloodGroup, memberType: patch.memberType };
    const btn = el.querySelector('#eSave'); btn.disabled = true;
    try { await store.adminUpdateMember(m, patch, pubPatch); close(); toast('Member details updated.', 'success'); load(); }
    catch (ex) { err.textContent = friendlyError(ex); btn.disabled = false; }
  };
}

function confirmDelete(m) {
  const nPay = payments.filter((p) => p.uid === m.uid).length, nW = waivers.filter((w) => w.uid === m.uid).length;
  const { el, close } = modal(`
    <h3>🗑 Delete this member?</h3>
    <p><b>${esc(m.fullName)}</b> · <span class="mono">${esc(m.memberNo)}</span></p>
    <ul class="hint" style="margin:6px 0 12px;padding-left:18px">
      <li>Membership details, card and QR verification page</li>
      <li>${nPay} payment(s) with receipts and ${nW} waiver request(s)</li>
      <li>Frees mobile ${esc(m.phone)}${m.email ? ' and e-mail ' + esc(m.email) : ''} for a new registration</li>
    </ul>
    <p class="err" style="font-weight:600">This cannot be undone.</p>
    <label class="f">Type the member number to confirm<input id="delConfirm" placeholder="${esc(m.memberNo)}" autocomplete="off"></label>
    <p class="hint">The login account stays in Firebase (Authentication → Users). Delete it there too if you want to remove the login completely.</p>
    <div class="actions" style="margin-top:12px">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-red" id="delGo" disabled>Delete permanently</button>
    </div>`);
  const inp = el.querySelector('#delConfirm'), btn = el.querySelector('#delGo');
  inp.addEventListener('input', () => (btn.disabled = inp.value.trim().toUpperCase() !== m.memberNo));
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Deleting…';
    try { await store.deleteMember(m); close(); toast(`Member ${m.memberNo} deleted.`, 'success'); load(); }
    catch (e) { toast(friendlyError(e), 'error'); btn.disabled = false; btn.textContent = 'Delete permanently'; }
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
    <div class="panel"><h3>Waiver decisions history</h3>
      ${done.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Decided</th><th>Member</th><th>Months</th><th>Member reason</th><th>Decision</th><th>Admin reason</th></tr></thead><tbody>
      ${done.map((w) => `<tr class="${w.status === 'approved' ? 'row-green' : 'row-red'}"><td>${fmtDate(w.reviewedAt)}</td><td>${esc(w.name)}<br><small class="mono hint">${esc(w.memberNo)}</small></td><td>${months(w)}</td><td>${esc(w.reason)}</td><td><span class="pill ${w.status}">${w.status}</span></td><td>${esc(w.adminReason)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No decisions yet.</div>'}
    </div>`;

  wireReceipts(view);
  view.querySelectorAll('.req-card [data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('.req-card'); const kind = card.dataset.kind; const id = card.dataset.id; const act = btn.dataset.act;
    const ta = card.querySelector('textarea'); const reason = ta.value.trim();
    if ((kind === 'waiver' || act === 'rejected') && reason.length < 5) { ta.classList.add('bad'); ta.focus(); return toast('Please write the reason for this decision.', 'error'); }
    const rec = (kind === 'waiver' ? waivers : payments).find((x) => x.id === id);
    const patch = { status: act, reviewedAt: new Date().toISOString(), reviewedBy: sess.uid, ...(kind === 'waiver' ? { adminReason: reason } : { adminNote: reason, reviewed: true }) };
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
      <p class="hint" style="margin-top:-6px">Members whose next monthly contribution is due within 7 days or is overdue. Members with notifications turned on are reminded automatically 7, 5 and 3 days before; use these buttons to also send a WhatsApp or SMS.</p>
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
load().catch((e) => { view.innerHTML = `<div class="panel empty">Could not load data: ${esc(friendlyError(e))}</div>`; });
