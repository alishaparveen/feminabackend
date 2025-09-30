const admin = require('firebase-admin');
const sttService = require('../services/stt.google');
const audioController = require('../controllers/audioController');

const db = admin.firestore();

async function pollTranscriptionJobs() {
  try {
    const processingStories = await db.collection('stories')
      .where('transcriptStatus', '==', 'processing')
      .where('transcriptionJobId', '!=', null)
      .get();

    if (processingStories.empty) {
      console.log('No transcription jobs to poll');
      return;
    }

    console.log(`Polling ${processingStories.size} transcription job(s)...`);

    for (const doc of processingStories.docs) {
      const story = doc.data();
      const jobId = story.transcriptionJobId;

      try {
        const status = await sttService.checkTranscriptionStatus(jobId);

        if (status.done) {
          await audioController.handleTranscriptionComplete(jobId, status);
          
          if (status.status === 'ready') {
            console.log(`✅ Transcription completed for story ${doc.id}`);
          } else {
            console.log(`❌ Transcription failed for story ${doc.id}: ${status.error}`);
          }
        } else {
          console.log(`⏳ Transcription in progress for story ${doc.id} (${status.progress}%)`);
        }
      } catch (error) {
        console.error(`Error checking transcription for story ${doc.id}:`, error);
        
        await doc.ref.update({
          transcriptStatus: 'failed',
          transcriptionJobId: null,
          transcriptionError: error.message,
          updatedAt: new Date()
        });
      }
    }
  } catch (error) {
    console.error('Transcription poller error:', error);
  }
}

async function startPollingLoop(intervalSeconds = 30) {
  console.log(`🔄 Starting transcription poller (every ${intervalSeconds}s)...`);
  
  await pollTranscriptionJobs();
  
  setInterval(async () => {
    await pollTranscriptionJobs();
  }, intervalSeconds * 1000);
}

if (require.main === module) {
  if (!admin.apps.length) {
    const serviceAccount = require('../serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  sttService.initializeSTTClient();
  
  const interval = parseInt(process.env.TRANSCRIPTION_POLL_INTERVAL) || 30;
  startPollingLoop(interval);
}

module.exports = {
  pollTranscriptionJobs,
  startPollingLoop
};
