import { MEMBER_TYPES, ORG } from './config.js';
import { friendlyError } from './store.js';
import { initPage } from './common.js';
import { mountCard } from './card.js';
import { addEyeButtons, attachPasswordUX } from './password.js';
import { addYears, monthKey, esc, modal, toast, normalizeUsername } from './utils.js';

const store = await initPage();
const $ = (s, r = document) => r.querySelector(s);

// ---------- session shortcut ----------
const sess = await store.session();
if (sess) { const b = $('#continueBtn'); b.hidden = false; b.href = sess.role === 'admin' ? 'admin.html' : 'member.html'; }

// ---------- hero sample card ----------
const now = new Date();
mountCard($('#heroCard'), {
  fullName: 'ABC Chaudhary', memberNo: `0${String(now.getFullYear()).slice(-2)}-RSJJYC-001-AC`, memberType: MEMBER_TYPES[0], masked: true,
  photo: '', dob: '2000-01-01', bloodGroup: 'O+', joinMs: now.getTime(), expiryMs: addYears(now.getTime()), periods: [{ start: monthKey(now), months: 12 }],
  paidThrough: monthKey(now), cardToken: 'sample',
});

// ---------- installed-app mode (splash + app home screen) ----------
const root = document.documentElement;
const isApp = root.classList.contains('app-mode');

// ---------- tabs ----------
const showTab = (name) => {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  ['register', 'login', 'admin'].forEach((t) => ($('#tab-' + t).hidden = t !== name));
  if (isApp) {
    if (!root.classList.contains('app-screen')) history.pushState({ screen: name }, '', '#' + name);
    else history.replaceState({ screen: name }, '', '#' + name);
    root.classList.add('app-screen');
    window.scrollTo(0, 0);
  } else history.replaceState(null, '', '#' + name);
};

if (isApp) {
  if (root.classList.contains('app-splash')) {
    try { sessionStorage.setItem('splashShown', '1'); } catch {}
    setTimeout(() => { $('#splash').classList.add('out'); setTimeout(() => root.classList.remove('app-splash'), 650); }, 2300);
  }
  const closeScreen = () => {
    root.classList.remove('app-screen');
    ['register', 'login', 'admin'].forEach((t) => ($('#tab-' + t).hidden = true));
    window.scrollTo(0, 0);
  };
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.open)));
  $('#appBack').addEventListener('click', () => (history.state?.screen ? history.back() : (closeScreen(), history.replaceState(null, '', location.pathname))));
  window.addEventListener('popstate', (e) => { if (e.state?.screen) showTab(e.state.screen); else closeScreen(); });
  if (sess) { $('#appDash').hidden = false; $('#appDash').href = sess.role === 'admin' ? 'admin.html' : 'member.html'; }
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  showTab(b.dataset.tab);
  // on phones the form is below the fold: bring it into view
  if (innerWidth < 1000) document.getElementById('tab-' + b.dataset.tab).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
if (['register', 'login', 'admin'].includes(location.hash.slice(1))) showTab(location.hash.slice(1));
document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault(); showTab(a.dataset.go);
  $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// ---------- motivational hook lines (rotate) ----------
const years = new Date().getFullYear() - ORG.established;
$('#yrs').textContent = years + '+';
const HOOKS = [
  'Be part of a greater youth community serving since 1979.',
  'Be the change you want to see in society.',
  `${years} years of youth service. Your chapter starts here.`,
  'Your energy + our legacy = a stronger community.',
  'Join hands today — together we change tomorrow.',
  'Every member makes the society stronger. Make your mark.',
];
let hookI = 0;
const hookEl = $('#hook');
setInterval(() => {
  hookEl.classList.add('out');
  setTimeout(() => { hookI = (hookI + 1) % HOOKS.length; hookEl.textContent = HOOKS[hookI]; hookEl.classList.remove('out'); const ah = $('#appHook'); if (ah) ah.textContent = HOOKS[hookI]; }, 450);
}, 4200);

// ---------- password fields ----------
addEyeButtons(document);
attachPasswordUX($('#regPw'), $('#regPw2'));

