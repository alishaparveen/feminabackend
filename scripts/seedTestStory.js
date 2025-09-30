require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const TEST_STORY_ID = 'test_story_e2e_1';

async function seedTestStory() {
  try {
    const testUserEmail = process.env.TEST_USER_EMAIL || 'test+e2e@aurahealth.com';
    
    const user = await admin.auth().getUserByEmail(testUserEmail);
    console.log(`✅ Found test user: ${user.email} (UID: ${user.uid})`);

    const storyData = {
      _id: TEST_STORY_ID,
      title: 'E2E: Test story for audio-status',
      excerpt: 'Short test story for automated tests',
      content: 'This is a short test story used by automated smoke & e2e tests.',
      category: 'Test',
      subCategory: 'E2E',
      tags: ['test', 'e2e'],
      authorId: user.uid,
      visibility: 'public',
      moderation: {
        status: 'approved',
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: 'system'
      },
      audioStatus: 'none',
      audioUrl: null,
      audioPath: null,
      audioEncoding: null,
      audioDuration: null,
      transcript: null,
      transcriptStatus: 'none',
      transcriptionJobId: null,
      transcriptionConfidence: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const storyRef = db.collection('stories').doc(TEST_STORY_ID);
    const existingDoc = await storyRef.get();

    if (existingDoc.exists) {
      console.log(`📝 Story already exists, updating to ensure deterministic state...`);
      
      const updateData = { ...storyData };
      delete updateData.createdAt;
      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      
      await storyRef.update(updateData);
      console.log(`✅ Updated existing test story: ${TEST_STORY_ID}`);
    } else {
      await storyRef.set(storyData);
      console.log(`✅ Created new test story: ${TEST_STORY_ID}`);
    }

    const story = await storyRef.get();
    console.log(`\n📋 Test Story Details:`);
    console.log(`   ID: ${story.id}`);
    console.log(`   Path: stories/${story.id}`);
    console.log(`   Title: ${story.data().title}`);
    console.log(`   Author ID: ${story.data().authorId}`);
    console.log(`   Category: ${story.data().category}`);
    console.log(`   Audio Status: ${story.data().audioStatus}`);
    console.log(`   Transcript Status: ${story.data().transcriptStatus}`);
    
    console.log(`\n✅ Test story is ready for integration tests!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test story:', error);
    process.exit(1);
  }
}

seedTestStory();
