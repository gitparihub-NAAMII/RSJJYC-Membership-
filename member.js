import { PAYMENT_METHODS, PAYMENT, RULES, ORG } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { mountCard, downloadButtons, wireDownloads, verifyUrl } from './card.js';
import { renderProfileForm } from './profile.js';
import { nextDue, reminderText, syncReminders, enableNotifications, notifyState, downloadCalendar } from './reminders.js';
import { buildLedger, cardStatus, esc, npr, fmtDate, modal, toast, monthKey, addMonths, addYears, STATUS_TEXT, readReceipt, showReceipt } from './utils.js';

const store = await initPage();
const app = document.getElementById('app');
const sess = await store.session();
if (!sess || sess.role !== 'member') { location.replace(sess?.role === 'admin' ? 'admin.html' : 'index.html#login'); throw new Error('redirect'); }
document.getElementById('logout').onclick = async () => { await store.logout(); location.href = 'index.html'; };

let M, payments, waivers, L, ST;

async function load() {
  M = await store.getMember(sess.uid);
  if (!M) {
    // Step 2 — the full membership form lives here, behind the login
    renderProfileForm(app, store, sess, (m) => { welcome(m); load(); });
    return;
  }
  [payments, waivers] = await Promise.all([store.listPayments(sess.uid), store.listWaivers(sess.uid)]);
  L = buildLedger(M, payments, waivers);
  ST = cardStatus({ ...M, paidThrough: L.paidThrough });
  render();
}

function welcome(m) {
  const { el } = modal(`
    <h3>🎉 Welcome, ${esc(m.firstName)}!</h3>
    <p class="sub" style="margin-top:-6px">Your membership number is <b class="mono">${esc(m.memberNo)}</b>. Valid until ${new Date(m.expiryMs).toLocaleDateString('en-GB')}.</p>
    <div id="newCard"></div>${downloadButtons()}
    <button class="btn btn-primary btn-block" data-close style="margin-top:14px">Go to my dashboard</button>`, { wide: true });
  const data = cardData(m);
  mountCard(el.querySelector('#newCard'), data);
  wireDownloads(el, () => data);
}