// ---------- step 1: create account (username + password only) ----------
const usernameError = (raw) => {
  const v = raw.trim();
  if (!v) return 'Enter your mobile number or e-mail.';
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid e-mail address.';
  return /^9\d{9}$/.test(normalizeUsername(v)) ? '' : 'Enter a valid 10-digit Nepali mobile number (98XXXXXXXX).';
};
$('#regUser').addEventListener('blur', () => {
  const e = usernameError($('#regUser').value);
  $('#regUser').classList.toggle('bad', !!e && !!$('#regUser').value);
});
$('#regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#regErr'); err.textContent = '';
  const u = $('#regUser').value;
  const ue = usernameError(u);
  if (ue) { $('#regUser').classList.add('bad'); err.textContent = ue; return; }
  if ($('#regPw').value.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
  if ($('#regPw').value !== $('#regPw2').value) { err.textContent = 'Passwords do not match.'; return; }
  const btn = $('#regBtn'); btn.disabled = true; btn.textContent = 'Creating your account…';
  try {
    await store.createAccount(u, $('#regPw').value);
    // Account created -> show the Member Log In form; first log-in opens the membership form
    await store.logout();
    $('#regForm').reset();
    $('#regForm').querySelectorAll('input').forEach((i) => i.dispatchEvent(new Event('input')));
    btn.disabled = false; btn.textContent = 'Create my account';
    showTab('login');
    $('#loginForm').username.value = u.trim();
    $('#loginOk').hidden = false;
    $('#loginForm').password.focus();
    $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (ex) {
    err.textContent = friendlyError(ex);
    btn.disabled = false; btn.textContent = 'Create my account';
  }
});

// ---------- member login ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; $('#loginErr').textContent = '';
  try {
    const s = await store.loginMember(f.username.value, f.password.value);
    location.href = s.role === 'admin' ? 'admin.html' : 'member.html';
  } catch (ex) { $('#loginErr').textContent = friendlyError(ex); }
});

// ---------- forgot password ----------
// one reset per user every 15 minutes (counted from the last successful reset request)
const FP_WAIT = 15 * 60 * 1000;
const fpKey = (u) => 'rsjjyc_fp_' + normalizeUsername(u);
const fpLeft = (u) => { try { const t = Number(localStorage.getItem(fpKey(u)) || 0); return Math.max(0, t + FP_WAIT - Date.now()); } catch { return 0; } };
const fpMark = (u) => { try { localStorage.setItem(fpKey(u), String(Date.now())); } catch {} };
const fpWaitMsg = (ms) => `You can use Forgot password again in ${Math.ceil(ms / 60000)} minute(s).`;
$('#forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  const { el, close } = modal(`
    <h3>🔑 Reset your password</h3>
    <p class="hint" style="margin-top:-6px">Enter the e-mail or mobile number you use to log in.</p>
    <label class="f">Username (mobile or e-mail)<input id="fpUser" value="${esc($('#loginForm').username.value)}"></label>
    <div id="fpDemo" hidden style="margin-top:12px">
      <p class="hint">Demo mode: set a new password here (on the live site a reset link is e-mailed instead).</p>
      <label class="f">New password<input type="password" id="fpPw"></label>
      <label class="f" style="margin-top:10px">Confirm new password<input type="password" id="fpPw2"></label>
    </div>
    <div class="err" id="fpErr" style="margin-top:8px"></div>
    <p class="ok-msg" id="fpOk" hidden></p>
    <button class="btn btn-primary btn-block" id="fpBtn">Send reset link</button>`);
  const err = el.querySelector('#fpErr'), ok = el.querySelector('#fpOk'), btn = el.querySelector('#fpBtn');
  let demoReady = false, ux;
  btn.onclick = async () => {
    err.textContent = '';
    const u = el.querySelector('#fpUser').value;
    const ue = usernameError(u); if (ue) { err.textContent = ue; return; }
    if (!demoReady && fpLeft(u)) { err.textContent = fpWaitMsg(fpLeft(u)); return; }
    try {
      if (demoReady) {
        if (!ux.valid()) { err.textContent = 'Passwords do not match.'; return; }
        await store.demoSetPassword(u, el.querySelector('#fpPw').value);
        fpMark(u);
        close(); toast('Password changed. You can log in now.', 'success'); return;
      }
      const r = await store.resetPassword(u);
      if (r === 'demo') {
        demoReady = true; el.querySelector('#fpDemo').hidden = false; btn.textContent = 'Save new password';
        addEyeButtons(el); ux = attachPasswordUX(el.querySelector('#fpPw'), el.querySelector('#fpPw2'));
      } else {
        fpMark(u);
        ok.hidden = false; ok.textContent = '✔ Reset link sent. Check your e-mail inbox (and the spam folder), open the link and choose a new password.';
        btn.hidden = true;
      }
    } catch (ex) { err.textContent = friendlyError(ex); }
  };
});

// ---------- admin login ----------
$('#adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; $('#adminErr').textContent = '';
  try { await store.loginAdmin(f.username.value, f.password.value); location.href = 'admin.html'; }
  catch (ex) { $('#adminErr').textContent = friendlyError(ex); }
});
