/* Partsmith Markets — full-screen welcome screen + accounts (Firebase Auth + Firestore).
   Logged-out visitors see the welcome screen on every visit. Logged-in visitors can turn it off;
   that choice is saved to their account (Firestore: users/{uid}.hideWelcome), so it follows them
   to every device. Without a Firebase config the site still works and explains that accounts are off. */
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/13.2.0/';
const $ = s => document.querySelector(s);
const welcome = $('#welcomeDlg'), authDlg = $('#authDlg');
const state = { user: null, prefs: {}, fb: null, mode: 'login', ready: false };
const enabled = !!(firebaseConfig && firebaseConfig.apiKey);
const cacheKey = uid => 'pm-hide-welcome-' + uid;

// ---------------------------------------------------------------- welcome screen
function openWelcome() { if (!welcome.open) welcome.showModal(); renderAccount(); }
function closeWelcome(go) {
  welcome.close();
  if (go === 'watchlist') {
    const side = $('.sidebar-left'); side.classList.remove('flash'); void side.offsetWidth; side.classList.add('flash');
    const add = $('.wl-add'); if (add) add.focus();
  } else if (go === 'command') { $('#cmdBtn').click(); }
  else if (go) { const el = document.getElementById(go); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
welcome.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); closeWelcome(a.dataset.go); });
$('#welcomeGo').onclick = () => closeWelcome('picks');
$('#welcomeSkip').onclick = () => closeWelcome();
$('#helpBtn').onclick = openWelcome;
$('#homeLogo').onclick = e => { e.preventDefault(); openWelcome(); };

// ---------------------------------------------------------------- account UI
const initials = u => ((u.displayName || u.email || '?').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
const firstName = u => (u.displayName || '').split(' ')[0] || (u.email || '').split('@')[0];
function renderAccount() {
  const u = state.user;
  $('#wcAuthOut').hidden = !!u; $('#wcAuthIn').hidden = !u;
  $('#wcHideWrap').hidden = !u;
  $('#acctSignup').hidden = !!u;
  $('#acctSignOutTop').hidden = !u;
  $('#wcGreeting').textContent = u ? `Welcome back, ${firstName(u)}` : 'Welcome';
  const btn = $('#acctBtn');
  if (u) {
    btn.innerHTML = `<span class="avatar sm">${initials(u)}</span><span class="acct-label">${escapeHTML(firstName(u))}</span>`;
    btn.title = 'Your account';
    for (const id of ['#wcAvatar', '#acctAvatar']) $(id).textContent = initials(u);
    $('#wcName').textContent = u.displayName || u.email;
    $('#acctName').textContent = u.displayName || firstName(u);
    $('#acctEmail').textContent = u.email || '';
    $('#welcomeHide').checked = !!state.prefs.hideWelcome;
    $('#acctShowWelcome').checked = !state.prefs.hideWelcome;
  } else {
    btn.textContent = 'Log in'; btn.title = 'Log in or sign up';
    $('#acctMenu').hidden = true; btn.setAttribute('aria-expanded', 'false');
  }
}
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('#acctBtn').onclick = e => {
  if (!state.user) return openAuth('login');
  const m = $('#acctMenu'); m.hidden = !m.hidden; e.currentTarget.setAttribute('aria-expanded', String(!m.hidden));
};
document.addEventListener('click', e => { if (!e.target.closest('.acct')) { $('#acctMenu').hidden = true; $('#acctBtn').setAttribute('aria-expanded', 'false'); } });
document.querySelectorAll('[data-auth]').forEach(b => b.onclick = e => { e.preventDefault(); openAuth(b.dataset.auth); });
$('#welcomeHide').onchange = e => savePref({ hideWelcome: e.target.checked });
$('#acctShowWelcome').onchange = e => savePref({ hideWelcome: !e.target.checked });
$('#wcSignOut').onclick = $('#acctSignOut').onclick = $('#acctSignOutTop').onclick = () => signOutNow();

// ---------------------------------------------------------------- auth dialog
function setMode(mode) {
  state.mode = mode;
  authDlg.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === mode)));
  $('#authTitle').textContent = mode === 'login' ? 'Log in to Partsmith Markets' : 'Create your account';
  $('#authSubmit').textContent = mode === 'login' ? 'Log in' : 'Create account';
  $('#authNameWrap').hidden = mode === 'login';
  $('#authForgot').hidden = mode !== 'login';
  $('#authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authErr').textContent = '';
}
function openAuth(mode) {
  setMode(mode);
  if (!authDlg.open) authDlg.showModal();
  if (!enabled) { showErr('Accounts aren\'t switched on for this site yet. The site owner needs to finish the Firebase setup.', true); return; }
  $(mode === 'login' ? '#authEmail' : '#authName').focus();
}
authDlg.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => setMode(t.dataset.tab));
$('#authClose').onclick = () => authDlg.close();
authDlg.addEventListener('click', e => { if (e.target === authDlg) authDlg.close(); });
function showErr(msg, info) { const p = $('#authErr'); p.textContent = msg; p.classList.toggle('info', !!info); }
function busy(on) { authDlg.querySelectorAll('button, input').forEach(el => { if (el.id !== 'authClose') el.disabled = on; }); }
const friendly = e => ({
  'auth/invalid-email': 'That email address doesn\'t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/email-already-in-use': 'There\'s already an account with that email. Try logging in.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email. Try signing up.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'This website address isn\'t allowed to sign in yet. The owner needs to add it in Firebase → Authentication → Settings → Authorized domains.',
  'auth/operation-not-allowed': 'This sign-in method isn\'t turned on in Firebase yet.',
  'auth/network-request-failed': 'Network problem. Check your connection and try again.',
}[e && e.code] || (e && e.message) || 'Something went wrong. Try again.');

