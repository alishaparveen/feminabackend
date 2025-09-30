const { SpeechClient } = require('@google-cloud/speech');

let sttClient = null;

function initializeSTTClient() {
  try {
    if (!process.env.GCP_SA_JSON) {
      console.warn('⚠️  GCP_SA_JSON not set, STT will not be available');
      return null;
    }

    const serviceAccount = JSON.parse(process.env.GCP_SA_JSON);
    sttClient = new SpeechClient({
      credentials: serviceAccount,
      projectId: serviceAccount.project_id
    });

    console.log('✅ Google Speech-to-Text client initialized');
    return sttClient;
  } catch (error) {
    console.error('❌ Failed to initialize STT client:', error.message);
    return null;
  }
}

async function transcribeAudioShort(audioContent, options = {}) {
  if (!sttClient) {
    throw new Error('STT client not initialized');
  }

  const {
    languageCode = 'en-US',
    encoding = 'MP3',
    sampleRateHertz = 16000,
    enableAutomaticPunctuation = true
  } = options;

  const request = {
    audio: { content: audioContent.toString('base64') },
    config: {
      encoding,
      sampleRateHertz,
      languageCode,
      enableAutomaticPunctuation
    }
  };

  try {
    const [response] = await sttClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    const confidence = response.results.length > 0
      ? response.results[0].alternatives[0].confidence
      : 0;

    return {
      transcript: transcription,
      confidence,
      wordCount: transcription.split(/\s+/).length
    };
  } catch (error) {
    console.error('STT transcription error:', error);
    throw new Error(`Speech-to-text failed: ${error.message}`);
  }
}

async function startLongRunningTranscription(gcsUri, options = {}) {
  if (!sttClient) {
    throw new Error('STT client not initialized');
  }

  const {
    languageCode = 'en-US',
    encoding = 'MP3',
    sampleRateHertz,
    enableAutomaticPunctuation = true
  } = options;

  const config = {
    encoding,
    languageCode,
    enableAutomaticPunctuation,
    enableWordTimeOffsets: true
  };
  
  if (sampleRateHertz) {
    config.sampleRateHertz = sampleRateHertz;
  }

  const request = {
    audio: { uri: gcsUri },
    config
  };

  try {
    const [operation] = await sttClient.longRunningRecognize(request);
    
    return {
      jobName: operation.name,
      operation
    };
  } catch (error) {
    console.error('STT long-running start error:', error);
    throw new Error(`Failed to start transcription: ${error.message}`);
  }
}

async function checkTranscriptionStatus(jobName) {
  if (!sttClient) {
    throw new Error('STT client not initialized');
  }

  try {
    const [operation] = await sttClient.checkLongRunningRecognizeProgress(jobName);
    
    if (!operation.done) {
      return {
        status: 'processing',
        done: false,
        progress: operation.metadata?.progressPercent || 0
      };
    }

    if (operation.error) {
      return {
        status: 'failed',
        done: true,
        error: operation.error.message
      };
    }

    const response = operation.response;
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    const confidence = response.results.length > 0
      ? response.results[0].alternatives[0].confidence
      : 0;

    return {
      status: 'ready',
      done: true,
      transcript: transcription,
      confidence,
      wordCount: transcription.split(/\s+/).length
    };
  } catch (error) {
    console.error('STT status check error:', error);
    throw new Error(`Failed to check transcription status: ${error.message}`);
  }
}

module.exports = {
  initializeSTTClient,
  transcribeAudioShort,
  startLongRunningTranscription,
  checkTranscriptionStatus
};
