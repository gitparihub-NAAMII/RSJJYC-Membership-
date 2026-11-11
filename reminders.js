// ============================================================================
//  Payment reminders: 7, 3 and 1 day before each monthly due date, and while
//  overdue — until the payment (receipt) is uploaded.
//   • phone notifications (shown by the app; background checks in the installed app)
//   • calendar file with alarms 7/3/1 days before each due date
// The due date is the member's joining day in each month.
// ============================================================================
import { DAY, isoDate, monthLabel, npr, fmtDate } from './utils.js';

export const REMIND_DAYS = [7, 3, 1];
const CACHE = 'rsjjyc-reminders';

/** Next unpaid month and its due date (null when nothing is left to pay) */
export function nextDue(member, ledger, now = new Date()) {
  const row = ledger.rows.find((r) => ['missed', 'due', 'upcoming'].includes(r.status));
  if (!row) return null;
  const due = dueDateOf(member, row.month);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.round((due - today) / DAY);
  return { month: row.month, label: row.label, amount: member.pledge, due, dueISO: isoDate(due), daysLeft, overdue: daysLeft < 0, memberNo: member.memberNo };
}
export function dueDateOf(member, monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const day = new Date(member.joinMs).getDate();
  return new Date(y, m - 1, Math.min(day, new Date(y, m, 0).getDate()));
}

/** Which reminder applies today: 7, 3, 1, 'overdue' or null */
export function milestone(daysLeft) {
  if (daysLeft < 0) return 'overdue';
  for (const d of [...REMIND_DAYS].sort((a, b) => a - b)) if (daysLeft <= d) return d;
  return null;
}

export function reminderText(info) {
  if (info.overdue) return `Your ${npr(info.amount)} contribution for ${monthLabel(info.month)} was due on ${fmtDate(info.due)}. Please pay and upload the receipt to keep your membership active.`;
  if (info.daysLeft === 0) return `Your ${npr(info.amount)} contribution for ${monthLabel(info.month)} is due today.`;
  return `Your ${npr(info.amount)} contribution for ${monthLabel(info.month)} is due in ${info.daysLeft} day(s), on ${fmtDate(info.due)}.`;
}

// ---------------------------------------------------------------------------
//  Notifications
// ---------------------------------------------------------------------------
export const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifyState = () => (notifySupported() ? Notification.permission : 'unsupported');

export async function enableNotifications() {
  if (!notifySupported()) return 'unsupported';
  const p = await Notification.requestPermission();
  if (p === 'granted') await registerBackgroundCheck();
  return p;
}

async function registerBackgroundCheck() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => ({ state: 'denied' }));
      if (st.state === 'granted') await reg.periodicSync.register('rsjjyc-due-check', { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch { /* background checks are best-effort */ }
}

async function cacheJSON(key, value) {
  if (!('caches' in window)) return null;
  const c = await caches.open(CACHE);
  if (value === undefined) { const r = await c.match(key); return r ? r.json() : null; }
  await c.put(key, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
}

/**
 * Save the member's next due date for background checks (service worker) and,
 * if a reminder is due today and not yet shown, show it now.
 */
export async function syncReminders(info) {
  try {
    await cacheJSON('due-info', info ? { ...info, due: info.dueISO, savedAt: Date.now() } : { none: true, savedAt: Date.now() });
    if (!info || notifyState() !== 'granted') return;
    await registerBackgroundCheck();
    const ms = milestone(info.daysLeft);
    if (!ms) return;
    const key = ms === 'overdue' ? `${info.month}-overdue-${isoDate(new Date())}` : `${info.month}-${ms}`;
    const sent = (await cacheJSON('sent')) || {};
    if (sent[key]) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(info.overdue ? '⚠ RSJJYC payment overdue' : '🔔 RSJJYC payment reminder', {
      body: reminderText(info) + ' Tap to pay.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'rsjjyc-due', data: { url: 'member.html' },
    });
    sent[key] = Date.now();
    await cacheJSON('sent', sent);
  } catch { /* never block the dashboard */ }
}

// ---------------------------------------------------------------------------
//  Calendar file (.ics) with alarms 7, 3 and 1 day before each due date
// ---------------------------------------------------------------------------
export function downloadCalendar(member, ledger) {
  const today = isoDate(new Date());
  const rows = ledger.rows.filter((r) => ['missed', 'due', 'upcoming'].includes(r.status))
    .map((r) => ({ r, due: dueDateOf(member, r.month) }))
    .filter((x) => isoDate(x.due) >= today);
  if (!rows.length) return false;
  const d8 = (d) => isoDate(d).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = (s) => String(s).replace(/[,;\\]/g, (c) => '\\' + c);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RSJJYC//Membership//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:RSJJYC contributions'];
  rows.forEach(({ r, due }) => {
    const end = new Date(due.getTime() + DAY);
    lines.push('BEGIN:VEVENT', `UID:rsjjyc-${member.memberNo}-${r.month}@rsjjyc`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d8(due)}`, `DTEND;VALUE=DATE:${d8(end)}`,
      `SUMMARY:${esc(`RSJJYC contribution ${npr(member.pledge)} due (${monthLabel(r.month)})`)}`,
      `DESCRIPTION:${esc(`Monthly contribution for ${monthLabel(r.month)} — member ${member.memberNo}. Pay and upload the receipt in the RSJJYC app. If you have already paid, ignore this reminder.`)}`);
    REMIND_DAYS.forEach((n) => lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`RSJJYC contribution due in ${n} days`)}`, `TRIGGER:-P${n}D`, 'END:VALARM'));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'RSJJYC-payment-reminders.ics';
  document.body.appendChild(a); a.click(); a.remove();
  return rows.length;
}

/** Ready-made reminder message for admins to send by WhatsApp / SMS */
export function adminMessage(member, info) {
  return `Namaste ${member.firstName}, this is a reminder from Royal Star Jan Jyoti Youth Club. ${reminderText(info)} Member no: ${member.memberNo}. Thank you!`;
}
