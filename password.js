// ============================================================================
//  Password helpers: show/hide eye button, live strength bar, live match check
// ============================================================================

/** Wrap every password input under root with a 👁 show / hide button */
export function addEyeButtons(root = document) {
  root.querySelectorAll('input[type=password]').forEach((inp) => {
    if (inp.parentElement.classList.contains('pw-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-eye'; b.textContent = '👁'; b.title = 'Show password'; b.setAttribute('aria-label', 'Show password');
    b.addEventListener('click', () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? '🙈' : '👁';
      b.title = show ? 'Hide password' : 'Show password';
      b.setAttribute('aria-label', b.title);
      inp.focus();
    });
    wrap.appendChild(b);
  });
}

export function scorePassword(v) {
  if (!v) return { score: 0, label: '', pct: 0 };
  if (v.length < 6) return { score: 0, label: 'Too short (min. 6 characters)', pct: 12, color: 'var(--red)' };
  let s = 0;
  if (v.length >= 8) s++;
  if (v.length >= 12) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v)) s++;
  const levels = [
    { label: 'Weak', pct: 25, color: 'var(--red)' },
    { label: 'Weak', pct: 30, color: 'var(--red)' },
    { label: 'Fair', pct: 50, color: 'var(--amber)' },
    { label: 'Good', pct: 70, color: '#84cc16' },
    { label: 'Strong', pct: 88, color: 'var(--green)' },
    { label: 'Very strong', pct: 100, color: 'var(--green)' },
  ];
  return { score: s, ...levels[s] };
}

/**
 * Attach a live strength meter to `pw` and a live "match" message to `confirm`.
 * Creates the meter / message elements right after the inputs.
 */
export function attachPasswordUX(pw, confirm) {
  const meter = document.createElement('div');
  meter.className = 'pw-meter-box';
  meter.innerHTML = '<div class="pw-meter"><i></i></div><small class="pw-label"></small>';
  pw.closest('.pw-wrap').after(meter);
  const bar = meter.querySelector('i'), label = meter.querySelector('.pw-label');
  let msg;
  if (confirm) {
    msg = document.createElement('small');
    msg.className = 'pw-match';
    confirm.closest('.pw-wrap').after(msg);
  }
  const update = () => {
    const r = scorePassword(pw.value);
    bar.style.width = r.pct + '%';
    bar.style.background = r.color || 'transparent';
    label.textContent = r.label ? `Strength: ${r.label}` : '';
    label.style.color = r.color || '';
    if (confirm) {
      confirm.classList.remove('bad', 'good');
      if (!confirm.value) { msg.textContent = ''; return; }
      const ok = confirm.value === pw.value;
      const prefix = pw.value.startsWith(confirm.value);
      if (ok) { msg.textContent = '✔ Passwords match'; msg.className = 'pw-match ok'; confirm.classList.add('good'); }
      else if (prefix) { msg.textContent = 'Keep typing…'; msg.className = 'pw-match'; }
      else { msg.textContent = '✖ Passwords do not match'; msg.className = 'pw-match no'; confirm.classList.add('bad'); }
    }
  };
  pw.addEventListener('input', update);
  confirm?.addEventListener('input', update);
  return {
    valid: () => pw.value.length >= 6 && (!confirm || pw.value === confirm.value),
    reset: () => { pw.value = ''; if (confirm) confirm.value = ''; update(); },
  };
}