function render() {
  const renew = renewInfo();
  const bannerIcon = { active: '✅', expiring: '⚠️', expired: '⛔' }[ST.code];
  const bannerText = ST.code === 'expired'
    ? `<span>Your card is EXPIRED — renew soon.</span> <span style="font-weight:400">(${esc(ST.reason)})</span>`
    : `<span>${ST.code === 'expiring' ? esc(ST.label) : 'Your membership is ACTIVE'}</span> — <span>${esc(ST.reason)}</span>`;

  const due = nextDue(M, L);
  const dueBanner = due && due.daysLeft <= 7
    ? `<div class="banner due-banner ${due.overdue ? 'expired' : 'expiring'}"><span style="font-size:22px">${due.overdue ? '⏰' : '🔔'}</span>
        <div style="flex:1"><b>${esc(reminderText(due))}</b></div><button class="btn btn-sm ${due.overdue ? 'btn-red' : 'btn-amber'}" id="dueNow">Pay now</button></div>` : '';

  app.innerHTML = `
    <div class="banner ${ST.code}"><span style="font-size:22px">${bannerIcon}</span><div><b>${bannerText}</b></div></div>
    ${dueBanner}
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
        <div class="panel" id="remindPanel">
          <h3>🔔 Payment reminders</h3>
          <p class="hint" style="margin-top:-6px">${due ? `Next payment: <b>${npr(due.amount)}</b> for ${esc(due.label)}, due on <b>${fmtDate(due.due)}</b>.` : 'Nothing left to pay this term. ✔'}</p>
          <p class="hint">We remind you <b>7, 5 and 3 days</b> before each due date, and every day while a payment is overdue, until it is paid.</p>
          <div class="remind-row"><span id="notifState"></span><button class="btn btn-sm" id="notifBtn">Turn on phone notifications</button></div>
          <button class="btn btn-sm btn-ghost btn-block" id="calBtn" style="margin-top:10px" ${due ? '' : 'disabled'}>📅 Add reminders to my phone calendar</button>
          <p class="hint" style="margin-top:8px">Calendar alarms work even when the app is closed. Notifications also appear when you open the app.</p>
        </div>
        <div class="panel">
          <h3>My details</h3>
          <dl class="kv">
            <dt>Member no.</dt><dd class="mono">${esc(M.memberNo)}</dd>
            <dt>Full name</dt><dd>${esc(M.fullName)}</dd>
            <dt>Date of birth</dt><dd>${fmtDate(M.dob)} (${esc(M.dobBS || '')} BS)</dd>
            <dt>Blood group</dt><dd>${esc(M.bloodGroup || '—')}</dd>
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

  // ---- reminders ----
  app.querySelector('#dueNow')?.addEventListener('click', payDialog);
  const ns = app.querySelector('#notifState'), nb = app.querySelector('#notifBtn');
  const showNotif = () => {
    const s = notifyState();
    ns.className = 'pill ' + (s === 'granted' ? 'paid' : s === 'denied' ? 'rejected' : 'pending');
    ns.textContent = s === 'granted' ? 'Notifications ON' : s === 'denied' ? 'Notifications blocked' : s === 'unsupported' ? 'Not supported here' : 'Notifications OFF';
    nb.hidden = s === 'granted' || s === 'unsupported';
    if (s === 'denied') { nb.hidden = false; nb.textContent = 'How to allow'; }
  };
  nb.onclick = async () => {
    if (notifyState() === 'denied') return toast('Notifications are blocked. Open your phone Settings → Apps → Chrome (or RSJJYC) → Notifications, allow them, then reopen the app.', 'info');
    const r = await enableNotifications();
    showNotif();
    if (r === 'granted') { toast('Reminders turned on.', 'success'); syncReminders(due); }
  };
  showNotif();
  app.querySelector('#calBtn').onclick = () => {
    const n = downloadCalendar(M, L);
    toast(n ? `Calendar file saved with ${n} due date(s). Open it to add the reminders to your calendar.` : 'Nothing left to pay this term.', n ? 'success' : 'info');
  };
  syncReminders(due);
  app.querySelectorAll('[data-receipt]').forEach((b) => (b.onclick = async () => showReceipt(await store.getReceipt(b.dataset.receipt))));
}

const addr = (a = {}) => esc([a.tole, a.municipality && `${a.municipality}-${a.ward}`, a.district, a.province].filter(Boolean).join(', '));


// ---------- history ----------
function history() {
  const items = [
    ...payments.map((p) => ({ ...p, kind: 'Payment' })),
    ...waivers.map((w) => ({ ...w, kind: 'Waiver' })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!items.length) return '<div class="empty">No payments or requests yet.</div>';
  const label = (x) => (x.kind === 'Payment' && x.status === 'approved' ? 'paid' : x.status);
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Months</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Admin note</th></tr></thead><tbody>
    ${items.map((x) => `<tr class="${x.status === 'approved' ? 'row-green' : x.status === 'rejected' ? 'row-red' : ''}">
      <td>${fmtDate(x.createdAt)}</td><td>${x.kind}${x.method ? `<br><small class="hint">${esc(x.method)} ${esc(x.ref || '')}</small>` : ''}</td>
      <td>${x.months.map((m) => monthLabelShort(m)).join(', ')}</td>
      <td>${x.kind === 'Payment' ? npr(x.amount) : '—'}</td>
      <td><span class="pill ${label(x) === 'paid' ? 'paid' : x.status}">${label(x)}</span></td>
      <td>${x.hasReceipt ? `<button class="btn btn-sm btn-ghost" data-receipt="${esc(x.id)}">🧾 View</button>` : '—'}</td>
      <td>${esc(x.adminNote || x.adminReason || (x.kind === 'Waiver' ? 'Reason: ' + x.reason : ''))}</td></tr>`).join('')}
  </tbody></table></div>`;
}
const monthLabelShort = (k) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short' }) + ' ' + y.slice(2); };

function monthPicker(rows, preselect) {
  return `<div class="months" style="padding:0;max-height:220px;overflow:auto">${rows.map((r) => `
    <label class="mo ${r.status}" style="cursor:pointer"><input type="checkbox" value="${r.month}" ${preselect.includes(r.status) ? 'checked' : ''} style="width:auto;margin-right:6px"><b style="display:inline">${r.label}</b><br><span>${STATUS_TEXT[r.status]}</span></label>`).join('')}</div>`;
}

