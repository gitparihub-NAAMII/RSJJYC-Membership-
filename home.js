import { PROFESSIONS, DONATION_TIERS, PROVINCES, RULES, MEMBER_TYPES, ORG } from './config.js';
import { friendlyError } from './store.js';
import { initPage, cardData } from './common.js';
import { createDobPicker } from './datepicker.js';
import { mountCard, downloadButtons, wireDownloads } from './card.js';
import { ageOn, addYears, monthKey, uid, compressImage, esc, npr, toast, modal } from './utils.js';

const store = await initPage();
const $ = (s, r = document) => r.querySelector(s);

// ---------- session shortcut ----------
const sess = await store.session();
if (sess) { const b = $('#continueBtn'); b.hidden = false; b.href = sess.role === 'admin' ? 'admin.html' : 'member.html'; }

// ---------- hero sample card ----------
const now = new Date();
mountCard($('#heroCard'), {
  fullName: 'Pradip Chaudhary', memberNo: `0${String(now.getFullYear()).slice(-2)}-RSJJYC-001-PC`, memberType: MEMBER_TYPES[0],
  photo: '', dob: '1998-04-12', joinMs: now.getTime(), expiryMs: addYears(now.getTime()), periods: [{ start: monthKey(now), months: 12 }],
  paidThrough: monthKey(now), cardToken: 'sample',
});

// ---------- tabs ----------
const showTab = (name) => {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  ['register', 'login', 'admin'].forEach((t) => ($('#tab-' + t).hidden = t !== name));
  history.replaceState(null, '', '#' + name);
};
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
if (['login', 'admin'].includes(location.hash.slice(1))) showTab(location.hash.slice(1));
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
  setTimeout(() => { hookI = (hookI + 1) % HOOKS.length; hookEl.textContent = HOOKS[hookI]; hookEl.classList.remove('out'); }, 450);
}, 4200);

// ---------- registration form ----------
const form = $('#regForm');
const F = (n) => form.elements[n];

// professions
$('#profession').innerHTML = '<option value="">Select profession</option>' + PROFESSIONS.map((p) => `<option value="${esc(p.label)}">${esc(p.label)}</option>`).join('');

// address blocks
function addrBlock(kind) {
  const el = form.querySelector(`[data-addr=${kind}]`);
  el.innerHTML = `
    <label class="f">Province <span class="req">*</span><select name="${kind}Province" required><option value="">Select province</option>${Object.keys(PROVINCES).map((p) => `<option value="${p}">${p}</option>`).join('')}</select></label>
    <label class="f">District <span class="req">*</span><select name="${kind}District" required disabled><option value="">Select district</option></select></label>
    <label class="f">Municipality / Rural Mun. <span class="req">*</span><input name="${kind}Municipality" required placeholder="e.g. Kathmandu Metropolitan City"></label>
    <label class="f">Ward no. <span class="req">*</span><input name="${kind}Ward" type="number" min="1" max="35" required></label>
    <label class="f" style="grid-column:1/-1">Tole / Street<input name="${kind}Tole" placeholder="e.g. Baneshwor, House no."></label>`;
  const prov = F(kind + 'Province'), dist = F(kind + 'District');
  prov.addEventListener('change', () => {
    dist.innerHTML = '<option value="">Select district</option>' + (PROVINCES[prov.value] || []).map((d) => `<option value="${d}">${d}</option>`).join('');
    dist.disabled = !prov.value;
  });
}
addrBlock('permanent'); addrBlock('temporary');
const ADDR = ['Province', 'District', 'Municipality', 'Ward', 'Tole'];
const readAddr = (k) => Object.fromEntries(ADDR.map((f) => [f.toLowerCase(), F(k + f).value.trim()]));
function copyAddr() {
  ADDR.forEach((f) => {
    const t = F('temporary' + f);
    if (f === 'Province') { t.value = F('permanentProvince').value; t.dispatchEvent(new Event('change')); } else t.value = F('permanent' + f).value;
  });
}
$('#sameAddr').addEventListener('change', (e) => {
  const block = form.querySelector('[data-addr=temporary]');
  if (e.target.checked) copyAddr();
  block.querySelectorAll('input,select').forEach((x) => (x.disabled = e.target.checked || (x.name.endsWith('District') && !F('temporaryProvince').value)));
  block.style.opacity = e.target.checked ? .55 : 1;
});
form.querySelector('[data-addr=permanent]').addEventListener('input', () => { if ($('#sameAddr').checked) copyAddr(); });
form.querySelector('[data-addr=permanent]').addEventListener('change', () => { if ($('#sameAddr').checked) setTimeout(copyAddr); });

