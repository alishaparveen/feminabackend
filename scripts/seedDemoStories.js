require('dotenv').config();
const admin = require('firebase-admin');
const { faker } = require('@faker-js/faker');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const curatedStories = [
  {
    title: "I Left My Dream Job for My Mental Health",
    excerpt: "Burnout taught me that success is meaningless if I'm falling apart inside.",
    content: `I had the dream job — good pay, big brand name, constant hustle. 
But over time, late nights and endless pressure ate away at me. My hair started falling, I had panic attacks before meetings, and even weekends felt like a blur of exhaustion.

Walking away was the hardest decision — I thought I'd be a failure. Instead, I rediscovered sleep, therapy, and self-worth. 
Now I work at a smaller company, with time to breathe, and I've never been happier.`,
    category: "Career",
    subCategory: "Work-Life Balance",
    tags: ["mental-health", "burnout", "career-shift"],
    imageUrl: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b",
    audioStatus: "ready",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    transcriptStatus: "ready",
    transcript: "I had the dream job but constant hustle broke me. Leaving it was freedom.",
  },
  {
    title: "Why I Started Investing Even When I Was Scared",
    excerpt: "Money used to terrify me, but learning step by step changed everything.",
    content: `For years I avoided investing — I thought it was only for rich or smart people. 
But inflation and rising costs made me realize saving wasn't enough. 

I began with mutual funds and small SIPs, asking dumb questions, making mistakes. Over time I gained confidence. 
Today, investing gives me not just returns, but peace of mind. If I can do it, anyone can.`,
    category: "Finance",
    subCategory: "Investing",
    tags: ["personal-finance", "investing", "money-mindset"],
    imageUrl: "https://images.unsplash.com/photo-1605902711622-cfb43c4437d1",
    audioStatus: "none",
    audioUrl: null,
    transcriptStatus: "none",
    transcript: null,
  },
  {
    title: "The Day I Stood Up for My Workplace Rights",
    excerpt: "HR told me I was 'overreacting.' I knew I had to speak up.",
    content: `When I was denied maternity benefits, I felt powerless. HR dismissed my questions, and colleagues told me not to make noise. 
But I knew my rights. I read up, spoke to a lawyer friend, and filed a formal complaint. 

The process was scary, but the outcome changed policies for everyone in my office. Sometimes, doing the uncomfortable thing creates fairness for many.`,
    category: "Legal",
    subCategory: "Workplace Law",
    tags: ["legal-rights", "women", "workplace"],
    imageUrl: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d",
    audioStatus: "none",
    audioUrl: null,
    transcriptStatus: "none",
    transcript: null,
  },
  {
    title: "Yoga Helped Me Find Myself Again",
    excerpt: "After pregnancy, I felt lost in my own body — yoga brought me home.",
    content: `Postpartum recovery was harder than I expected. My body felt strange, my energy was gone, and mentally I was in pieces. 
A friend introduced me to yoga — slowly, gently. 

Each practice felt like reclaiming a piece of myself. I didn't just stretch muscles; I stretched patience, self-compassion, and acceptance. 
Now, yoga isn't just fitness — it's my daily therapy.`,
    category: "Wellness",
    subCategory: "Yoga",
    tags: ["yoga", "postpartum", "wellness"],
    imageUrl: "https://images.unsplash.com/photo-1552058544-f2b08422138a",
    audioStatus: "ready",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    transcriptStatus: "ready",
    transcript: "Postpartum yoga helped me heal, not just physically but emotionally too.",
  },
  {
    title: "PCOS: Learning to Listen to My Body",
    excerpt: "Doctors told me to 'just lose weight.' Real healing came later.",
    content: `For years my PCOS was dismissed as a 'diet problem.' But extreme dieting only made me feel worse. 
Eventually I found a doctor who treated me like a whole person, not just a BMI. 

Through lifestyle changes, therapy, and a supportive community, I began to heal. PCOS doesn't define me anymore — I define how I live with it.`,
    category: "Health",
    subCategory: "PCOS",
    tags: ["health", "pcos", "self-care"],
    imageUrl: "https://images.unsplash.com/photo-1606813907291-89f82dfce2d5",
    audioStatus: "none",
    audioUrl: null,
    transcriptStatus: "none",
    transcript: null,
  },
  {
    title: "Switching Careers at 30: From IT to UX Design",
    excerpt: "Everyone said I was crazy. My only regret? Not starting sooner.",
    content: `I spent 7 years coding, but something always felt missing. I loved solving problems, but not the kind I was paid for. 
After many late-night doubts, I took a UX design course, freelanced, and finally landed a role as a product designer. 

The pay cut was scary, but the joy is priceless. Sometimes stability means risking the safe path.`,
    category: "Career",
    subCategory: "Career Growth",
    tags: ["career-change", "ux-design", "life-at-30"],
    imageUrl: "https://images.unsplash.com/photo-1551836022-4c4c79ecde51",
    audioStatus: "none",
    audioUrl: null,
    transcriptStatus: "none",
    transcript: null,
  },
];

async function seedDemoStories() {
  try {
    console.log('🌱 Seeding demo stories...\n');

    // Get test user
    const testUserEmail = process.env.TEST_USER_EMAIL || 'test+e2e@aurahealth.com';
    const testUser = await admin.auth().getUserByEmail(testUserEmail);
    console.log(`✅ Using test user: ${testUser.email} (UID: ${testUser.uid})\n`);

    const createdStories = [];

    for (const story of curatedStories) {
      const storyRef = db.collection('stories').doc();

      const storyData = {
        ...story,
        authorId: testUser.uid,
        authorName: testUser.displayName || 'E2E Test User',
        authorAvatar: `https://i.pravatar.cc/150?u=${testUser.uid}`,
        visibility: 'public',
        moderation: {
          status: 'approved',
          reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewedBy: 'system'
        },
        likesCount: Math.floor(Math.random() * 50),
        savesCount: Math.floor(Math.random() * 20),
        commentsCount: Math.floor(Math.random() * 10),
        views: Math.floor(Math.random() * 200),
        trendingScore: parseFloat((Math.random() * 10).toFixed(2)),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isSeed: 'demo'
      };

      await storyRef.set(storyData);
      createdStories.push({ id: storyRef.id, title: story.title });
      console.log(`📝 Created: ${story.title} (ID: ${storyRef.id})`);
    }

    console.log(`\n✅ Successfully seeded ${createdStories.length} demo stories!`);
    console.log(`\n📋 Created Story IDs:`);
    createdStories.forEach(s => console.log(`   - ${s.id}: ${s.title}`));
    
    console.log(`\n💡 To clean up these stories later, delete all documents where isSeed = 'demo'`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding demo stories:', error);
    process.exit(1);
  }
}

seedDemoStories();