// ---------- pay: QR + receipt upload ----------
function payDialog() {
  const rows = L.rows.filter((r) => ['missed', 'due', 'upcoming'].includes(r.status));
  if (!rows.length) return toast('Nothing to pay — every month is paid, waived or awaiting verification.', 'success');
  const { el, close } = modal(`
    <h3>💳 Pay contribution</h3>
    <p class="pay-step"><span>1</span> Select the months you are paying for</p>
    ${monthPicker(rows, ['missed', 'due'])}
    <div class="pay-total"><span>Amount to pay</span><b id="payTotal"></b></div>

    <p class="pay-step"><span>2</span> Scan the QR code and pay this amount</p>
    <div class="pay-qr">
      <div class="pay-qr-box" id="payQr">${PAYMENT.qrImage ? `<img src="${esc(PAYMENT.qrImage)}" alt="Payment QR">` : ''}</div>
      <div>
        <b>${esc(PAYMENT.accountName)}</b>
        <p class="hint" style="margin:4px 0 8px">${esc(PAYMENT.details)}</p>
        ${PAYMENT.qrImage ? '' : '<span class="demo-tag">Online payment gateway is being set up. For now, pay the club directly and upload the receipt.</span>'}
      </div>
    </div>

    <p class="pay-step"><span>3</span> Upload your payment receipt</p>
    <div class="grid g2">
      <label class="f">Payment method<select name="method">${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select></label>
      <label class="f">Transaction ID (optional)<input name="ref" placeholder="e.g. eSewa txn ID"></label>
    </div>
    <label class="receipt-drop" id="rcDrop">
      <div class="rc-pv" id="rcPv">🧾</div>
      <div><b>Upload receipt</b> <span class="req">*</span><br><span class="hint">Screenshot or photo (JPG/PNG) or a small PDF. The payment is completed only after the receipt is uploaded.</span></div>
      <input type="file" id="rcFile" accept="image/png,image/jpeg,application/pdf">
    </label>
    <div class="err" id="payErr"></div>
    <button class="btn btn-green btn-block" id="paySubmit" disabled>Upload receipt &amp; complete payment</button>`, { wide: true });

  if (!PAYMENT.qrImage && window.QRCode) {
    new window.QRCode(el.querySelector('#payQr'), { text: new URL('pay-soon.html', ORG.siteUrl || location.href).href, width: 150, height: 150, correctLevel: window.QRCode.CorrectLevel.M });
  }
  const sel = () => [...el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
  const upd = () => {
    el.querySelector('#payTotal').textContent = npr(sel().length * M.pledge);
    el.querySelector('#paySubmit').disabled = !receipt || !sel().length;
  };
  let receipt = null;
  const fileIn = el.querySelector('#rcFile'), drop = el.querySelector('#rcDrop'), pv = el.querySelector('#rcPv');
  const take = async (file) => {
    if (!file) return;
    el.querySelector('#payErr').textContent = '';
    if (file.size > PAYMENT.maxReceiptMB * 1024 * 1024) { el.querySelector('#payErr').textContent = `Receipt must be smaller than ${PAYMENT.maxReceiptMB} MB.`; return; }
    try {
      receipt = await readReceipt(file);
      pv.style.backgroundImage = receipt.type === 'image' ? `url(${receipt.data})` : '';
      pv.textContent = receipt.type === 'pdf' ? '📄' : '';
      drop.classList.add('has-file');
      drop.querySelector('b').textContent = '✔ ' + file.name;
    } catch (e) { receipt = null; el.querySelector('#payErr').textContent = e.message; }
    upd();
  };
  fileIn.addEventListener('change', () => take(fileIn.files[0]));
  ['dragover', 'dragenter'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); take(ev.dataTransfer.files[0]); });
  el.addEventListener('change', (e) => { if (e.target.type === 'checkbox') upd(); });
  upd();

  el.querySelector('#paySubmit').onclick = async () => {
    const months = sel();
    if (!months.length) return (el.querySelector('#payErr').textContent = 'Select at least one month.');
    if (!receipt) return (el.querySelector('#payErr').textContent = 'Please upload your payment receipt.');
    const btn = el.querySelector('#paySubmit'); btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const now = new Date().toISOString();
      await store.createPayment({
        uid: M.uid, memberNo: M.memberNo, name: M.fullName, months: months.sort(), amount: months.length * M.pledge,
        method: el.querySelector('[name=method]').value, ref: el.querySelector('[name=ref]').value.trim(),
        status: 'approved', reviewed: false, createdAt: now, paidAt: now,
      }, receipt);
      // keep the public QR card in sync with the new paid-through month
      const fresh = buildLedger(M, await store.listPayments(M.uid), waivers);
      await store.updateMember(M.uid, { paidThrough: fresh.paidThrough });
      await store.updatePublicCard(M.cardToken, { paidThrough: fresh.paidThrough });
      close(); toast('Payment completed ✔ Receipt uploaded.', 'success'); load();
    } catch (e) { el.querySelector('#payErr').textContent = friendlyError(e); btn.disabled = false; btn.textContent = 'Upload receipt & complete payment'; }
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
