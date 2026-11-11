import { PAYMENT_METHODS, RULES } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { mountCard, downloadButtons, wireDownloads, verifyUrl } from './card.js';
import { buildLedger, cardStatus, esc, npr, fmtDate, modal, toast, monthKey, addMonths, addYears, STATUS_TEXT } from './utils.js';

const store = await initPage();
const app = document.getElementById('app');
const sess = await store.session();
if (!sess || sess.role !== 'member') { location.replace(sess?.role === 'admin' ? 'admin.html' : 'index.html#login'); throw new Error('redirect'); }
document.getElementById('logout').onclick = async () => { await store.logout(); location.href = 'index.html'; };

let M, payments, waivers, L, ST;

async function load() {
  [M, payments, waivers] = await Promise.all([store.getMember(sess.uid), store.listPayments(sess.uid), store.listWaivers(sess.uid)]);
  if (!M) { app.innerHTML = '<div class="panel empty">Member record not found.</div>'; return; }
  L = buildLedger(M, payments, waivers);
  ST = cardStatus({ ...M, paidThrough: L.paidThrough });
  render();
}

function render() {
  const renew = renewInfo();
  const bannerIcon = { active: '✅', expiring: '⚠️', expired: '⛔' }[ST.code];
  const bannerText = ST.code === 'expired'
    ? `<span>Your card is EXPIRED — renew soon.</span> <span style="font-weight:400">(${esc(ST.reason)})</span>`
    : `<span>${ST.code === 'expiring' ? esc(ST.label) : 'Your membership is ACTIVE'}</span> — <span>${esc(ST.reason)}</span>`;

  app.innerHTML = `
    <div class="banner ${ST.code}"><span style="font-size:22px">${bannerIcon}</span><div><b>${bannerText}</b></div></div>
    <h2 style="margin:0 0 14px">Namaste, ${esc(M.firstName)} 🙏</h2>
    <div class="stats">
      <div class="stat ${ST.daysLeft <= RULES.expiringSoonDays ? (ST.daysLeft <= 0 ? 'red' : 'amber') : 'green'}"><span>Days until expiry</span><b>${Math.max(ST.daysLeft, 0)}</b><small>Valid until ${fmtDate(M.expiryMs)}</small></div>
      <div class="stat green"><span>Total contributed</span><b>${npr(L.paidTotal)}</b><small>${L.rows.filter((r) => r.status === 'paid').length} month(s) paid</small></div>
      <div class="stat ${L.outstanding ? 'red' : 'green'}"><span>Outstanding dues</span><b>${npr(L.outstanding)}</b><small>${L.missed} missed · ${L.due} due now</small></div>
      <div class="stat"><span>Remaining this term</span><b>${npr(L.upcoming)}</b><small>of ${npr(L.totalCommitment)} commitment</small></div>
      <div class="stat crimson"><span>Monthly contribution</span><b>${npr(M.pledge)}</b><small>${esc(M.memberType)}</small></div>
    </div>

    <div class="dash">
      <div>
        <div class="panel">
          <h3>My membership card</h3>
          <div id="cardBox" class="${ST.code === 'expired' ? 'flash-red' : ''}"></div>
          ${downloadButtons()}
          <p class="hint" style="margin-top:10px">QR link: <a href="${esc(verifyUrl(M.cardToken))}" target="_blank" rel="noopener">verify my card ↗</a></p>
        </div>
        <div class="panel">
          <h3>🔄 Renew membership</h3>
          <p class="hint" style="margin-top:-6px">${esc(renew.msg)}</p>
          <button class="btn btn-primary btn-block" id="renewBtn" ${renew.ok ? '' : 'disabled'}>Renew for 1 more year</button>
        </div>
        <div class="panel">
          <h3>My details</h3>
          <dl class="kv">
            <dt>Member no.</dt><dd class="mono">${esc(M.memberNo)}</dd>
            <dt>Full name</dt><dd>${esc(M.fullName)}</dd>
            <dt>Date of birth</dt><dd>${fmtDate(M.dob)} (${esc(M.dobBS || '')} BS)</dd>
            <dt>Profession</dt><dd>${esc(M.profession)}</dd>
            <dt>Mobile</dt><dd>${esc(M.phone)}</dd>
            ${M.email ? `<dt>E-mail</dt><dd>${esc(M.email)}</dd>` : ''}
            <dt>Permanent</dt><dd>${addr(M.permanentAddress)}</dd>
            <dt>Temporary</dt><dd>${addr(M.temporaryAddress)}</dd>
            <dt>Joined</dt><dd>${fmtDate(M.joinMs)}</dd>
          </dl>
        </div>
      </div>

      <div>
        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">Contribution record</h3>
            <div class="actions">
              <button class="btn btn-green btn-sm" id="payBtn">💳 Pay contribution</button>
              <button class="btn btn-ghost btn-sm" id="waiveBtn">🙏 Request waiver / excuse</button>
            </div>
          </div>
          <div class="sheet ${L.outstanding ? 'owing' : 'clear'}">
            <div style="padding:8px 10px 0;font-weight:600;color:${L.outstanding ? 'var(--red)' : 'var(--green)'}">
              ${L.outstanding ? `⚠ You have ${npr(L.outstanding)} to clear (${L.missed + L.due} month(s))` : '✔ All dues cleared — thank you!'}
            </div>
            <div class="months">${L.rows.map((r) => `<div class="mo ${r.status}"><b>${r.label}</b>${npr(r.amount)}<br><span>${STATUS_TEXT[r.status]}</span></div>`).join('')}</div>
          </div>
          <div class="legend">
            <span><i style="background:var(--green)"></i>Paid</span><span><i style="background:var(--red)"></i>Missed</span>
            <span><i style="background:var(--amber)"></i>Due this month</span><span><i style="background:var(--blue)"></i>Awaiting admin</span>
            <span><i style="background:#94a3b8"></i>Waived</span><span><i style="background:var(--line)"></i>Upcoming</span>
          </div>
        </div>

        <div class="panel">
          <h3>Payments &amp; waiver requests</h3>
          ${history()}
        </div>
      </div>
    </div>`;

  const data = cardData(M, L.paidThrough);
  mountCard(app.querySelector('#cardBox'), data);
  wireDownloads(app, () => data);
  app.querySelector('#payBtn').onclick = payDialog;
  app.querySelector('#waiveBtn').onclick = waiverDialog;
  app.querySelector('#renewBtn').onclick = doRenew;
}

