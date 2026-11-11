// ============================================================================
//  Data layer. Uses Firebase (Auth + Firestore) when configured,
//  otherwise a localStorage "demo" backend with the same API.
//
//  Flow:  createAccount(username, password)  -> login account only
//         completeProfile(member, pub)        -> membership no., card, uniqueness
// ============================================================================
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';
import { ADMIN, PHONE_LOGIN_DOMAIN } from './config.js';
import { authEmailFor, normalizeUsername, memberNumber, sha256, uid as rid } from './utils.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

const ERRORS = {
  'auth/email-already-in-use': 'This mobile number / e-mail already has an account. Please log in instead.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid e-mail address or phone number.',
  'auth/missing-email': 'Please enter a valid e-mail address or phone number.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/requires-recent-login': 'Please log out, log in again and then change your password.',
  'auth/network-request-failed': 'No internet connection. Please check your network and try again.',
  'permission-denied': 'You do not have permission for this action.',
  'not-admin': 'This account is not an administrator.',
  'dup-phone': 'This mobile number is already used by another membership. One person can have only one membership.',
  'dup-email': 'This e-mail is already used by another membership. One person can have only one membership.',
  'no-account': 'No account found with this mobile number / e-mail.',
  'phone-reset': 'This account uses a mobile number, so a reset link cannot be e-mailed. Please contact the club admin to reset your password.',
};
export const friendlyError = (e) => ERRORS[e?.code] || e?.message || String(e);
const fail = (code) => { const e = new Error(ERRORS[code] || code); e.code = code; throw e; };

/** Uniqueness keys for one-person-one-membership */
export const uniqueKeys = ({ phone, email }) => [
  ...(phone ? [{ id: 'phone_' + phone, code: 'dup-phone' }] : []),
  ...(email ? [{ id: 'email_' + email.toLowerCase(), code: 'dup-email' }] : []),
];
/** phone / e-mail markers to claim and release when an approved change alters them (the login username's marker is kept) */
const changeKeys = (m, changes) => {
  const keep = m.username ? keyForUsername(m.username).id : null;
  const before = uniqueKeys(m).map((k) => k.id), after = uniqueKeys({ ...m, ...changes }).map((k) => k.id);
  return { add: after.filter((k) => !before.includes(k) && k !== keep), remove: before.filter((k) => !after.includes(k) && k !== keep) };
};
/** the part of a change that is printed on the membership card / QR page */
const CARD_FIELDS = ['fullName', 'dob', 'bloodGroup', 'photo'];
const cardPart = (changes) => Object.fromEntries(Object.entries(changes).filter(([k]) => CARD_FIELDS.includes(k)));
const keyForUsername = (u) => { u = normalizeUsername(u); return u.includes('@') ? { id: 'email_' + u, code: 'dup-email' } : { id: 'phone_' + u, code: 'dup-phone' }; };
const usernameFromEmail = (e = '') => (e.endsWith('@' + PHONE_LOGIN_DOMAIN) ? e.split('@')[0] : e);