$('#authForm').onsubmit = async e => {
  e.preventDefault(); if (!enabled) return openAuth(state.mode);
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value, name = $('#authName').value.trim();
  if (!email || !pass) return showErr('Enter your email and password.');
  if (state.mode === 'signup' && !name) return showErr('Enter your name.');
  busy(true); showErr('');
  try {
    const { auth, A } = await firebase();
    if (state.mode === 'signup') {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pass);
      await A.updateProfile(cred.user, { displayName: name });
      state.user = auth.currentUser; renderAccount();
    } else {
      await A.signInWithEmailAndPassword(auth, email, pass);
    }
    authDlg.close(); $('#authPass').value = '';
  } catch (err) { showErr(friendly(err)); }
  busy(false);
};
$('#authGoogle').onclick = async () => {
  if (!enabled) return openAuth(state.mode);
  busy(true); showErr('');
  try { const { auth, A } = await firebase(); await A.signInWithPopup(auth, new A.GoogleAuthProvider()); authDlg.close(); }
  catch (err) { showErr(friendly(err)); }
  busy(false);
};
$('#authForgot').onclick = async e => {
  e.preventDefault(); if (!enabled) return;
  const email = $('#authEmail').value.trim(); if (!email) return showErr('Type your email above, then click "Forgot password?" again.');
  try { const { auth, A } = await firebase(); await A.sendPasswordResetEmail(auth, email); showErr('If that email has an account, a reset link is on its way.', true); }
  catch (err) { showErr(friendly(err)); }
};

// ---------------------------------------------------------------- firebase
let fbPromise = null;
function firebase() {
  if (!fbPromise) fbPromise = (async () => {
    const [{ initializeApp }, A, F] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore-lite.js')]);
    const app = initializeApp(firebaseConfig);
    return { app, A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
  })();
  return fbPromise;
}
async function loadPrefs(uid) {
  try { const { db, F } = await firebase(); const snap = await F.getDoc(F.doc(db, 'users', uid)); return snap.exists() ? snap.data() : {}; }
  catch (e) { console.warn('Could not load account settings', e); return null; }
}
async function savePref(patch) {
  if (!state.user) return;
  state.prefs = { ...state.prefs, ...patch }; renderAccount();
  try { localStorage.setItem(cacheKey(state.user.uid), state.prefs.hideWelcome ? '1' : '0'); } catch (e) {}
  try { const { db, F } = await firebase(); await F.setDoc(F.doc(db, 'users', state.user.uid), { ...patch, updatedAt: new Date().toISOString() }, { merge: true }); }
  catch (e) { console.warn('Could not save account settings', e); toast('Couldn\'t save to your account. Check your connection.'); }
}
async function signOutNow() {
  try { const { auth, A } = await firebase(); await A.signOut(auth); } catch (e) {}
  $('#acctMenu').hidden = true;
}
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- start-up
// Wait briefly for Firebase to restore a saved login, so signed-in visitors who turned the
// welcome screen off don't see it flash. Logged-out visitors (or no Firebase) see it right away.
async function start() {
  renderAccount();
  if (!enabled) { openWelcome(); return; }
  let decided = false;
  const decide = hide => { if (decided) return; decided = true; if (!hide) openWelcome(); };
  const timer = setTimeout(() => decide(false), 2500);
  try {
    const { auth, A } = await firebase();
    A.onAuthStateChanged(auth, async user => {
      state.user = user; state.prefs = {};
      if (user) {
        let cached = null; try { cached = localStorage.getItem(cacheKey(user.uid)); } catch (e) {}
        if (cached != null) state.prefs.hideWelcome = cached === '1';
        if (!decided && cached != null) { clearTimeout(timer); decide(cached === '1'); }
        renderAccount();
        const remote = await loadPrefs(user.uid);
        if (remote) { state.prefs = remote; try { localStorage.setItem(cacheKey(user.uid), remote.hideWelcome ? '1' : '0'); } catch (e) {} }
        clearTimeout(timer); decide(!!state.prefs.hideWelcome);
      } else {
        clearTimeout(timer); decide(false);
      }
      renderAccount();
    });
  } catch (e) {
    console.warn('Firebase failed to load; accounts unavailable', e);
    clearTimeout(timer); decide(false);
  }
}
start();
