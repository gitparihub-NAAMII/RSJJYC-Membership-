// ============================================================================
//  Payment popup: QR code + receipt upload (used when choosing the monthly
//  contribution in the membership form).
// ============================================================================
import { ORG, PAYMENT, PAYMENT_METHODS } from './config.js';
import { esc, npr, modal, readReceipt, checkUpload } from './utils.js';

/**
 * Opens the popup. Resolves with { receipt, method, ref } when the member
 * uploads a receipt and confirms, or null if the popup is closed.
 */
export function openPaymentPopup({ amount, title = 'Pay your first month' }) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = modal(`
      <h3>💳 ${esc(title)}</h3>
      <div class="pay-total" style="margin-top:0"><span>Amount to pay</span><b>${npr(amount)}</b></div>

      <p class="pay-step"><span>1</span> Scan the QR code and pay this amount</p>
      <div class="pay-qr">
        <div class="pay-qr-box" id="ppQr">${PAYMENT.qrImage ? `<img src="${esc(PAYMENT.qrImage)}" alt="Payment QR">` : ''}</div>
        <div>
          <b>${esc(PAYMENT.accountName)}</b>
          <p class="hint" style="margin:4px 0 8px">${esc(PAYMENT.details)}</p>
          ${PAYMENT.qrImage ? '' : '<span class="demo-tag">Online payment gateway is being set up. For now, pay the club directly and upload the receipt.</span>'}
        </div>
      </div>

      <p class="pay-step"><span>2</span> Upload your payment receipt</p>
      <div class="grid g2">
        <label class="f">Payment method<select id="ppMethod">${PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join('')}</select></label>
        <label class="f">Transaction ID (optional)<input id="ppRef" placeholder="e.g. eSewa txn ID"></label>
      </div>
      <label class="receipt-drop" id="ppDrop">
        <div class="rc-pv" id="ppPv">🧾</div>
        <div><b>Upload receipt</b> <span class="req">*</span><br><span class="hint">PDF, PNG or JPG, up to 10 MB, one file only. You can continue only after the receipt is uploaded.</span></div>
        <input type="file" id="ppFile" accept="application/pdf,image/png,image/jpeg">
      </label>
      <div class="err" id="ppErr"></div>
      <button class="btn btn-green btn-block" id="ppOk" disabled>Confirm payment</button>`, { wide: true, backdropClose: false });

    if (!PAYMENT.qrImage && window.QRCode) {
      new window.QRCode(el.querySelector('#ppQr'), { text: new URL('pay-soon.html', ORG.siteUrl || location.href).href, width: 150, height: 150, correctLevel: window.QRCode.CorrectLevel.M });
    }
    let receipt = null;
    const drop = el.querySelector('#ppDrop'), pv = el.querySelector('#ppPv'), err = el.querySelector('#ppErr'), ok = el.querySelector('#ppOk');
    const take = async (files) => {
      const bad = checkUpload(files, PAYMENT.maxReceiptMB);
      if (bad) { err.textContent = bad; el.querySelector('#ppFile').value = ''; return; }
      const file = files && files[0];
      if (!file) return;
      err.textContent = '';
      try {
        receipt = await readReceipt(file);
        pv.style.backgroundImage = receipt.type === 'image' ? `url(${receipt.data})` : '';
        pv.textContent = receipt.type === 'pdf' ? '📄' : '';
        drop.classList.add('has-file');
        drop.querySelector('b').textContent = '✔ ' + file.name;
      } catch (e) { receipt = null; err.textContent = e.message; }
      ok.disabled = !receipt;
    };
    el.querySelector('#ppFile').addEventListener('change', (e) => take(e.target.files));
    ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('drag')));
    drop.addEventListener('drop', (ev) => { ev.preventDefault(); take(ev.dataTransfer.files); });

    ok.onclick = () => {
      if (!receipt) { err.textContent = 'Please upload your payment receipt.'; return; }
      done = true;
      resolve({ receipt, method: el.querySelector('#ppMethod').value, ref: el.querySelector('#ppRef').value.trim() });
      close();
    };
    // closed without confirming
    new MutationObserver((_, obs) => {
      if (!document.body.contains(el)) { obs.disconnect(); if (!done) resolve(null); }
    }).observe(document.body, { childList: true });
  });
}
