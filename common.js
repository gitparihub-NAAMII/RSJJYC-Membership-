import { ORG } from './config.js';
import { getStore } from './store.js';
import { startI18n, setLang, LANG } from './i18n.js';

// ---------- installable app (service worker) ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Chrome may fire this before the top bar exists, so remember it
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });

// ---------- theme ----------
const getTheme = () => document.documentElement.dataset.theme || 'light';
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}

/** Language + theme switches in the top bar */
function mountControls() {
  const bar = document.querySelector('.topbar .in');
  if (!bar || bar.querySelector('.tb-ctrl')) return;
  const box = document.createElement('div');
  box.className = 'tb-ctrl';
  box.innerHTML = `
    <div class="lang-switch" role="group" aria-label="Change language" data-no-i18n>
      <button type="button" data-lang="en">EN</button><button type="button" data-lang="ne">नेपाली</button>
    </div>
    <button type="button" class="theme-btn" id="themeBtn"></button>
    <button type="button" class="install-btn" id="installBtn" hidden>📲 Install app</button>`;
  const pill = bar.querySelector('#modePill');
  pill ? bar.insertBefore(box, pill) : bar.appendChild(box);

  // ---- installable app: show the button when Chrome allows installing ----
  const ib = box.querySelector('#installBtn');
  const showInstall = () => { if (window.__installPrompt) ib.hidden = false; };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; showInstall(); });
  window.addEventListener('appinstalled', () => { ib.hidden = true; window.__installPrompt = null; });
  showInstall();
  ib.onclick = async () => {
    const p = window.__installPrompt; if (!p) return;
    p.prompt();
    await p.userChoice.catch(() => {});
    window.__installPrompt = null; ib.hidden = true;
  };

  const langBtns = box.querySelectorAll('[data-lang]');
  const syncLang = (l) => langBtns.forEach((b) => b.classList.toggle('on', b.dataset.lang === l));
  langBtns.forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); syncLang(b.dataset.lang); }));
  syncLang(LANG);

  const tb = box.querySelector('#themeBtn');
  const syncTheme = () => {
    const dark = getTheme() === 'dark';
    tb.textContent = dark ? '☀️' : '🌙';
    tb.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    tb.setAttribute('aria-label', tb.title);
  };
  tb.addEventListener('click', () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); syncTheme(); });
  syncTheme();
}

/** Apply organisation name/logo, toggles, translation + demo badge on every page */
export async function initPage() {
  document.querySelectorAll('.org-short').forEach((e) => (e.textContent = ORG.shortName));
  document.querySelectorAll('.org-full').forEach((e) => (e.textContent = ORG.fullName));
  document.querySelectorAll('.org-logo').forEach((e) => (e.src = ORG.logo));
  mountControls();
  startI18n();
  const store = await getStore();
  const pill = document.getElementById('modePill');
  if (pill && store.mode === 'demo') {
    pill.hidden = false;
    pill.title = 'Firebase is not configured yet — data is saved only in this browser.';
  }
  return store;
}

/** Fields needed to draw a card, from a member doc */
export const cardData = (m, paidThrough) => ({
  fullName: m.fullName, memberNo: m.memberNo, memberType: m.memberType, photo: m.photo, dob: m.dob, bloodGroup: m.bloodGroup || '',
  joinMs: m.joinMs, expiryMs: m.expiryMs, periods: m.periods, cardToken: m.cardToken,
  paidThrough: paidThrough !== undefined ? paidThrough : m.paidThrough ?? null,
  inactive: !!m.inactive,
});
