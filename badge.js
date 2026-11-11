// ============================================================================
//  🏅 Milestone badge: earned for every full year (12 months) of contributions.
//  Gold-outlined green petals around a blue-green centre showing the years,
//  presented on a certificate with the member's photo; PNG / JPG / PDF download.
// ============================================================================
import { ORG } from './config.js';
import { esc, npr, fmtDate, modal } from './utils.js';

/** full years of contribution = paid months / 12 */
export const badgeYears = (ledger) => Math.floor(ledger.rows.filter((r) => r.status === 'paid').length / 12);

/** The badge artwork as an SVG data URL (an <img> exports reliably to PNG/PDF). */
export function badgeImage(years) {
  // 8 almond-shaped loops swirling around the centre (like the reference badge)
  const petals = Array.from({ length: 8 }, (_, i) => `
    <g transform="rotate(${i * 45} 200 200)">
      <ellipse cx="200" cy="112" rx="46" ry="98" transform="rotate(32 200 112)"
        fill="url(#petal${i % 2})" stroke="url(#gold)" stroke-width="7"/>
      <ellipse cx="200" cy="112" rx="30" ry="80" transform="rotate(32 200 112)" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="3"/>
    </g>`).join('');
  const label = years === 1 ? 'YEAR' : 'YEARS';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset=".35" stop-color="#e8c55a"/><stop offset=".7" stop-color="#b8892a"/><stop offset="1" stop-color="#f6df8c"/>
    </linearGradient>
    <linearGradient id="petal0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#79d70f"/><stop offset="1" stop-color="#2f8a05"/></linearGradient>
    <linearGradient id="petal1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5cc40a"/><stop offset="1" stop-color="#257203"/></linearGradient>
    <linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#18a8ff"/><stop offset=".55" stop-color="#22b8a8"/><stop offset="1" stop-color="#6fd11a"/></linearGradient>
    <radialGradient id="shine" cx=".35" cy=".3" r=".7"><stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  ${petals}
  <circle cx="200" cy="200" r="86" fill="url(#core)" stroke="url(#gold)" stroke-width="9"/>
  <circle cx="200" cy="200" r="80" fill="url(#shine)"/>
  <text x="200" y="${years > 9 ? 222 : 228}" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-weight="700" font-size="${years > 9 ? 84 : 104}" fill="#ffffff" stroke="#0b4a6a" stroke-opacity=".25" stroke-width="2">${years}</text>
  <text x="200" y="262" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-weight="700" font-size="20" letter-spacing="5" fill="#ffffff">${label}</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Certificate element (fixed 1100 x 640 px; shown scaled) */
export function badgeCertificate(m, years, amount) {
  const el = document.createElement('div');
  el.className = 'badge-cert';
  el.innerHTML = `
    <div class="bc-bg"></div>
    <div class="bc-left"><img class="bc-badge" src="${badgeImage(years)}" alt=""></div>
    <div class="bc-right">
      <div class="bc-org"><img src="${esc(ORG.logo)}" alt=""><div><b>${esc(ORG.fullName)}</b><small>ESTD. ${ORG.established}</small></div></div>
      <div class="bc-kicker">MILESTONE BADGE</div>
      <div class="bc-person">
        <div class="bc-photo">${m.photo ? `<img src="${m.photo}" alt="">` : ''}</div>
        <div><div class="bc-name">${esc(m.fullName)}</div><div class="bc-no">${esc(m.memberNo)}</div></div>
      </div>
      <div class="bc-title">${years} ${years === 1 ? 'Year' : 'Years'} of Contribution</div>
      <p class="bc-text">You have contributed <b>${esc(npr(amount))}</b> to ${esc(ORG.fullName)} over ${years === 1 ? 'one full year' : `${years} full years`}. We are very thankful for your support and for being part of the change.</p>
      <div class="bc-foot"><span>Awarded ${esc(fmtDate(new Date()))}</span><span>★ Thank you ★</span></div>
    </div>`;
  return el;
}

const W = 1100, H = 640;
export function mountScaled(frame, el) {
  frame.innerHTML = ''; frame.classList.add('badge-frame'); frame.appendChild(el);
  const fit = () => { const s = frame.clientWidth / W; el.style.transform = `scale(${s})`; frame.style.height = H * s + 'px'; };
  fit(); new ResizeObserver(fit).observe(frame);
}

async function snapshot(m, years, amount) {
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;height:${H}px;`;
  const el = badgeCertificate(m, years, amount); holder.appendChild(el); document.body.appendChild(holder);
  await Promise.all([...el.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  await document.fonts?.ready;
  const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  holder.remove();
  return canvas;
}
export async function downloadBadge(m, years, amount, format) {
  const c = await snapshot(m, years, amount);
  const name = `RSJJYC-${years}-year-badge-${m.memberNo}`;
  const a = document.createElement('a');
  if (format === 'png') { a.href = c.toDataURL('image/png'); a.download = name + '.png'; }
  else if (format === 'jpg') { a.href = c.toDataURL('image/jpeg', 0.95); a.download = name + '.jpg'; }
  else {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });
    pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, H);
    return pdf.save(name + '.pdf');
  }
  document.body.appendChild(a); a.click(); a.remove();
}
export const badgeDownloadButtons = () => `<div class="dl-row">
  <button class="btn btn-sm" data-bdl="png">⬇ PNG</button><button class="btn btn-sm" data-bdl="jpg">⬇ JPG</button><button class="btn btn-sm" data-bdl="pdf">⬇ PDF</button></div>`;
export function wireBadgeDownloads(root, m, years, amount) {
  root.querySelectorAll('[data-bdl]').forEach((b) => (b.onclick = async () => {
    if (b.classList.contains('busy')) return; b.classList.add('busy');
    try { await downloadBadge(m, years, amount, b.dataset.bdl); } finally { b.classList.remove('busy'); }
  }));
}

// ---------- celebration ----------
function confetti(ms = 4000) {
  const c = document.createElement('canvas'); c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d'); const dpr = window.devicePixelRatio || 1;
  const size = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
  size(); addEventListener('resize', size);
  const colors = ['#f5b301', '#c8102e', '#16a34a', '#18a8ff', '#ffffff', '#79d70f'];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * c.width, y: -Math.random() * c.height * 0.6, r: (4 + Math.random() * 6) * dpr,
    vy: (2 + Math.random() * 3.5) * dpr, vx: (Math.random() - 0.5) * 2.5 * dpr, a: Math.random() * 6.3, va: (Math.random() - 0.5) * 0.25,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
    });
    if (t - t0 < ms) requestAnimationFrame(tick); else { c.remove(); removeEventListener('resize', size); }
  };
  requestAnimationFrame(tick);
}

/** Big celebration popup when a new badge is earned */
export function celebrate(m, years, amount) {
  const { el } = modal(`
    <div class="celebrate">
      <div class="cel-burst">🎉</div>
      <h3>Congratulations, ${esc(m.firstName)}!</h3>
      <p class="sub">You have completed <b>${years} ${years === 1 ? 'year' : 'years'} of contribution</b> to the club. Here is your milestone badge.</p>
      <div id="celCert"></div>
      ${badgeDownloadButtons()}
    </div>`, { wide: true });
  mountScaled(el.querySelector('#celCert'), badgeCertificate(m, years, amount));
  wireBadgeDownloads(el, m, years, amount);
  confetti();
}
