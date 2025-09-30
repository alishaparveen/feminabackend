const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

let ttsClient = null;

function initializeTTSClient() {
  try {
    if (!process.env.GCP_SA_JSON) {
      console.warn('⚠️  GCP_SA_JSON not set, TTS will not be available');
      return null;
    }

    const serviceAccount = JSON.parse(process.env.GCP_SA_JSON);
    ttsClient = new TextToSpeechClient({
      credentials: serviceAccount,
      projectId: serviceAccount.project_id
    });

    console.log('✅ Google Text-to-Speech client initialized');
    return ttsClient;
  } catch (error) {
    console.error('❌ Failed to initialize TTS client:', error.message);
    return null;
  }
}

async function synthesizeSpeech(text, options = {}) {
  if (!ttsClient) {
    throw new Error('TTS client not initialized');
  }

  const {
    voice = 'en-US-Standard-F',
    languageCode = 'en-US',
    format = 'mp3',
    speakingRate = 1.0,
    pitch = 0.0
  } = options;

  const maxLength = 5000;
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

  const request = {
    input: { text: truncatedText },
    voice: {
      languageCode,
      name: voice,
      ssmlGender: voice.includes('F') ? 'FEMALE' : 'MALE'
    },
    audioConfig: {
      audioEncoding: format === 'mp3' ? 'MP3' : 'OGG_OPUS',
      speakingRate,
      pitch
    }
  };

  try {
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    return {
      audioContent: response.audioContent,
      format,
      characterCount: truncatedText.length
    };
  } catch (error) {
    console.error('TTS synthesis error:', error);
    throw new Error(`Text-to-speech failed: ${error.message}`);
  }
}

async function estimateAudioDuration(characterCount, speakingRate = 1.0) {
  const avgCharactersPerSecond = 15 * speakingRate;
  const estimatedSeconds = Math.ceil(characterCount / avgCharactersPerSecond);
  return estimatedSeconds;
}

module.exports = {
  initializeTTSClient,
  synthesizeSpeech,
  estimateAudioDuration
};