// ---------------------------------------------------------------------------
//  Firebase backend
// ---------------------------------------------------------------------------
async function firebaseBackend() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const ready = new Promise((r) => { const off = A.onAuthStateChanged(auth, (u) => { off(); r(u); }); });
  const d = (c, id) => F.doc(db, c, id);
  const all = async (q) => (await F.getDocs(q)).docs.map((x) => ({ id: x.id, ...x.data() }));
  const isAdminUid = async (u) => (await F.getDoc(d('admins', u))).exists();

  return {
    mode: 'firebase',
    async session() {
      await ready; const cur = auth.currentUser;
      if (!cur) return null;
      return { uid: cur.uid, role: (await isAdminUid(cur.uid)) ? 'admin' : 'member', username: usernameFromEmail(cur.email) };
    },
    async createAccount(username, password) {
      const cred = await A.createUserWithEmailAndPassword(auth, authEmailFor(username), password);
      const u = cred.user.uid; const k = keyForUsername(username);
      try {
        await F.runTransaction(db, async (tx) => {
          const s = await tx.get(d('uniques', k.id));
          if (s.exists() && s.data().uid !== u) fail(k.code);
          if (!s.exists()) tx.set(d('uniques', k.id), { uid: u, createdAt: new Date().toISOString() });
        });
      } catch (e) { await cred.user.delete().catch(() => {}); throw e; }
      return { uid: u, role: 'member', username: normalizeUsername(username) };
    },
    async completeProfile(member, pub) {
      const u = auth.currentUser.uid;
      return F.runTransaction(db, async (tx) => {
        const keys = uniqueKeys(member);
        const snaps = await Promise.all(keys.map((k) => tx.get(d('uniques', k.id))));
        snaps.forEach((s, i) => { if (s.exists() && s.data().uid !== u) fail(keys[i].code); });
        const cRef = d('counters', String(member.joinYear));
        const c = await tx.get(cRef);
        const seq = (c.exists() ? c.data().count : 0) + 1;
        const memberNo = memberNumber(member.joinYear, seq, member.firstName, member.lastName);
        const full = { ...member, uid: u, seq, memberNo };
        snaps.forEach((s, i) => { if (!s.exists()) tx.set(d('uniques', keys[i].id), { uid: u, createdAt: new Date().toISOString() }); });
        tx.set(cRef, { count: seq });
        tx.set(d('members', u), full);
        tx.set(d('publicCards', member.cardToken), { ...pub, uid: u, memberNo });
        return full;
      });
    },
    async loginMember(username, password) {
      const c = await A.signInWithEmailAndPassword(auth, authEmailFor(username), password);
      return { uid: c.user.uid, role: (await isAdminUid(c.user.uid)) ? 'admin' : 'member' };
    },
    async loginAdmin(username, password) {
      if (username.trim().toUpperCase() !== ADMIN.username) fail('auth/invalid-credential');
      const c = await A.signInWithEmailAndPassword(auth, ADMIN.email, password);
      if (!(await isAdminUid(c.user.uid))) { await A.signOut(auth); fail('not-admin'); }
      return { uid: c.user.uid, role: 'admin' };
    },
    logout: () => A.signOut(auth),
    async resetPassword(username) {
      const u = normalizeUsername(username);
      if (!u.includes('@')) fail('phone-reset');
      await A.sendPasswordResetEmail(auth, u);
      return 'email';
    },
    async changePassword(current, next) {
      const user = auth.currentUser;
      await A.reauthenticateWithCredential(user, A.EmailAuthProvider.credential(user.email, current));
      await A.updatePassword(user, next);
    },
    async getMember(u) { const s = await F.getDoc(d('members', u)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    updateMember: (u, patch) => F.updateDoc(d('members', u), patch),
    listMembers: () => all(F.collection(db, 'members')),
    async getPublicCard(t) { const s = await F.getDoc(d('publicCards', t)); return s.exists() ? s.data() : null; },
    updatePublicCard: (t, patch) => F.updateDoc(d('publicCards', t), patch),
    async createPayment(p, receipt) {
      const ref = F.doc(F.collection(db, 'payments'));
      const b = F.writeBatch(db);
      b.set(ref, { ...p, hasReceipt: !!receipt });
      if (receipt) b.set(d('receipts', ref.id), { ...receipt, uid: p.uid });
      await b.commit();
      return ref.id;
    },
    async getReceipt(id) { const s = await F.getDoc(d('receipts', id)); return s.exists() ? s.data() : null; },
    async createWaiver(w) { const r = await F.addDoc(F.collection(db, 'waivers'), w); return r.id; },
    listPayments: (u) => all(u ? F.query(F.collection(db, 'payments'), F.where('uid', '==', u)) : F.collection(db, 'payments')),
    listWaivers: (u) => all(u ? F.query(F.collection(db, 'waivers'), F.where('uid', '==', u)) : F.collection(db, 'waivers')),
    updatePayment: (id, patch) => F.updateDoc(d('payments', id), patch),
    updateWaiver: (id, patch) => F.updateDoc(d('waivers', id), patch),

    // ---- member detail change requests (member asks, admin approves) ----
    async createChangeRequest(r) { const x = await F.addDoc(F.collection(db, 'changeRequests'), r); return x.id; },
    listChangeRequests: (u) => all(u ? F.query(F.collection(db, 'changeRequests'), F.where('uid', '==', u)) : F.collection(db, 'changeRequests')),
    rejectChangeRequest: (id, review) => F.updateDoc(d('changeRequests', id), { status: 'rejected', ...review }),
    async approveChangeRequest(req, m, review) {
      const { add, remove } = changeKeys(m, req.changes);
      const pub = cardPart(req.changes);
      await F.runTransaction(db, async (tx) => {
        const snaps = await Promise.all(add.map((k) => tx.get(d('uniques', k))));
        snaps.forEach((s, i) => { if (s.exists() && s.data().uid !== m.uid) fail(add[i].startsWith('phone_') ? 'dup-phone' : 'dup-email'); });
        tx.update(d('changeRequests', req.id), { status: 'approved', ...review });
        add.forEach((k) => tx.set(d('uniques', k), { uid: m.uid, createdAt: new Date().toISOString() }));
        remove.forEach((k) => tx.delete(d('uniques', k)));
        tx.update(d('members', m.uid), { ...req.changes, lastChangeRequest: req.id });
        if (m.cardToken && Object.keys(pub).length) tx.update(d('publicCards', m.cardToken), { ...pub, lastChangeRequest: req.id });
      });
    },
    /** member-side check before sending a request: is the new phone / e-mail free? */
    async checkFree(m, changes) {
      const { add } = changeKeys(m, changes);
      for (const k of add) { const s = await F.getDoc(d('uniques', k)); if (s.exists() && s.data().uid !== m.uid) fail(k.startsWith('phone_') ? 'dup-phone' : 'dup-email'); }
    },
    // ---- notifications (admin -> one member) & announcements (admin -> everyone) ----
    async notify(uid, n) { const r = await F.addDoc(F.collection(db, 'notifications'), { ...n, uid, read: false, createdAt: new Date().toISOString() }); return r.id; },
    listNotifications: (uid) => all(F.query(F.collection(db, 'notifications'), F.where('uid', '==', uid))),
    async markNotificationsRead(ids) {
      for (let i = 0; i < ids.length; i += 400) { const b = F.writeBatch(db); ids.slice(i, i + 400).forEach((id) => b.update(d('notifications', id), { read: true })); await b.commit(); }
    },
    async createAnnouncement(a) { const r = await F.addDoc(F.collection(db, 'announcements'), { ...a, createdAt: new Date().toISOString() }); return r.id; },
    listAnnouncements: () => all(F.collection(db, 'announcements')),
    deleteAnnouncement: (id) => F.deleteDoc(d('announcements', id)),
  };
}

// ---------------------------------------------------------------------------
//  Demo backend (localStorage) — same API, for trying the site without Firebase
// ---------------------------------------------------------------------------
function demoBackend() {
  const KEY = 'rsjjyc_demo_db_v2';
  const SKEY = 'rsjjyc_demo_session';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const db = Object.assign({ users: {}, members: {}, publicCards: {}, payments: {}, receipts: {}, waivers: {}, counters: {}, uniques: {}, changeRequests: {}, notifications: {}, announcements: {} }, load());
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
  const setSession = (s) => { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); return s; };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);

  return {
    mode: 'demo',
    async session() { return getSession(); },
    async createAccount(username, password) {
      const key = normalizeUsername(username);
      if (password.length < 6) fail('auth/weak-password');
      if (db.users[key]) fail('auth/email-already-in-use');
      const k = keyForUsername(username);
      if (db.uniques[k.id]) fail(k.code);
      const u = 'demo_' + rid(12);
      db.users[key] = { uid: u, pw: await sha256(password) };
      db.uniques[k.id] = { uid: u };
      save();
      return setSession({ uid: u, role: 'member', username: key });
    },
    async completeProfile(member, pub) {
      const u = getSession().uid;
      const keys = uniqueKeys(member);
      keys.forEach((k) => { if (db.uniques[k.id] && db.uniques[k.id].uid !== u) fail(k.code); });
      const seq = (db.counters[member.joinYear] || 0) + 1;
      const memberNo = memberNumber(member.joinYear, seq, member.firstName, member.lastName);
      keys.forEach((k) => (db.uniques[k.id] = { uid: u }));
      db.counters[member.joinYear] = seq;
      db.members[u] = { ...member, uid: u, seq, memberNo };
      db.publicCards[member.cardToken] = { ...pub, uid: u, memberNo };
      save();
      return clone(db.members[u]);
    },
    async loginMember(username, password) {
      const key = normalizeUsername(username);
      const rec = db.users[key];
      if (!rec || rec.pw !== (await sha256(password))) fail('auth/invalid-credential');
      return setSession({ uid: rec.uid, role: 'member', username: key });
    },
    async loginAdmin(username, password) {
      if (username.trim().toUpperCase() !== ADMIN.username || (await sha256(password)) !== ADMIN.demoPasswordSha256)
        fail('auth/invalid-credential');
      return setSession({ uid: 'admin', role: 'admin' });
    },
    async logout() { setSession(null); },
    async resetPassword(username) {
      if (!db.users[normalizeUsername(username)]) fail('no-account');
      return 'demo';
    },
    /** demo only: set a new password directly (stands in for the e-mailed link) */
    async demoSetPassword(username, next) {
      const rec = db.users[normalizeUsername(username)];
      if (!rec) fail('auth/user-not-found');
      rec.pw = await sha256(next); save();
    },
    async changePassword(current, next) {
      const s = getSession();
      const rec = Object.values(db.users).find((x) => x.uid === s?.uid);
      if (!rec || rec.pw !== (await sha256(current))) fail('auth/invalid-credential');
      rec.pw = await sha256(next); save();
    },
    async getMember(u) { return clone(db.members[u]); },
    async updateMember(u, patch) { Object.assign(db.members[u], patch); save(); },
    async listMembers() { return clone(Object.values(db.members)); },
    async getPublicCard(t) { return clone(db.publicCards[t]); },
    async updatePublicCard(t, patch) { Object.assign(db.publicCards[t], patch); save(); },
    async createPayment(p, receipt) {
      const id = rid(16);
      db.payments[id] = { ...p, id, hasReceipt: !!receipt };
      if (receipt) db.receipts[id] = { ...receipt, uid: p.uid };
      save(); return id;
    },
    async getReceipt(id) { return clone(db.receipts[id]); },
    async createWaiver(w) { const id = rid(16); db.waivers[id] = { ...w, id }; save(); return id; },
    async listPayments(u) { return clone(Object.values(db.payments).filter((p) => !u || p.uid === u)); },
    async listWaivers(u) { return clone(Object.values(db.waivers).filter((p) => !u || p.uid === u)); },
    async updatePayment(id, patch) { Object.assign(db.payments[id], patch); save(); },
    async updateWaiver(id, patch) { Object.assign(db.waivers[id], patch); save(); },
    async createChangeRequest(r) { const id = rid(16); db.changeRequests[id] = { ...r, id }; save(); return id; },
    async listChangeRequests(u) { return clone(Object.values(db.changeRequests).filter((x) => !u || x.uid === u)); },
    async rejectChangeRequest(id, review) { Object.assign(db.changeRequests[id], { status: 'rejected', ...review }); save(); },
    async approveChangeRequest(req, m, review) {
      const { add, remove } = changeKeys(m, req.changes);
      add.forEach((k) => { if (db.uniques[k] && db.uniques[k].uid !== m.uid) fail(k.startsWith('phone_') ? 'dup-phone' : 'dup-email'); });
      Object.assign(db.changeRequests[req.id], { status: 'approved', ...review });
      add.forEach((k) => (db.uniques[k] = { uid: m.uid }));
      remove.forEach((k) => delete db.uniques[k]);
      Object.assign(db.members[m.uid], req.changes, { lastChangeRequest: req.id });
      const pub = cardPart(req.changes);
      if (m.cardToken && db.publicCards[m.cardToken]) Object.assign(db.publicCards[m.cardToken], pub, { lastChangeRequest: req.id });
      save();
    },
    async checkFree(m, changes) {
      const { add } = changeKeys(m, changes);
      add.forEach((k) => { if (db.uniques[k] && db.uniques[k].uid !== m.uid) fail(k.startsWith('phone_') ? 'dup-phone' : 'dup-email'); });
    },
    // ---- notifications & announcements ----
    async notify(uid, n) { const id = rid(16); db.notifications[id] = { ...n, id, uid, read: false, createdAt: new Date().toISOString() }; save(); return id; },
    async listNotifications(uid) { return clone(Object.values(db.notifications).filter((n) => n.uid === uid)); },
    async markNotificationsRead(ids) { ids.forEach((id) => { if (db.notifications[id]) db.notifications[id].read = true; }); save(); },
    async createAnnouncement(a) { const id = rid(16); db.announcements[id] = { ...a, id, createdAt: new Date().toISOString() }; save(); return id; },
    async listAnnouncements() { return clone(Object.values(db.announcements)); },
    async deleteAnnouncement(id) { delete db.announcements[id]; save(); },
  };
}

let _store;
export function getStore() {
  if (!_store) _store = FIREBASE_ENABLED ? firebaseBackend() : Promise.resolve(demoBackend());
  return _store;
}
