// ============================================================================
//  Member detail change requests.
//  Members can't change their details directly: they send a request, the admin
//  approves (details + membership card update) or rejects it with a reason.
// ============================================================================
import { PROFESSIONS, PROVINCES, BLOOD_GROUPS, RULES } from './config.js';
import { friendlyError } from './store.js';
import { esc, fmtDate, modal, toast, compressImage, checkUpload } from './utils.js';
import { adToBs } from './datepicker.js';

export const FIELD_LABELS = {
  fullName: 'Full name', firstName: 'First name', middleName: 'Middle name', lastName: 'Surname',
  dob: 'Date of birth', dobBS: 'Date of birth (BS)', gender: 'Gender', bloodGroup: 'Blood group',
  profession: 'Profession', employed: 'Employed', phone: 'Mobile', email: 'E-mail',
  permanentAddress: 'Permanent', temporaryAddress: 'Temporary', photo: 'Photo',
};
// fields shown to the admin (the rest are derived, e.g. fullName -> first/middle/last)
const SHOWN = ['fullName', 'dob', 'gender', 'bloodGroup', 'profession', 'phone', 'email', 'permanentAddress', 'temporaryAddress', 'photo'];

const addrText = (a = {}) => [a.tole, a.municipality && `${a.municipality}-${a.ward}`, a.district, a.province].filter(Boolean).join(', ');
export function valueHtml(key, v) {
  if (v === undefined || v === null || v === '') return '<span class="hint">—</span>';
  if (key === 'photo') return `<img class="cr-photo" src="${v}" alt="">`;
  if (key === 'dob') return esc(fmtDate(v));
  if (key.endsWith('Address')) return esc(addrText(v));
  return esc(v);
}

