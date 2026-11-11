// ============================================================================
//  Date-of-birth picker with English (AD) / Nepali (BS) calendar choice.
//  BS <-> AD conversion uses the `nepali-date-converter` library (window.NepaliDate).
// ============================================================================
import { isoDate, pad } from './utils.js';

const BS_MONTHS = ['Baisakh (बैशाख)', 'Jestha (जेठ)', 'Asar (असार)', 'Shrawan (साउन)', 'Bhadra (भदौ)', 'Asoj (असोज)',
  'Kartik (कात्तिक)', 'Mangsir (मंसिर)', 'Poush (पुष)', 'Magh (माघ)', 'Falgun (फागुन)', 'Chaitra (चैत)'];
const WD = ['आइत', 'सोम', 'मंगल', 'बुध', 'बिहि', 'शुक्र', 'शनि'];
const ND = () => window.NepaliDate;
const bs = (y, m0, d) => { const C = ND(); return new C(y, m0, d); };

export const adToBs = (ad) => {
  const [y, m, d] = ad.split('-').map(Number);
  const b = ND().fromAD(new Date(y, m - 1, d)).getBS();
  return `${b.year}-${pad(b.month + 1)}-${pad(b.date)}`;
};
export const bsToAd = (y, m0, d) => isoDate(bs(y, m0, d).toJsDate());
function daysInBs(y, m0) {
  const a = bs(y, m0, 1).toJsDate();
  const b = (m0 === 11 ? bs(y + 1, 0, 1) : bs(y, m0 + 1, 1)).toJsDate();
  return Math.round((b - a) / 86400000);
}

export function createDobPicker(root, onChange) {
  const today = isoDate(new Date());
  root.innerHTML = `
    <div class="seg" role="radiogroup" aria-label="Calendar">
      <label><input type="radio" name="calType" value="AD" checked><span>English (AD)</span></label>
      <label><input type="radio" name="calType" value="BS"><span>नेपाली (BS)</span></label>
    </div>
    <div class="dob-ad"><input type="date" id="dobAD" max="${today}" min="1930-01-01" required></div>
    <div class="dob-bs" hidden>
      <input type="text" id="dobBS" readonly placeholder="Select date (BS) — YYYY-MM-DD">
      <div class="bs-pop" hidden></div>
    </div>
    <small class="hint dob-equiv"></small>`;

  const adIn = root.querySelector('#dobAD');
  const bsWrap = root.querySelector('.dob-bs');
  const bsIn = root.querySelector('#dobBS');
  const pop = root.querySelector('.bs-pop');
  const equiv = root.querySelector('.dob-equiv');
  const state = { calendar: 'AD', ad: '', bs: '' };
  const emit = () => {
    equiv.textContent = state.ad ? (state.calendar === 'AD' ? `= ${state.bs} BS` : `= ${state.ad} AD`) : '';
    onChange({ ...state });
  };

  root.querySelectorAll('input[name=calType]').forEach((r) => r.addEventListener('change', () => {
    state.calendar = r.value;
    root.querySelector('.dob-ad').hidden = r.value !== 'AD';
    bsWrap.hidden = r.value !== 'BS';
    if (state.ad) { adIn.value = state.ad; bsIn.value = state.bs; }
    emit();
  }));

  adIn.addEventListener('change', () => {
    if (!adIn.value || adIn.value > today) { state.ad = state.bs = ''; return emit(); }
    state.ad = adIn.value;
    try { state.bs = adToBs(adIn.value); } catch { state.bs = ''; }
    emit();
  });

  // ---- BS calendar popup ----
  const nowBs = ND().fromAD(new Date()).getBS();
  let view = { y: nowBs.year - 20, m: 0 };
  const draw = () => {
    const first = bs(view.y, view.m, 1).toJsDate().getDay();
    const n = daysInBs(view.y, view.m);
    const sel = state.bs ? state.bs.split('-').map(Number) : [];
    let years = '';
    for (let y = nowBs.year; y >= 2000; y--) years += `<option ${y === view.y ? 'selected' : ''}>${y}</option>`;
    let cells = '<span></span>'.repeat(first);
    for (let d = 1; d <= n; d++) {
      const future = view.y > nowBs.year || (view.y === nowBs.year && (view.m > nowBs.month || (view.m === nowBs.month && d > nowBs.date)));
      const isSel = sel[0] === view.y && sel[1] === view.m + 1 && sel[2] === d;
      cells += `<button type="button" data-d="${d}" ${future ? 'disabled' : ''} class="${isSel ? 'sel' : ''}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="bs-head">
        <button type="button" data-nav="-1" aria-label="Previous month">‹</button>
        <select class="bs-m">${BS_MONTHS.map((m, i) => `<option value="${i}" ${i === view.m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <select class="bs-y">${years}</select>
        <button type="button" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="bs-grid bs-wd">${WD.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="bs-grid">${cells}</div>`;
  };
  pop.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      view.m += Number(nav.dataset.nav);
      if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; }
      view.y = Math.max(2000, Math.min(nowBs.year, view.y));
      return draw();
    }
    const day = e.target.closest('[data-d]');
    if (day) {
      const d = Number(day.dataset.d);
      state.bs = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
      state.ad = bsToAd(view.y, view.m, d);
      bsIn.value = state.bs; adIn.value = state.ad;
      pop.hidden = true; emit();
    }
  });
  pop.addEventListener('change', (e) => {
    if (e.target.classList.contains('bs-m')) view.m = Number(e.target.value);
    if (e.target.classList.contains('bs-y')) view.y = Number(e.target.value);
    draw();
  });
  bsIn.addEventListener('click', () => {
    if (state.bs) { const [y, m] = state.bs.split('-').map(Number); view = { y, m: m - 1 }; }
    draw(); pop.hidden = !pop.hidden;
  });
  document.addEventListener('click', (e) => { if (!bsWrap.contains(e.target)) pop.hidden = true; });

  return { get: () => ({ ...state }) };
}
