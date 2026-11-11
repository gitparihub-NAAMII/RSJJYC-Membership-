# RSJJYC Membership Platform

A static website (HTML + CSS + JavaScript) backed by **Firebase Authentication + Cloud Firestore**. It covers:

- **Two-step registration**: on the public page a person only creates a login (mobile number or any e-mail, incl. Gmail) and password — with a live strength bar, live "passwords match" check and 👁 show/hide. The full membership form opens inside their member dashboard after login. One membership per mobile number and per e-mail is enforced.
- **Membership form** (inside the dashboard): full name, date of birth (English AD or Nepali BS calendar) with automatic age, profession, permanent and temporary address, blood group, photo upload and a monthly contribution.
- **Digital membership card**: download it as PNG, JPG or PDF, or print it on A4 with cut marks. The card shows the photo, membership number, member type (General Member / BOD / …), validity dates and a unique QR code.
- **QR verification page** (`verify.html`): shows only the card and its live status (Active / About to expire / Expired). An expired card shows a blinking red "Your card is expired – renew soon" banner. It never shows any fee details.
- **Payments**: members pick the months, scan the payment QR (a demo QR until you set `PAYMENT.qrImage` in `config.js`) and must upload a receipt (photo, screenshot or small PDF). The payment counts as paid the moment the receipt is uploaded; admins check receipts and can reject fake ones.
- **Passwords**: "Forgot password?" e-mails a reset link to e-mail users (mobile-number users must ask the admin); "Change password" is in the member dashboard.
- **Member dashboard**: days left until expiry, total contributed, outstanding dues, and a month-by-month record (green = paid, red = missed, amber = due, blue = waiting for admin, grey = waived). Members can pay a contribution, ask for a waiver, and renew once their dues are cleared.
- **English / नेपाली switch** and **dark / light theme switch** in the top bar of every page. The choice is remembered. Translations live in `i18n.js` (the `NE` dictionary); the printed membership card always stays in English.
- **Admin dashboard** (admins can view members but cannot edit or delete them — also enforced by `firestore.rules`): totals, new / expiring / expired members, interactive charts (Chart.js), filters (by date, status or type), CSV export, and approve/reject for payments and waivers. Every decision needs a reason.

## Membership number

`026-RSJJYC-001-PC` = last 3 digits of the year you applied · `RSJJYC` · a running number for that year (001, 002, …) · first-name initial + surname initial. The number restarts at 001 each year (2027 → `027-RSJJYC-001-…`).

## Status rules (edit in `config.js → RULES`)

| Status | When |
|---|---|
| ACTIVE | still within the 1-year validity and no unpaid past months |
| EXPIRING SOON / PAYMENT DUE | expires within 30 days, **or** 1–2 past months are unpaid |
| EXPIRED | the validity date has passed, **or** 3+ past months are unpaid |

- A month counts as paid only after an admin **verifies** the payment, or **approves** a waiver for it.
- Renewal opens 60 days before expiry, and only when every month up to now is paid or waived.

---

## 1. Try it locally (demo mode)

Until you paste in a Firebase config, the site runs in **DEMO MODE** and saves data only in your browser.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:5500. (Any static server works, e.g. VS Code Live Server. Opening the file directly with `file://` does **not** work, because the site uses JavaScript modules.)

Demo admin login: username `RSJJYCADMIN`, password kept privately by the club.

## 2. Connect Firebase

1. Go to https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode, region `asia-south1` is closest to Nepal).
4. **Project settings → General → Your apps → Web (</>)**: register the app and copy the `firebaseConfig` into `firebase-config.js`.
5. Create the admin account:
   - Authentication → Users → **Add user** → e-mail `rsjjycadmin@admin.rsjjyc.app` (the `ADMIN.email` in `config.js`), with the admin password.
   - Copy that user's **UID**. In Firestore, create the collection `admins`, add a document whose **ID is that UID**, and give it the field `role: "admin"`.
   - The admin then logs in on the site with username `RSJJYCADMIN` and that password.
6. Deploy the security rules (the `firestore.rules` file):
   ```bash
   npm install -g firebase-tools
   ```
   ```bash
   firebase login
   ```
   ```bash
   firebase use --add
   ```
   ```bash
   firebase deploy --only firestore:rules
   ```
7. Host the site, either:
   - **Firebase Hosting**: `firebase deploy --only hosting` → `https://<project>.web.app`, or
   - **GitHub Pages**: push the repo, then Settings → Pages → Deploy from branch `main` / root.  
     Then add the Pages domain under Authentication → Settings → **Authorized domains**.
8. Set `ORG.siteUrl` in `config.js` to the final public address, so QR codes always point to the live site.

> Photos are resized to about 40 KB and stored inside Firestore, so you do **not** need Firebase Storage or the paid Blaze plan.

## 3. Push to GitHub

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "RSJJYC membership platform"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/<your-account>/rsjjyc-membership.git
```
```bash
git push -u origin main
```

(The Firebase web config is not secret. It is safe to commit, because access is controlled by `firestore.rules`.)

## Customising

| What | Where |
|---|---|
| Logo | `logo.png` (replace the file to change it) |
| Organisation full name | `ORG.fullName` in `config.js` (currently Royal Star Jan Jyoti Youth Club, Estd. 1979) |
| Nepali translations / motivational lines | `NE` in `i18n.js`; hook lines in `home.js` (`HOOKS`) |
| Profession list (and which ones count as "employed") | `PROFESSIONS` in `config.js` |
| Address options | `PROVINCES` in `config.js` |
| Contribution amounts | `DONATION_TIERS` |
| Member types shown on card | `MEMBER_TYPES` (admin changes a member's type in Members → click row) |
| Payment methods | `PAYMENT_METHODS` |

## Files

```
index.html        landing page + Register / Member log in / Admin log in tabs
member.html       member dashboard
admin.html        admin dashboard
verify.html       public QR verification page
style.css         all styling (incl. the card design)
config.js         organisation settings, dropdown data, rules
firebase-config.js      Firebase config
store.js          data layer (Firebase or demo/localStorage)
utils.js          dates, ledger, status, membership number logic
card.js           card rendering, QR, PNG/JPG/PDF/print export
datepicker.js     AD / BS (Nepali) date-of-birth picker
firestore.rules   database security rules
logo.png          club logo
i18n.js           English / Nepali translations
home.js, member.js, admin.js   page logic
(All files sit in one folder — upload them all together to GitHub.)
```

## Known limitations

- **Payments are recorded, not processed.** Members enter the eSewa/Khalti/bank transaction number and an admin verifies it. To take real payments, add an eSewa or Khalti integration with a Cloud Function that verifies the payment.
- Without Cloud Functions, the security rules allow a member to change only their own renewal fields (expiry, periods), and limit how far ahead the expiry can be pushed. For stricter enforcement, move renewal into a Cloud Function.
