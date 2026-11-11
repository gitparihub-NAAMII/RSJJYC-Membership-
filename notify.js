// ============================================================================
//  🔔 Notification bell (top bar of the member and admin dashboards)
//  items: [{ id, icon, title, body, at (ISO), unread, url? }]
//  Unread items are also shown as phone notifications (once each) when the
//  member has allowed notifications.
// ============================================================================
import { esc, fmtDate } from './utils.js';
import { notifyState, enableNotifications } from './reminders.js';

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} day(s) ago`;
  return fmtDate(iso);
}

/**
 * Put the bell in the top bar.
 * onOpen(items) is called when the list is opened (mark things as read there).
 */
export function mountBell({ onOpen, showPhoneToggle = true } = {}) {
  const ctrl = document.querySelector('.topbar .tb-ctrl');
  if (!ctrl || document.getElementById('bellBtn')) return null;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'bellBtn'; btn.className = 'bell-btn';
  btn.title = 'Notifications'; btn.setAttribute('aria-label', 'Notifications');
  btn.innerHTML = '🔔<span class="bell-count" hidden>0</span>';
  ctrl.insertBefore(btn, ctrl.firstChild);

  const panel = document.createElement('div');
  panel.className = 'bell-panel'; panel.hidden = true;
  panel.innerHTML = `
    <div class="bell-head"><b>🔔 Notifications</b><button type="button" class="bell-x" aria-label="Close">✕</button></div>
    <div class="bell-list"></div>
    ${showPhoneToggle ? '<div class="bell-foot"><span class="bell-phone"></span></div>' : ''}`;
  document.body.appendChild(panel);

  let items = [];
  const countEl = btn.querySelector('.bell-count');
  const render = () => {
    panel.querySelector('.bell-list').innerHTML = items.length
      ? items.map((n) => `<div class="bell-item ${n.unread ? 'unread' : ''} ${n.tone || ''}" ${n.url ? `data-url="${esc(n.url)}"` : ''}>
          <span class="bell-ic">${n.icon || '🔔'}</span>
          <div class="bell-txt"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${esc(timeAgo(n.at))}</small></div>
        </div>`).join('')
      : '<div class="empty" style="padding:24px">No notifications yet.</div>';
    const phone = panel.querySelector('.bell-phone');
    if (phone) {
      const s = notifyState();
      phone.innerHTML = s === 'granted' ? '📱 Phone notifications are ON'
        : s === 'unsupported' ? '📱 Phone notifications are not supported on this browser'
        : s === 'denied' ? '📱 Phone notifications are blocked in your phone settings'
        : '<button type="button" class="btn btn-sm" id="bellPhoneOn">📱 Turn on phone notifications</button>';
      phone.querySelector('#bellPhoneOn')?.addEventListener('click', async () => { await enableNotifications(); render(); });
    }
  };
  const setCount = () => {
    const n = items.filter((i) => i.unread).length;
    countEl.hidden = !n; countEl.textContent = n > 99 ? '99+' : n;
    btn.classList.toggle('has-new', !!n);
  };
  const open = () => {
    render(); panel.hidden = false; btn.classList.add('on');
    onOpen?.(items);
    items = items.map((i) => ({ ...i, unread: false })); setCount();
  };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden ? open() : close(); });
  panel.querySelector('.bell-x').addEventListener('click', close);
  panel.addEventListener('click', (e) => { const it = e.target.closest('[data-url]'); if (it) location.href = it.dataset.url; });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return {
    set(list) { items = [...list].sort((a, b) => (b.at || '').localeCompare(a.at || '')); setCount(); if (!panel.hidden) render(); },
  };
}

/** Show unread items as phone notifications, once each (per device). */
export async function phoneNotify(key, items) {
  try {
    if (notifyState() !== 'granted') return;
    const store = `rsjjyc_phoned_${key}`;
    const done = new Set(JSON.parse(localStorage.getItem(store) || '[]'));
    const fresh = items.filter((i) => i.unread && !done.has(i.id)).slice(0, 5);
    if (!fresh.length) return;
    const reg = await navigator.serviceWorker.ready;
    for (const n of fresh) {
      await reg.showNotification(n.title, { body: n.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'rsjjyc-' + n.id, data: { url: n.url || 'member.html' } });
      done.add(n.id);
    }
    localStorage.setItem(store, JSON.stringify([...done].slice(-300)));
  } catch { /* never block the dashboard */ }
}