const addr = (a = {}) => esc([a.tole, a.municipality && `${a.municipality}-${a.ward}`, a.district, a.province].filter(Boolean).join(', '));

function history() {
  const items = [
    ...payments.map((p) => ({ ...p, kind: 'Payment' })),
    ...waivers.map((w) => ({ ...w, kind: 'Waiver' })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!items.length) return '<div class="empty">No payments or requests yet.</div>';
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Months</th><th>Amount</th><th>Status</th><th>Admin note</th></tr></thead><tbody>
    ${items.map((x) => `<tr class="${x.status === 'approved' ? 'row-green' : x.status === 'rejected' ? 'row-red' : ''}">
      <td>${fmtDate(x.createdAt)}</td><td>${x.kind}${x.method ? `<br><small class="hint">${esc(x.method)} ${esc(x.ref || '')}</small>` : ''}</td>
      <td>${x.months.map((m) => monthLabelShort(m)).join(', ')}</td>
      <td>${x.kind === 'Payment' ? npr(x.amount) : '—'}</td>
      <td><span class="pill ${x.status}">${x.status}</span></td>
      <td>${esc(x.adminNote || x.adminReason || (x.kind === 'Waiver' ? 'Reason: ' + x.reason : ''))}</td></tr>`).join('')}
  </tbody></table></div>`;
}
const monthLabelShort = (k) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short' }) + ' ' + y.slice(2); };

function monthPicker(rows, preselect) {
  return `<div class="months" style="padding:0;max-height:260px;overflow:auto">${rows.map((r) => `
    <label class="mo ${r.status}" style="cursor:pointer"><input type="checkbox" value="${r.month}" ${preselect.includes(r.status) ? 'checked' : ''} style="width:auto;margin-right:6px"><b style="display:inline">${r.label}</b><br><span>${STATUS_TEXT[r.status]}</span></label>`).join('')}</div>`;
}

function payDialog() {
  const rows = L.rows.filter((r) => ['missed', 'due', 'upcoming'].includes(r.status));
  if (!rows.length) return toast('Nothing to pay — every month is paid, waived or awaiting verification.', 'success');
  const { el, close } = modal(`
    <h3>💳 Pay contribution</h3>
    <p class="hint" style="margin-top:-8px">Select the months you are paying for. Overdue months are pre-selected. Your payment stays pending until an admin verifies it.</p>
    ${monthPicker(rows, ['missed', 'due'])}
    <div class="grid g2" style="margin-top:14px">
      <label class="f">Payment method<select name="method">${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select></label>
      <label class="f">Transaction / receipt no.<input name="ref" placeholder="e.g. eSewa txn ID"></label>
    </div>
    <label class="f" style="margin-top:10px">Note (optional)<input name="note"></label>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:10px">
      <b id="payTotal" style="font-size:18px"></b>
      <button class="btn btn-green" id="paySubmit">Submit payment</button>
    </div><div class="err" id="payErr"></div>`);
  const sel = () => [...el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
  const upd = () => (el.querySelector('#payTotal').textContent = `Total: ${npr(sel().length * M.pledge)}`);
  el.addEventListener('change', upd); upd();
  el.querySelector('#paySubmit').onclick = async () => {
    const months = sel(); const method = el.querySelector('[name=method]').value; const ref = el.querySelector('[name=ref]').value.trim();
    if (!months.length) return (el.querySelector('#payErr').textContent = 'Select at least one month.');
    if (!ref && !method.startsWith('Cash')) return (el.querySelector('#payErr').textContent = 'Enter the transaction / receipt number.');
    try {
      await store.createPayment({ uid: M.uid, memberNo: M.memberNo, name: M.fullName, months: months.sort(), amount: months.length * M.pledge, method, ref, note: el.querySelector('[name=note]').value.trim(), status: 'pending', createdAt: new Date().toISOString() });
      close(); toast('Payment submitted — awaiting admin verification.', 'success'); load();
    } catch (e) { el.querySelector('#payErr').textContent = friendlyError(e); }
  };
}

function waiverDialog() {
  const rows = L.rows.filter((r) => ['missed', 'due', 'upcoming'].includes(r.status));
  if (!rows.length) return toast('There are no unpaid months to excuse.', 'info');
  const { el, close } = modal(`
    <h3>🙏 Request a waiver / excuse</h3>
    <p class="hint" style="margin-top:-8px">If you cannot pay for certain months, explain why. The waiver only applies after an admin approves it.</p>
    ${monthPicker(rows, [])}
    <label class="f" style="margin-top:14px">Reason <span class="req">*</span><textarea name="reason" rows="4" placeholder="Explain your situation (at least 15 characters)"></textarea></label>
    <div class="err" id="wErr"></div>
    <button class="btn btn-primary btn-block" id="wSubmit">Send request to admin</button>`);
  el.querySelector('#wSubmit').onclick = async () => {
    const months = [...el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    const reason = el.querySelector('[name=reason]').value.trim();
    if (!months.length) return (el.querySelector('#wErr').textContent = 'Select at least one month.');
    if (reason.length < 15) return (el.querySelector('#wErr').textContent = 'Please give a reason of at least 15 characters.');
    try {
      await store.createWaiver({ uid: M.uid, memberNo: M.memberNo, name: M.fullName, months: months.sort(), amount: months.length * M.pledge, reason, status: 'pending', createdAt: new Date().toISOString() });
      close(); toast('Waiver request sent to admin.', 'success'); load();
    } catch (e) { el.querySelector('#wErr').textContent = friendlyError(e); }
  };
}

function renewInfo() {
  if (!L.allClear) {
    const p = L.rows.filter((r) => ['pending', 'waiver-pending'].includes(r.status)).length;
    return { ok: false, msg: L.outstanding ? `Clear your outstanding dues of ${npr(L.outstanding)} first (or get a waiver approved), then you can renew.` : `${p} month(s) are awaiting admin verification. You can renew once they are approved.` };
  }
  if (ST.daysLeft > RULES.renewWindowDays) return { ok: false, msg: `All dues are cleared ✔. Renewal opens ${RULES.renewWindowDays} days before your expiry date (${fmtDate(M.expiryMs - RULES.renewWindowDays * 86400000)}).` };
  return { ok: true, msg: ST.daysLeft <= 0 ? 'Your card has expired. Renew now to reactivate it for 12 months from today.' : `All dues cleared ✔. Renew now to extend your card to ${fmtDate(addYears(M.expiryMs))}.` };
}

async function doRenew() {
  const now = new Date();
  const lapsed = M.expiryMs <= now.getTime();
  const last = M.periods[M.periods.length - 1];
  const period = { start: lapsed ? monthKey(now) : addMonths(last.start, last.months), months: RULES.membershipMonths };
  const expiryMs = lapsed ? addYears(now.getTime()) : addYears(M.expiryMs);
  const periods = [...M.periods, period];
  const renewals = [...(M.renewals || []), { at: now.toISOString(), fromMs: M.expiryMs, toMs: expiryMs }];
  try {
    await store.updateMember(M.uid, { expiryMs, periods, renewals });
    await store.updatePublicCard(M.cardToken, { expiryMs, periods });
    toast(`Renewed! Your card is now valid until ${fmtDate(expiryMs)}.`, 'success');
    load();
  } catch (e) { toast(friendlyError(e), 'error'); }
}

load();
