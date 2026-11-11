// ============================================================================
//  RSJJYC Membership Platform — central configuration
//  Edit this file to change organisation details, dropdown options and rules.
// ============================================================================

export const ORG = {
  shortName: 'RSJJYC',
  fullName: 'Royal Star Jan Jyoti Youth Club',
  established: 1979,
  tagline: 'Membership Card',
  logo: 'logo.png',
  facebook: 'https://www.facebook.com/RSJJYC/',
  address: 'Nepal',
  // Membership number middle code -> 026-RSJJYC-001-PC
  memberCode: 'RSJJYC',
  // Public address of the deployed site, used inside QR codes, e.g.
  // 'https://your-project.web.app/'. Leave empty to use the current address.
  siteUrl: 'https://gitparihub-naamii.github.io/RSJJYC-Membership-/',
};

// Admin login. In Firebase mode the password lives ONLY in Firebase Auth
// (see README). In demo mode the password is checked against this SHA-256 hash.
export const ADMIN = {
  username: 'RSJJYC026',
  email: 'rsjjyc026@admin.rsjjyc.app',
  demoPasswordSha256: 'f65320796a3a59ec1168297395e73861ad9fae03f94f5511a036ef0a15386a92',
};

// Synthetic e-mail domain used when a member chooses a phone number as username
export const PHONE_LOGIN_DOMAIN = 'member.rsjjyc.app';

export const MEMBER_TYPES = ['General Member', 'BOD', 'Life Member', 'Volunteer'];

// ---------------------------------------------------------------------------
// Professions (same option set as the AI-training registration form).
// `employed: true`  -> monthly contribution options NPR 100 / 500 / 1000
// `employed: false` -> monthly contribution options NPR 10 / 20 / 50 / 100 / 500 / 1000
// Replace / extend with the exact list from your AI-training dataset.
// ---------------------------------------------------------------------------
export const PROFESSIONS = [
  { label: 'Student', employed: false },
  { label: 'Not working currently / Job seeker', employed: false },
  { label: 'Homemaker', employed: false },
  { label: 'Full-time Job (Private sector)', employed: true },
  { label: 'Part-time Job', employed: true },
  { label: 'Government Job', employed: true },
  { label: 'Teacher / Educator', employed: true },
  { label: 'Health Worker', employed: true },
  { label: 'IT / Software Professional', employed: true },
  { label: 'Engineer', employed: true },
  { label: 'NGO / INGO Staff', employed: true },
  { label: 'Business / Self-employed', employed: true },
  { label: 'Farmer / Agriculture', employed: true },
  { label: 'Researcher', employed: true },
  { label: 'Journalist / Media', employed: true },
  { label: 'Freelancer', employed: true },
  { label: 'Retired', employed: false },
  { label: 'Other', employed: false },
];

export const DONATION_TIERS = {
  employed: [100, 500, 1000],
  notEmployed: [10, 20, 50, 100, 500, 1000],
};

// ---------------------------------------------------------------------------
// Address options (Province -> District), as in the AI-attendance platform.
// Municipality, ward and tole are entered below the district.
// ---------------------------------------------------------------------------
export const PROVINCES = {
  'Koshi Province': ['Bhojpur', 'Dhankuta', 'Ilam', 'Jhapa', 'Khotang', 'Morang', 'Okhaldhunga', 'Panchthar', 'Sankhuwasabha', 'Solukhumbu', 'Sunsari', 'Taplejung', 'Terhathum', 'Udayapur'],
  'Madhesh Province': ['Bara', 'Dhanusha', 'Mahottari', 'Parsa', 'Rautahat', 'Saptari', 'Sarlahi', 'Siraha'],
  'Bagmati Province': ['Bhaktapur', 'Chitwan', 'Dhading', 'Dolakha', 'Kathmandu', 'Kavrepalanchok', 'Lalitpur', 'Makwanpur', 'Nuwakot', 'Ramechhap', 'Rasuwa', 'Sindhuli', 'Sindhupalchok'],
  'Gandaki Province': ['Baglung', 'Gorkha', 'Kaski', 'Lamjung', 'Manang', 'Mustang', 'Myagdi', 'Nawalpur', 'Parbat', 'Syangja', 'Tanahun'],
  'Lumbini Province': ['Arghakhanchi', 'Banke', 'Bardiya', 'Dang', 'Eastern Rukum', 'Gulmi', 'Kapilvastu', 'Parasi', 'Palpa', 'Pyuthan', 'Rolpa', 'Rupandehi'],
  'Karnali Province': ['Dailekh', 'Dolpa', 'Humla', 'Jajarkot', 'Jumla', 'Kalikot', 'Mugu', 'Salyan', 'Surkhet', 'Western Rukum'],
  'Sudurpashchim Province': ['Achham', 'Baitadi', 'Bajhang', 'Bajura', 'Dadeldhura', 'Darchula', 'Doti', 'Kailali', 'Kanchanpur'],
};

export const PAYMENT_METHODS = ['eSewa', 'Khalti', 'Fonepay / Mobile Banking', 'Bank Deposit', 'Cash to Treasurer'];

export const RULES = {
  membershipMonths: 12,          // card validity
  expiringSoonDays: 30,          // "about to expire" window
  renewWindowDays: 60,           // renewal opens this many days before expiry
  suspendAfterMissedMonths: 3,   // card shows EXPIRED after this many unpaid past months
  maxPhotoMB: 5,
};
