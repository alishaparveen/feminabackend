require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');
if (!admin.apps.length && serviceAccount.project_id) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  console.log('✅ Firebase Admin SDK initialized');
}

const db = admin.firestore();

const categoryMappings = {
  'pcos': 'Health',
  'fertility': 'Health',
  'pregnancy': 'Health',
  'mental health': 'Health',
  'fitness': 'Health',
  'nutrition': 'Health',
  'health': 'Health',
  'career': 'Career',
  'work': 'Career',
  'resume': 'Career',
  'job': 'Career',
  'salary': 'Career',
  'entrepreneurship': 'Career',
  'finance': 'Finance',
  'investing': 'Finance',
  'budget': 'Finance',
  'money': 'Finance',
  'savings': 'Finance',
  'debt': 'Finance',
  'dating': 'Relationships',
  'marriage': 'Relationships',
  'relationship': 'Relationships',
  'family': 'Relationships',
  'friendship': 'Relationships',
  'parenting': 'Parenting',
  'pregnancy': 'Parenting',
  'baby': 'Parenting',
  'kids': 'Parenting',
  'children': 'Parenting',
  'fashion': 'Lifestyle',
  'beauty': 'Lifestyle',
  'travel': 'Lifestyle',
  'lifestyle': 'Lifestyle',
  'education': 'Education',
  'learning': 'Education',
  'study': 'Education',
  'support': 'Support',
  'help': 'Support',
  'crisis': 'Support',
  'grief': 'Support'
};

function inferCategoryFromTags(tags) {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return 'Uncategorized';
  }

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase().trim();
    if (categoryMappings[lowerTag]) {
      return categoryMappings[lowerTag];
    }
  }

  return 'Uncategorized';
}

async function migrateStories() {
  try {
    console.log('🚀 Starting story category migration...');
    
    const storiesRef = db.collection('stories');
    let processedCount = 0;
    let updatedCount = 0;
    let lastDoc = null;
    const batchSize = 500;

    const categoryCounts = {};

    while (true) {
      let query = storiesRef.limit(batchSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      
      if (snapshot.empty) {
        console.log('📭 No more documents to process');
        break;
      }

      console.log(`📦 Processing batch of ${snapshot.docs.length} documents...`);

      const batch = db.batch();
      let batchCount = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        processedCount++;

        if (!data.category) {
          const inferredCategory = inferCategoryFromTags(data.tags);
          
          batch.update(doc.ref, {
            category: inferredCategory,
            subCategory: null
          });
          
          batchCount++;
          updatedCount++;

          categoryCounts[inferredCategory] = (categoryCounts[inferredCategory] || 0) + 1;

          console.log(`  ✏️  Story ${doc.id}: "${data.title?.substring(0, 40)}..." → ${inferredCategory}`);
        } else {
          categoryCounts[data.category] = (categoryCounts[data.category] || 0) + 1;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        console.log(`  ✅ Committed batch of ${batchCount} updates`);
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    console.log('\n📊 Updating category counts in meta collection...');
    await db.collection('meta').doc('storyCategoryCounts').set(categoryCounts, { merge: true });

    console.log('\n✨ Migration complete!');
    console.log(`   Total processed: ${processedCount}`);
    console.log(`   Total updated: ${updatedCount}`);
    console.log('\n📈 Category counts:');
    Object.entries(categoryCounts).forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count}`);
    });

    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateStories();
