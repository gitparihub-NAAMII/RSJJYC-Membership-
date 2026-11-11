// ============================================================================
//  Paste your Firebase web-app config here (Firebase console ->
//  Project settings -> General -> Your apps -> SDK setup and configuration).
//
//  While apiKey is still "PASTE_YOUR_API_KEY", the site runs in DEMO MODE:
//  all data is stored only in this browser (localStorage) so you can try it out.
// ============================================================================
export const firebaseConfig = {
  apiKey: 'apiKey: "AIzaSyAPOo1Xaa1Xj04rI1Q3zZf5zW1_38W9F0o",
  authDomain: "rsjjys-membership.firebaseapp.com",
  projectId: "rsjjys-membership",
  storageBucket: "rsjjys-membership.firebasestorage.app",
  messagingSenderId: "362063681421",
  appId: "1:362063681421:web:e7f6f096a5534c02348fc4"',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

export const FIREBASE_ENABLED = !firebaseConfig.apiKey.startsWith('PASTE_');
