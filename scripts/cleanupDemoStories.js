require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function cleanupDemoStories() {
  try {
    console.log('🧹 Cleaning up demo stories...\n');

    const snapshot = await db.collection('stories').where('isSeed', '==', 'demo').get();
    
    if (snapshot.empty) {
      console.log('No demo stories found to clean up.');
      process.exit(0);
    }

    console.log(`Found ${snapshot.size} demo stories to delete.`);
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      console.log(`🗑️  Deleting: ${doc.data().title} (${doc.id})`);
    });

    await batch.commit();
    console.log(`\n✅ Successfully deleted ${snapshot.size} demo stories!`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cleaning up demo stories:', error);
    process.exit(1);
  }
}

cleanupDemoStories();
