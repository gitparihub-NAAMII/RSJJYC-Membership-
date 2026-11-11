// ============================================================================
//  Step 2: full membership form — shown inside the member dashboard only,
//  after the person has created an account and logged in.
// ============================================================================
import { PROFESSIONS, DONATION_TIERS, PROVINCES, RULES, MEMBER_TYPES, BLOOD_GROUPS } from './config.js';
import { friendlyError } from './store.js';
import { cardData } from './common.js';
import { createDobPicker } from './datepicker.js';
import { ageOn, addYears, monthKey, uid, compressImage, esc, npr, toast, checkUpload } from './utils.js';
import { openPaymentPopup } from './payui.js';

export function renderProfileForm(root, store, sess, onDone) {
  const username = sess.username || '';
  const isEmail = username.includes('@');
  root.innerHTML = `
  <div class="panel">
    <h2>Complete your membership details</h2>
    <p class="sub">Step 2 of 2: fill in your details to get your membership number and digital card. Logged in as <b>${esc(username)}</b>.</p>
    <ol class="steps"><li class="done">Create account</li><li class="on">Fill in membership details</li><li>Get your card</li></ol>
    <form id="regForm" novalidate>
      <fieldset>
        <legend><span class="n">1</span> Personal details</legend>
        <div class="grid g3">
          <label class="f">First name <span class="req">*</span><input name="firstName" required autocomplete="given-name"></label>
          <label class="f">Middle name<input name="middleName" autocomplete="additional-name"></label>
          <label class="f">Surname <span class="req">*</span><input name="lastName" required autocomplete="family-name"></label>
        </div>
        <div class="grid g2" style="margin-top:14px">
          <div class="f"><label class="f">Date of birth <span class="req">*</span></label><div id="dobPicker"></div></div>
          <div class="f"><label class="f">Age (as of application date)</label><div class="age-box" id="ageBox"><small>Select your date of birth</small></div></div>
        </div>
        <div class="grid g4" style="margin-top:14px">
          <label class="f">Gender
            <select name="gender"><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option><option value="Prefer not to say">Prefer not to say</option></select>
          </label>
          <label class="f">Blood group <span class="req">*</span>
            <select name="bloodGroup" required><option value="">Select</option>${BLOOD_GROUPS.map((b) => `<option value="${b}">${b}</option>`).join('')}</select>
          </label>
          <label class="f">Mobile number <span class="req">*</span><input name="phone" inputmode="tel" placeholder="98XXXXXXXX" required autocomplete="tel" ${!isEmail ? `value="${esc(username)}" readonly` : ''}></label>
          <label class="f">E-mail${isEmail ? ' <span class="req">*</span>' : ''}<input name="email" type="email" placeholder="name@gmail.com" autocomplete="email" ${isEmail ? `value="${esc(username)}" readonly` : ''}></label>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">2</span> Profession</legend>
        <div class="grid g2">
          <label class="f">What is your profession? <span class="req">*</span><select name="profession" id="profession" required></select></label>
          <label class="f" id="otherProfWrap" hidden>Please specify<input name="professionOther"></label>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">3</span> Address</legend>
        <h3 style="font-size:14px;margin:0 0 10px">Permanent address</h3>
        <div class="grid g4" data-addr="permanent"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px;gap:10px;flex-wrap:wrap">
          <h3 style="font-size:14px;margin:0">Temporary address</h3>
          <label class="check"><input type="checkbox" id="sameAddr"> Same as permanent address</label>
        </div>
        <div class="grid g4" data-addr="temporary"></div>
      </fieldset>

      <fieldset>
        <legend><span class="n">4</span> Photo</legend>
        <label class="photo-drop" id="photoDrop">
          <div class="pv" id="photoPv">📷</div>
          <div><b>Upload a passport-size photo</b> <span class="req">*</span><br><span class="hint">PNG or JPG, up to 10 MB, one photo only. Face clearly visible — this photo is printed on your membership card.</span></div>
          <input type="file" id="photo" accept="image/png,image/jpeg">
        </label>
      </fieldset>

      <fieldset>
        <legend><span class="n">5</span> Monthly contribution</legend>
        <p class="hint" id="tierHint" style="margin-top:0">Choose your profession first to see the contribution options.</p>
        <div class="tiers" id="tiers"></div>
        <div class="pay-status" id="payStatus"></div>
      </fieldset>

      <label class="check" style="margin-bottom:16px"><input type="checkbox" id="agree"> I confirm the information above is correct and agree to contribute monthly to keep my membership active.</label>
      <div class="err" id="regErr"></div>
      <button class="btn btn-primary btn-block" id="regBtn" type="submit">Submit &amp; generate my membership card</button>
    </form>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const form = $('#regForm');
  const F = (n) => form.elements[n];

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
    block.style.opacity = e.target.checked ? 0.55 : 1;
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
    $('#tiers').innerHTML = tiers.map((t) => `<label><input type="radio" name="pledge" value="${t}"><span>${npr(t)}<small>per month · ${npr(t * 12)}/yr</small></span></label>`).join('');
    firstPay = null; showPayStatus();
  });

  // choosing an amount opens the payment popup (QR + receipt upload)
  let firstPay = null;
  function showPayStatus() {
    const box = $('#payStatus');
    const sel = form.querySelector('input[name=pledge]:checked');
    if (firstPay && sel && firstPay.amount === Number(sel.value)) {
      box.className = 'pay-status ok';
      box.innerHTML = `<span>✔ Receipt uploaded for ${npr(firstPay.amount)} (first month).</span> <a href="#" id="payAgain">Change</a>`;
      box.querySelector('#payAgain').onclick = (e) => { e.preventDefault(); askPayment(firstPay.amount); };
    } else if (sel) {
      box.className = 'pay-status no';
      box.innerHTML = `<span>⚠ Payment receipt not uploaded yet.</span> <a href="#" id="payNow">Pay now</a>`;
      box.querySelector('#payNow').onclick = (e) => { e.preventDefault(); askPayment(Number(sel.value)); };
    } else { box.className = 'pay-status'; box.innerHTML = ''; }
  }
  async function askPayment(amount) {
    const r = await openPaymentPopup({ amount, title: 'Pay your first month' });
    if (r) firstPay = { amount, ...r };
    showPayStatus();
  }
  $('#tiers').addEventListener('change', (e) => {
    if (e.target.name !== 'pledge') return;
    askPayment(Number(e.target.value));
  });
  $('#agree').addEventListener('change', showPayStatus);

  // photo
  let photoData = '';
  const photoIn = $('#photo'), drop = $('#photoDrop');
  async function takePhoto(files) {
    const bad = checkUpload(files, RULES.maxPhotoMB);
    if (bad) { photoIn.value = ''; return toast(bad, 'error'); }
    const file = files && files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast('Photo must be PNG or JPG', 'error');

    try {
      photoData = await compressImage(file);
      $('#photoPv').style.backgroundImage = `url(${photoData})`; $('#photoPv').textContent = '';
    } catch { toast('Could not read that image', 'error'); }
  }
  photoIn.addEventListener('change', () => takePhoto(photoIn.files));
  ['dragover', 'dragenter'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); takePhoto(ev.dataTransfer.files); });

  // submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#regErr'); err.textContent = '';
    form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
    const bad = (el, msg) => { if (el) { el.classList.add('bad'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } err.textContent = msg; return false; };

    for (const el of form.querySelectorAll('[required]')) {
      if (el.disabled || el.type === 'checkbox') continue;
      if (!el.value.trim()) return bad(el, 'Please fill in all required fields.');
    }
    if (!dob.ad) return bad($('#dobPicker input:not([hidden])'), 'Please select your date of birth.');
    const phone = F('phone').value.replace(/[^\d]/g, '').replace(/^977(?=\d{10}$)/, '');
    if (!/^9\d{9}$/.test(phone)) return bad(F('phone'), 'Enter a valid 10-digit Nepali mobile number (98XXXXXXXX).');
    const email = F('email').value.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad(F('email'), 'Enter a valid e-mail address.');
    if (F('profession').value === 'Other' && !F('professionOther').value.trim()) return bad(F('professionOther'), 'Please specify your profession.');
    if (!photoData) return bad(drop, 'Please upload your photo.');
    const pledgeEl = form.querySelector('input[name=pledge]:checked');
    if (!pledgeEl) return bad($('#tiers'), 'Please choose a monthly contribution.');
    if (!firstPay || firstPay.amount !== Number(pledgeEl.value)) return bad($('#payStatus'), 'Please pay the first month and upload the payment receipt.');
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
      bloodGroup: F('bloodGroup').value,
      phone, email, username,
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
      const saved = await store.completeProfile(member, pub);
      // first month's contribution, paid with the uploaded receipt
      const now = new Date().toISOString(), first = monthKey(applied);
      try {
        await store.createPayment({
          uid: saved.uid, memberNo: saved.memberNo, name: saved.fullName, months: [first], amount: saved.pledge,
          method: firstPay.method, ref: firstPay.ref, status: 'approved', reviewed: false, createdAt: now, paidAt: now,
        }, firstPay.receipt);
        await store.updateMember(saved.uid, { paidThrough: first });
        await store.updatePublicCard(saved.cardToken, { paidThrough: first });
        saved.paidThrough = first;
      } catch (pe) {
        toast('Membership created, but the payment could not be saved. Please pay again from your dashboard.', 'error');
      }
      onDone(saved);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      btn.disabled = false; btn.textContent = 'Submit & generate my membership card';
    }
  });
}
