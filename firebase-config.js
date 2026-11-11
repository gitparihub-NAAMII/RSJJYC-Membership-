// ============================================================================
//  Firebase web-app config (Firebase console -> Project settings -> General ->
//  Your apps -> SDK setup and configuration).
//
//  While apiKey is "PASTE_YOUR_API_KEY", the site runs in DEMO MODE:
//  all data is stored only in this browser (localStorage).
// ============================================================================
export const firebaseConfig = {
  apiKey: 'AIzaSyAPOo1Xaa1Xj04rI1Q3zZf5zW1_38W9F0o',
  authDomain: 'rsjjys-membership.firebaseapp.com',
  projectId: 'rsjjys-membership',
  storageBucket: 'rsjjys-membership.firebasestorage.app',
  messagingSenderId: '362063681421',
  appId: '1:362063681421:web:e7f6f096a5534c02348fc4',
};

export const FIREBASE_ENABLED = !firebaseConfig.apiKey.startsWith('PASTE_');