/** "Field | Current | Requested" table for one request */
export function changesTable(req) {
  const rows = SHOWN.filter((k) => k in req.changes);
  return `<div class="tbl-wrap cr-tbl"><table class="t"><thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead><tbody>
    ${rows.map((k) => `<tr><td><b>${FIELD_LABELS[k]}</b></td><td>${valueHtml(k, req.old?.[k])}</td><td class="cr-new">${valueHtml(k, req.changes[k])}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/** Section shown under "My details" in the member dashboard */
export function changeSectionHtml(requests) {
  const sorted = [...requests].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const pending = sorted.find((r) => r.status === 'pending');
  const last = sorted.find((r) => r.status !== 'pending');
  let html = '<div class="cr-box">';
  if (pending) {
    html += `<div class="cr-state pending"><b>⏳ Change request sent on ${esc(fmtDate(pending.createdAt))} — waiting for admin approval.</b>${changesTable(pending)}</div>`;
  } else if (last) {
    html += last.status === 'approved'
      ? `<div class="cr-state ok"><b>✔ Your change request of ${esc(fmtDate(last.createdAt))} was approved.</b>${last.adminReason ? `<p class="hint">Admin note: ${esc(last.adminReason)}</p>` : ''}</div>`
      : `<div class="cr-state no"><b>✖ Your change request of ${esc(fmtDate(last.createdAt))} was rejected.</b><p class="hint">Reason: ${esc(last.adminReason || '—')}</p></div>`;
  }
  html += `<button class="btn btn-block" id="crBtn" ${pending ? 'disabled' : ''}>✏️ Request a change in my details</button>
    <p class="hint" style="margin-top:6px">Changes are applied to your details and membership card after the admin approves them.</p></div>`;
  return html;
}

/** The request form (pre-filled with the member's current details) */
export function openChangeForm(M, store, onSent) {
  const isEmailLogin = (M.username || '').includes('@');
  const opt = (list, v) => list.map((x) => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const profVal = M.profession?.startsWith('Other') ? 'Other' : M.profession;
  const addr = (k, a = {}) => `
    <div class="grid g2" data-ca="${k}">
      <label class="f">Province<select name="${k}Province"><option value="">—</option>${opt(Object.keys(PROVINCES), a.province)}</select></label>
      <label class="f">District<select name="${k}District"><option value="">—</option>${opt(PROVINCES[a.province] || [], a.district)}</select></label>
      <label class="f">Municipality / Rural Mun.<input name="${k}Municipality" value="${esc(a.municipality || '')}"></label>
      <label class="f">Ward no.<input name="${k}Ward" type="number" min="1" max="35" value="${esc(a.ward || '')}"></label>
      <label class="f" style="grid-column:1/-1">Tole / Street<input name="${k}Tole" value="${esc(a.tole || '')}"></label>
    </div>`;
  const { el, close } = modal(`
    <h3>✏️ Request a change in my details</h3>
    <p class="hint" style="margin-top:-6px">Change only what is wrong or out of date. The admin will check your request; your details and card update after approval.</p>
    <form id="crForm" novalidate>
      <fieldset><legend>Personal details</legend>
        <div class="grid g3">
          <label class="f">First name<input name="firstName" value="${esc(M.firstName)}"></label>
          <label class="f">Middle name<input name="middleName" value="${esc(M.middleName || '')}"></label>
          <label class="f">Surname<input name="lastName" value="${esc(M.lastName)}"></label>
          <label class="f">Date of birth (AD)<input name="dob" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(M.dob || '')}"></label>
          <label class="f">Gender<select name="gender"><option value="">—</option>${opt(['Male', 'Female', 'Other', 'Prefer not to say'], M.gender)}</select></label>
          <label class="f">Blood group<select name="bloodGroup"><option value="">—</option>${opt(BLOOD_GROUPS, M.bloodGroup)}</select></label>
          <label class="f">Mobile<input name="phone" inputmode="tel" value="${esc(M.phone)}" ${!isEmailLogin ? 'readonly title="This is your login username and cannot be changed"' : ''}></label>
          <label class="f">E-mail<input name="email" type="email" value="${esc(M.email || '')}" ${isEmailLogin ? 'readonly title="This is your login username and cannot be changed"' : ''}></label>
        </div>
        <p class="hint">Your login username (<b>${esc(M.username)}</b>) cannot be changed.</p>
      </fieldset>
      <fieldset><legend>Profession</legend>
        <div class="grid g2">
          <label class="f">Profession<select name="profession">${opt(PROFESSIONS.map((p) => p.label), profVal)}</select></label>
          <label class="f">If other, specify<input name="professionOther" value="${esc(M.profession?.startsWith('Other: ') ? M.profession.slice(7) : '')}"></label>
        </div>
      </fieldset>
      <fieldset><legend>Permanent address</legend>${addr('permanent', M.permanentAddress)}</fieldset>
      <fieldset><legend>Temporary address</legend>${addr('temporary', M.temporaryAddress)}</fieldset>
      <fieldset><legend>Photo</legend>
        <label class="photo-drop" id="crPhotoDrop">
          <div class="pv" id="crPv" style="background-image:url(${M.photo || ''})"></div>
          <div><b>Upload a new photo (optional)</b><br><span class="hint">PNG or JPG, up to 10 MB, one photo only.</span></div>
          <input type="file" id="crPhoto" accept="image/png,image/jpeg">
        </label>
      </fieldset>
      <label class="f">Note for the admin (optional)<textarea name="note" rows="2" placeholder="e.g. My surname was spelled wrong"></textarea></label>
      <div class="err" id="crErr" style="margin-top:8px"></div>
      <div class="actions" style="margin-top:6px"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="crSend">Send request to admin</button></div>
    </form>`, { wide: true, backdropClose: false });

  const f = el.querySelector('#crForm'), E = f.elements, err = el.querySelector('#crErr');
  ['permanent', 'temporary'].forEach((k) => {
    E[k + 'Province'].onchange = (e) => {
      E[k + 'District'].innerHTML = '<option value="">—</option>' + (PROVINCES[e.target.value] || []).map((d) => `<option value="${d}">${d}</option>`).join('');
    };
  });
  let newPhoto = '';
  const photoIn = el.querySelector('#crPhoto');
  photoIn.addEventListener('change', async () => {
    const bad = checkUpload(photoIn.files, RULES.maxPhotoMB);
    if (bad) { photoIn.value = ''; return toast(bad, 'error'); }
    const file = photoIn.files[0]; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast('Photo must be PNG or JPG', 'error');
    try { newPhoto = await compressImage(file); el.querySelector('#crPv').style.backgroundImage = `url(${newPhoto})`; } catch { toast('Could not read that image', 'error'); }
  });

  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    const v = (n) => E[n].value.trim();
    if (!v('firstName') || !v('lastName')) { err.textContent = 'Please fill in all required fields.'; return; }
    const phone = v('phone').replace(/[^\d]/g, '').replace(/^977(?=\d{10}$)/, '');
    if (!/^9\d{9}$/.test(phone)) { err.textContent = 'Enter a valid 10-digit Nepali mobile number (98XXXXXXXX).'; return; }
    const email = v('email').toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Enter a valid e-mail address.'; return; }
    const readA = (k) => ({ province: v(k + 'Province'), district: v(k + 'District'), municipality: v(k + 'Municipality'), ward: v(k + 'Ward'), tole: v(k + 'Tole') });
    const prof = v('profession') === 'Other' && v('professionOther') ? `Other: ${v('professionOther')}` : v('profession');
    const next = {
      firstName: v('firstName'), middleName: v('middleName'), lastName: v('lastName'),
      fullName: [v('firstName'), v('middleName'), v('lastName')].filter(Boolean).join(' '),
      dob: v('dob') || M.dob, gender: v('gender'), bloodGroup: v('bloodGroup'),
      profession: prof, employed: !!PROFESSIONS.find((p) => p.label === v('profession'))?.employed,
      phone, email, permanentAddress: readA('permanent'), temporaryAddress: readA('temporary'),
      ...(newPhoto ? { photo: newPhoto } : {}),
    };
    if (next.dob !== M.dob) { try { next.dobBS = adToBs(next.dob); } catch { /* keep AD only */ } }
    const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
    const changes = {}, old = {};
    Object.entries(next).forEach(([k, val]) => {
      const before = k.endsWith('Address') ? { province: '', district: '', municipality: '', ward: '', tole: '', ...(M[k] || {}) } : M[k];
      if (!same(val, before)) { changes[k] = val; old[k] = M[k] ?? ''; }
    });
    if (!Object.keys(changes).length) { err.textContent = 'You have not changed anything yet.'; return; }
    const btn = el.querySelector('#crSend'); btn.disabled = true;
    try {
      await store.checkFree(M, changes);
      await store.createChangeRequest({
        uid: M.uid, memberNo: M.memberNo, name: M.fullName, changes, old, note: v('note'),
        status: 'pending', createdAt: new Date().toISOString(),
      });
      close(); toast('Change request sent to admin.', 'success'); onSent();
    } catch (ex) { err.textContent = friendlyError(ex); btn.disabled = false; }
  };
}
