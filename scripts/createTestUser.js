require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const testUserEmail = 'test+e2e@aurahealth.com';
const testUserPassword = 'SecureTestPass123!';
const testUserDisplayName = 'E2E Test User';

async function createOrUpdateTestUser() {
  try {
    let user;
    
    try {
      user = await admin.auth().getUserByEmail(testUserEmail);
      console.log(`User already exists with UID: ${user.uid}`);
      
      await admin.auth().updateUser(user.uid, {
        password: testUserPassword,
        displayName: testUserDisplayName
      });
      
      await admin.auth().setCustomUserClaims(user.uid, {});
      
      console.log(`✅ Updated existing user: ${user.uid}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        user = await admin.auth().createUser({
          email: testUserEmail,
          password: testUserPassword,
          displayName: testUserDisplayName
        });
        
        await admin.auth().setCustomUserClaims(user.uid, {});
        
        console.log(`✅ Created new user: ${user.uid}`);
      } else {
        throw error;
      }
    }
    
    console.log(`\nUser Details:`);
    console.log(`- UID: ${user.uid}`);
    console.log(`- Email: ${user.email}`);
    console.log(`- Display Name: ${user.displayName || testUserDisplayName}`);
    console.log(`- Custom Claims: {}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating/updating test user:', error);
    process.exit(1);
  }
}

createOrUpdateTestUser();
