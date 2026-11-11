// ============================================================================
//  Data layer. Uses Firebase (Auth + Firestore) when configured,
//  otherwise a localStorage "demo" backend with the same API.
// ============================================================================
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';
import { ADMIN } from './config.js';
import { authEmailFor, normalizeUsername, memberNumber, sha256, uid as rid } from './utils.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

const ERRORS = {
  'auth/email-already-in-use': 'This username (phone / e-mail) is already registered. Please log in instead.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid e-mail address or phone number.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'permission-denied': 'You do not have permission for this action.',
  'not-admin': 'This account is not an administrator.',
};
export const friendlyError = (e) => ERRORS[e?.code] || e?.message || String(e);
const fail = (code) => { const e = new Error(ERRORS[code] || code); e.code = code; throw e; };

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
      const u = await ready; const cur = auth.currentUser || u;
      if (!cur) return null;
      return { uid: cur.uid, role: (await isAdminUid(cur.uid)) ? 'admin' : 'member' };
    },
    async registerMember(member, username, password, pub) {
      const cred = await A.createUserWithEmailAndPassword(auth, authEmailFor(username), password);
      const u = cred.user.uid;
      try {
        return await F.runTransaction(db, async (tx) => {
          const cRef = d('counters', String(member.joinYear));
          const c = await tx.get(cRef);
          const seq = (c.exists() ? c.data().count : 0) + 1;
          const memberNo = memberNumber(member.joinYear, seq, member.firstName, member.lastName);
          const full = { ...member, uid: u, seq, memberNo };
          tx.set(cRef, { count: seq });
          tx.set(d('members', u), full);
          tx.set(d('publicCards', member.cardToken), { ...pub, uid: u, memberNo });
          return full;
        });
      } catch (e) { await cred.user.delete().catch(() => {}); throw e; }
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
    async getMember(u) { const s = await F.getDoc(d('members', u)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    updateMember: (u, patch) => F.updateDoc(d('members', u), patch),
    listMembers: () => all(F.collection(db, 'members')),
    async getPublicCard(t) { const s = await F.getDoc(d('publicCards', t)); return s.exists() ? s.data() : null; },
    updatePublicCard: (t, patch) => F.updateDoc(d('publicCards', t), patch),
    async createPayment(p) { const r = await F.addDoc(F.collection(db, 'payments'), p); return r.id; },
    async createWaiver(w) { const r = await F.addDoc(F.collection(db, 'waivers'), w); return r.id; },
    listPayments: (u) => all(u ? F.query(F.collection(db, 'payments'), F.where('uid', '==', u)) : F.collection(db, 'payments')),
    listWaivers: (u) => all(u ? F.query(F.collection(db, 'waivers'), F.where('uid', '==', u)) : F.collection(db, 'waivers')),
    updatePayment: (id, patch) => F.updateDoc(d('payments', id), patch),
    updateWaiver: (id, patch) => F.updateDoc(d('waivers', id), patch),
  };
}

// ---------------------------------------------------------------------------
//  Demo backend (localStorage) — same API, for trying the site without Firebase
// ---------------------------------------------------------------------------
function demoBackend() {
  const KEY = 'rsjjyc_demo_db_v1';
  const SKEY = 'rsjjyc_demo_session';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const db = Object.assign({ users: {}, members: {}, publicCards: {}, payments: {}, waivers: {}, counters: {} }, load());
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const setSession = (s) => { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); return s; };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);

  return {
    mode: 'demo',
    async session() { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } },
    async registerMember(member, username, password, pub) {
      const key = normalizeUsername(username);
      if (password.length < 6) fail('auth/weak-password');
      if (db.users[key]) fail('auth/email-already-in-use');
      const u = 'demo_' + rid(12);
      const seq = (db.counters[member.joinYear] || 0) + 1;
      const memberNo = memberNumber(member.joinYear, seq, member.firstName, member.lastName);
      db.counters[member.joinYear] = seq;
      db.users[key] = { uid: u, pw: await sha256(password) };
      db.members[u] = { ...member, uid: u, seq, memberNo };
      db.publicCards[member.cardToken] = { ...pub, uid: u, memberNo };
      save();
      setSession({ uid: u, role: 'member' });
      return clone(db.members[u]);
    },
    async loginMember(username, password) {
      const rec = db.users[normalizeUsername(username)];
      if (!rec || rec.pw !== (await sha256(password))) fail('auth/invalid-credential');
      return setSession({ uid: rec.uid, role: 'member' });
    },
    async loginAdmin(username, password) {
      if (username.trim().toUpperCase() !== ADMIN.username || (await sha256(password)) !== ADMIN.demoPasswordSha256)
        fail('auth/invalid-credential');
      return setSession({ uid: 'admin', role: 'admin' });
    },
    async logout() { setSession(null); },
    async getMember(u) { return clone(db.members[u]); },
    async updateMember(u, patch) { Object.assign(db.members[u], patch); save(); },
    async listMembers() { return clone(Object.values(db.members)); },
    async getPublicCard(t) { return clone(db.publicCards[t]); },
    async updatePublicCard(t, patch) { Object.assign(db.publicCards[t], patch); save(); },
    async createPayment(p) { const id = rid(16); db.payments[id] = { ...p, id }; save(); return id; },
    async createWaiver(w) { const id = rid(16); db.waivers[id] = { ...w, id }; save(); return id; },
    async listPayments(u) { return clone(Object.values(db.payments).filter((p) => !u || p.uid === u)); },
    async listWaivers(u) { return clone(Object.values(db.waivers).filter((p) => !u || p.uid === u)); },
    async updatePayment(id, patch) { Object.assign(db.payments[id], patch); save(); },
    async updateWaiver(id, patch) { Object.assign(db.waivers[id], patch); save(); },
  };
}

let _store;
export function getStore() {
  if (!_store) _store = FIREBASE_ENABLED ? firebaseBackend() : Promise.resolve(demoBackend());
  return _store;
}
