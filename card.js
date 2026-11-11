// ============================================================================
//  Digital membership card: rendering, QR code and PNG / JPG / PDF / Print export
//  Card is designed at CR80 ID-card ratio (85.6 x 54 mm) = 1012 x 638 px.
// ============================================================================
import { ORG } from './config.js';
import { esc, fmtDate, cardStatus } from './utils.js';

export const CARD_W = 1012, CARD_H = 638;

export function verifyUrl(token) {
  const base = ORG.siteUrl || new URL('.', location.href).href;
  return new URL(`verify.html?id=${encodeURIComponent(token)}`, base).href;
}

/** data: { fullName, memberNo, memberType, photo, dob, joinMs, expiryMs, periods, paidThrough, cardToken, profession } */
export function renderCard(data, { showStatus = true } = {}) {
  const st = cardStatus(data);
  const el = document.createElement('div');
  el.className = `mcard st-${st.code}`;
  el.innerHTML = `
    <div class="mc-bg"><i class="c1"></i><i class="c2"></i><i class="c3"></i></div>
    <header class="mc-head">
      <img class="mc-logo" src="${esc(ORG.logo)}" alt="">
      <div class="mc-org"><b>${esc(ORG.shortName)}</b>${ORG.fullName !== ORG.shortName ? `<small>${esc(ORG.fullName)}</small>` : ''}${ORG.established ? `<em>ESTD. ${ORG.established}</em>` : ''}</div>
      <div class="mc-title">MEMBERSHIP<br>CARD</div>
    </header>
    <div class="mc-body">
      <div class="mc-photo">${data.photo ? `<img src="${data.photo}" alt="">` : ''}</div>
      <div class="mc-info">
        <div class="mc-badges"><span class="mc-type">${esc((data.memberType || 'General Member').toUpperCase())}</span>${data.bloodGroup && data.bloodGroup !== "Don't know" ? `<span class="mc-blood">BLOOD <b>${esc(data.bloodGroup)}</b></span>` : ''}</div>
        <div class="mc-name">${esc((data.fullName || '').toUpperCase())}</div>
        <div class="mc-grid">
          <div><span>MEMBER NO.</span><b class="mono">${esc(data.memberNo || '—')}</b></div>
          ${data.dob ? `<div><span>DATE OF BIRTH</span><b>${fmtDate(data.dob)}</b></div>` : ''}
          <div><span>MEMBER SINCE</span><b>${fmtDate(data.joinMs)}</b></div>
          <div><span>VALID UNTIL</span><b>${fmtDate(data.expiryMs)}</b></div>
        </div>
      </div>
      <div class="mc-qr"><div class="mc-qr-box"></div><small>SCAN TO VERIFY</small></div>
    </div>
    <footer class="mc-foot">
      ${showStatus ? `<span class="mc-status">● ${esc(st.label)}</span>` : '<span></span>'}
      <span>${esc(ORG.facebook.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span>
    </footer>`;
  const qrBox = el.querySelector('.mc-qr-box');
  if (window.QRCode && data.cardToken) {
    new window.QRCode(qrBox, { text: verifyUrl(data.cardToken), width: 200, height: 200, colorDark: '#0b1f44', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    qrBox.title = '';
  }
  return el;
}

/** Put a scaled card preview into `frame` */
export function mountCard(frame, data, opts) {
  frame.innerHTML = '';
  frame.classList.add('card-frame');
  const card = renderCard(data, opts);
  frame.appendChild(card);
  const fit = () => {
    const s = frame.clientWidth / CARD_W;
    card.style.transform = `scale(${s})`;
    frame.style.height = CARD_H * s + 'px';
  };
  fit();
  new ResizeObserver(fit).observe(frame);
  return card;
}

async function snapshot(data) {
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${CARD_W}px;height:${CARD_H}px;`;
  const card = renderCard(data);
  holder.appendChild(card);
  document.body.appendChild(holder);
  await Promise.all([...card.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  await document.fonts?.ready;
  const canvas = await window.html2canvas(card, { scale: 2, backgroundColor: null, useCORS: true, logging: false });
  holder.remove();
  return canvas;
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

export async function exportCard(data, format) {
  const canvas = await snapshot(data);
  const base = `${data.memberNo || 'membership-card'}`;
  if (format === 'png') return download(canvas.toDataURL('image/png'), base + '.png');
  // JPG / PDF / print: flatten on white
  const flat = document.createElement('canvas');
  flat.width = canvas.width; flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const jpg = flat.toDataURL('image/jpeg', 0.95);
  if (format === 'jpg') return download(jpg, base + '.jpg');
  if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 54] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 85.6, 54);
    return pdf.save(base + '.pdf');
  }
  if (format === 'print') {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(f);
    f.srcdoc = `<!doctype html><html><head><title>${esc(base)}</title><style>
      @page{size:A4;margin:15mm}body{margin:0;font-family:sans-serif;display:flex;flex-direction:column;align-items:center}
      .c{position:relative;margin-top:10mm;padding:4mm;border:0.2mm dashed #999}
      img{display:block;width:85.6mm;height:54mm;border-radius:3mm}
      p{font-size:9pt;color:#666}</style></head>
      <body><div class="c"><img src="${jpg}"></div><p>Cut along the dashed line · Actual ID-card size (85.6 × 54 mm)</p></body></html>`;
    f.onload = () => { setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 300); };
  }
}

export function downloadButtons() {
  return `<div class="dl-row">
    <button class="btn btn-sm" data-dl="png">⬇ PNG</button>
    <button class="btn btn-sm" data-dl="jpg">⬇ JPG</button>
    <button class="btn btn-sm" data-dl="pdf">⬇ PDF</button>
    <button class="btn btn-sm btn-ghost" data-dl="print">🖨 Print</button></div>`;
}

export function wireDownloads(root, getData) {
  root.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
    if (b.classList.contains('busy')) return;
    b.classList.add('busy');
    try { await exportCard(getData(), b.dataset.dl); } finally { b.classList.remove('busy'); }
  }));
}
