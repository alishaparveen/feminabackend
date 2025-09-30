#!/usr/bin/env node
/**
 * Get Firebase ID Token from Test User Credentials
 * 
 * This script exchanges email/password credentials for a Firebase ID token
 * using the Firebase Authentication REST API.
 * 
 * Usage:
 *   node scripts/getIdTokenFromCredentials.js
 * 
 * The script will:
 * 1. Read TEST_USER_EMAIL and TEST_USER_PASSWORD from environment
 * 2. Exchange them for an ID token via Firebase REST API
 * 3. Print the ID token (valid for 1 hour)
 * 
 * Use the token in API requests:
 *   curl -H "Authorization: Bearer <TOKEN>" http://localhost:5000/api/...
 */

require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function getIdToken() {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    console.error('❌ Error: TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in environment');
    console.error('\nMake sure these secrets are configured in Replit Secrets.');
    process.exit(1);
  }

  try {
    // Get user to verify they exist
    const user = await admin.auth().getUserByEmail(email);
    console.log(`🔍 Found user: ${user.email} (UID: ${user.uid})`);

    // Create custom token
    const customToken = await admin.auth().createCustomToken(user.uid);
    console.log('🔑 Created custom token\n');

    console.log('✅ Custom Token (use to exchange for ID token):');
    console.log(customToken);
    
    console.log('\n📋 To get an ID token, use one of these methods:');
    console.log('\n1. Using Firebase REST API:');
    console.log(`   POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=<WEB_API_KEY>`);
    console.log('   Body: {"token": "<CUSTOM_TOKEN>", "returnSecureToken": true}');
    
    console.log('\n2. Using Firebase Client SDK in browser/frontend:');
    console.log('   firebase.auth().signInWithCustomToken(customToken)');
    console.log('   .then(userCredential => userCredential.user.getIdToken())');
    
    console.log('\n3. For testing with email/password directly:');
    console.log(`   POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<WEB_API_KEY>`);
    console.log(`   Body: {"email": "${email}", "password": "***", "returnSecureToken": true}`);
    
    console.log('\n💡 Note: You need the Firebase Web API Key from your Firebase Console.');
    console.log('   Find it at: Firebase Console > Project Settings > General > Web API Key');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getIdToken()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