// DOB + age
let dob = { ad: '' };
createDobPicker($('#dobPicker'), (v) => {
  dob = v;
  const box = $('#ageBox');
  if (!v.ad) { box.innerHTML = '<small>Select your date of birth</small>'; return; }
  const a = ageOn(v.ad, new Date());
  box.innerHTML = `${a.years} years ${a.months} months <small>· as of ${new Date().toLocaleDateString('en-GB')}</small>`;
});

// profession -> tiers
const profObj = () => PROFESSIONS.find((p) => p.label === F('profession').value);
F('profession').addEventListener('change', () => {
  const p = profObj();
  $('#otherProfWrap').hidden = F('profession').value !== 'Other';
  const tiers = p ? (p.employed ? DONATION_TIERS.employed : DONATION_TIERS.notEmployed) : [];
  $('#tierHint').textContent = p
    ? (p.employed ? 'As a working professional, choose your monthly donation:' : 'As a student / not currently employed, choose any monthly donation that suits you:')
    : 'Choose your profession first to see the contribution options.';
  $('#tiers').innerHTML = tiers.map((t, i) => `<label><input type="radio" name="pledge" value="${t}" ${i === 0 ? 'checked' : ''}><span>${npr(t)}<small>per month · ${npr(t * 12)}/yr</small></span></label>`).join('');
});

// photo
let photoData = '';
const photoIn = $('#photo'), drop = $('#photoDrop');
async function takePhoto(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type)) return toast('Photo must be PNG or JPG', 'error');
  if (file.size > RULES.maxPhotoMB * 1024 * 1024) return toast(`Photo must be smaller than ${RULES.maxPhotoMB} MB`, 'error');
  try {
    photoData = await compressImage(file);
    $('#photoPv').style.backgroundImage = `url(${photoData})`; $('#photoPv').textContent = '';
  } catch { toast('Could not read that image', 'error'); }
}
photoIn.addEventListener('change', () => takePhoto(photoIn.files[0]));
['dragover', 'dragenter'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('drag')));
drop.addEventListener('drop', (ev) => { ev.preventDefault(); takePhoto(ev.dataTransfer.files[0]); });

// username preview + password meter
const username = () => (form.elements.userType.value === 'email' ? F('email').value.trim().toLowerCase() : F('phone').value.replace(/[^\d]/g, ''));
const refreshUser = () => ($('#usernamePreview').value = username());
['phone', 'email'].forEach((n) => F(n).addEventListener('input', refreshUser));
form.querySelectorAll('input[name=userType]').forEach((r) => r.addEventListener('change', refreshUser));
F('password').addEventListener('input', () => {
  const v = F('password').value;
  const s = [v.length >= 8, /[A-Z]/.test(v), /[a-z]/.test(v), /\d/.test(v), /[^\w]/.test(v)].filter(Boolean).length;
  const bar = $('#pwBar');
  bar.style.width = (s / 5) * 100 + '%';
  bar.style.background = s <= 2 ? 'var(--red)' : s <= 3 ? 'var(--amber)' : 'var(--green)';
});

// submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#regErr'); err.textContent = '';
  form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
  const bad = (el, msg) => { if (el) { el.classList.add('bad'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } err.textContent = msg; return false; };

  // required fields
  for (const el of form.querySelectorAll('[required]')) {
    if (el.disabled || el.type === 'checkbox') continue;
    if (!el.value.trim()) return bad(el, 'Please fill in all required fields.');
  }
  if (!dob.ad) return bad($('#dobPicker input:not([hidden])'), 'Please select your date of birth.');
  const phone = F('phone').value.replace(/[^\d]/g, '');
  if (!/^9\d{9}$/.test(phone)) return bad(F('phone'), 'Enter a valid 10-digit Nepali mobile number (98XXXXXXXX).');
  const email = F('email').value.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(F('email'), 'Enter a valid e-mail address.');
  if (form.elements.userType.value === 'email' && !email) return bad(F('email'), 'Enter your e-mail to use it as your username.');
  if (F('profession').value === 'Other' && !F('professionOther').value.trim()) return bad(F('professionOther'), 'Please specify your profession.');
  if (!photoData) return bad(drop, 'Please upload your photo.');
  if (F('password').value.length < 6) return bad(F('password'), 'Password must be at least 6 characters.');
  if (F('password').value !== F('password2').value) return bad(F('password2'), 'Passwords do not match.');
  const pledgeEl = form.querySelector('input[name=pledge]:checked');
  if (!pledgeEl) return bad($('#tiers'), 'Please choose a monthly contribution.');
  if (!$('#agree').checked) return bad($('#agree'), 'Please confirm the declaration.');

  const applied = new Date();
  const first = F('firstName').value.trim(), middle = F('middleName').value.trim(), last = F('lastName').value.trim();
  const prof = profObj();
  const member = {
    firstName: first, middleName: middle, lastName: last,
    fullName: [first, middle, last].filter(Boolean).join(' '),
    dob: dob.ad, dobBS: dob.bs, dobCalendar: dob.calendar,
    ageAtApplication: ageOn(dob.ad, applied).years,
    gender: F('gender').value,
    phone, email, username: username(),
    profession: F('profession').value === 'Other' ? `Other: ${F('professionOther').value.trim()}` : F('profession').value,
    employed: !!prof?.employed,
    pledge: Number(pledgeEl.value),
    permanentAddress: readAddr('permanent'),
    temporaryAddress: readAddr('temporary'),
    photo: photoData,
    memberType: MEMBER_TYPES[0],
    joinYear: applied.getFullYear(),
    joinMs: applied.getTime(),
    expiryMs: addYears(applied.getTime(), 1),
    periods: [{ start: monthKey(applied), months: RULES.membershipMonths }],
    renewals: [],
    paidThrough: null,
    cardToken: uid(24),
    createdAt: applied.toISOString(),
  };
  const pub = cardData(member, null);
  delete pub.cardToken;

  const btn = $('#regBtn'); btn.disabled = true; btn.textContent = 'Creating your membership…';
  try {
    const saved = await store.registerMember(member, member.username, F('password').value, pub);
    showSuccess(saved);
  } catch (ex) {
    err.textContent = friendlyError(ex);
  } finally { btn.disabled = false; btn.textContent = 'Register & generate my membership card'; }
});

function showSuccess(m) {
  const { el } = modal(`
    <h3>🎉 Welcome, ${esc(m.firstName)}!</h3>
    <p class="sub" style="margin-top:-6px">Your membership number is <b class="mono">${esc(m.memberNo)}</b>. Valid until ${new Date(m.expiryMs).toLocaleDateString('en-GB')}.</p>
    <div id="newCard"></div>${downloadButtons()}
    <p class="hint" style="margin-top:14px">Log in any time with username <b>${esc(m.username)}</b> to see your contributions, pay dues and renew.</p>
    <a class="btn btn-primary btn-block" href="member.html" style="margin-top:8px">Go to my dashboard →</a>`, { wide: true });
  const data = cardData(m);
  mountCard(el.querySelector('#newCard'), data);
  wireDownloads(el, () => data);
  form.reset(); photoData = ''; $('#photoPv').style.backgroundImage = ''; $('#photoPv').textContent = '📷';
}

// ---------- member login ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; $('#loginErr').textContent = '';
  try {
    const s = await store.loginMember(f.username.value, f.password.value);
    location.href = s.role === 'admin' ? 'admin.html' : 'member.html';
  } catch (ex) { $('#loginErr').textContent = friendlyError(ex); }
});

// ---------- admin login ----------
$('#adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; $('#adminErr').textContent = '';
  try { await store.loginAdmin(f.username.value, f.password.value); location.href = 'admin.html'; }
  catch (ex) { $('#adminErr').textContent = friendlyError(ex); }
});
