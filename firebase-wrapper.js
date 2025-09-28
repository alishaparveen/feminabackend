/**
 * Firebase wrapper to handle initialization timing
 */
const { initializeApp, cert } = require('firebase-admin/app');

let isInitialized = false;

function ensureInitialized() {
  if (isInitialized) return;
  
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const serviceAccount = JSON.parse(serviceAccountKey);
    console.log('🔥 Initializing Firebase with service account for project:', serviceAccount.project_id);
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  } else {
    console.log('🔥 Initializing Firebase with default credentials');
    initializeApp();
  }
  
  isInitialized = true;
}

// Ensure Firebase is initialized before any service access
ensureInitialized();

module.exports = { ensureInitialized };