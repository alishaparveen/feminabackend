const admin = require('firebase-admin');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ttsService = require('../services/tts.google');
const sttService = require('../services/stt.google');
const storageHelper = require('../services/storageHelper');

const db = admin.firestore();

function getAudioEncoding(extension) {
  const encodingMap = {
    'mp3': 'MP3',
    'webm': 'WEBM_OPUS',
    'ogg': 'OGG_OPUS',
    'opus': 'OGG_OPUS',
    'flac': 'FLAC',
    'wav': 'LINEAR16'
  };
  
  return encodingMap[extension.toLowerCase()] || 'MP3';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 
      'audio/opus', 'audio/wav', 'audio/wave', 'audio/x-wav', 
      'audio/flac', 'audio/x-flac'
    ];
    const allowedExtensions = /\.(mp3|webm|ogg|opus|wav|flac)$/i;
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(allowedExtensions)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported formats: mp3, webm, ogg, wav, flac (Note: m4a/aac not supported by Speech-to-Text)'));
    }
  }
});

async function uploadAudio(req, res) {
  try {
    const { storyId } = req.params;
    const { requestSignedUrl } = req.body;

    const storyRef = db.collection('stories').doc(storyId);
    const storyDoc = await storyRef.get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    const storyData = storyDoc.data();
    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Only the story author can upload audio'
      });
    }

    if (requestSignedUrl === true || requestSignedUrl === 'true') {
      const extension = req.body.extension || 'mp3';
      const contentType = req.body.contentType || 'audio/mpeg';
      const path = storageHelper.generateAudioPath(storyId, extension);
      const audioEncoding = getAudioEncoding(extension);
      
      const signedUrlData = await storageHelper.generateSignedUploadUrl(path, contentType);

      await storyRef.update({
        audioPath: path,
        audioEncoding,
        audioStatus: 'pending_upload',
        updatedAt: new Date()
      });

      return res.json({
        success: true,
        data: {
          uploadUrl: signedUrlData.uploadUrl,
          audioPath: path,
          gsUri: signedUrlData.gsUri,
          audioEncoding,
          instructions: 'Use PUT request to upload file to uploadUrl, then call transcribe endpoint'
        }
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided'
      });
    }

    const extension = req.file.originalname.split('.').pop() || 'mp3';
    const path = storageHelper.generateAudioPath(storyId, extension);
    const contentType = req.file.mimetype;
    const audioEncoding = getAudioEncoding(extension);

    const uploadResult = await storageHelper.uploadAudioToStorage(
      req.file.buffer,
      path,
      contentType
    );

    await storyRef.update({
      audioUrl: uploadResult.url,
      audioStatus: 'processing',
      audioPath: path,
      audioEncoding,
      updatedAt: new Date()
    });

    const transcriptionJob = await sttService.startLongRunningTranscription(
      uploadResult.gsUri,
      {
        encoding: audioEncoding
      }
    );

    await storyRef.update({
      transcriptionJobId: transcriptionJob.jobName,
      transcriptStatus: 'processing'
    });

    res.json({
      success: true,
      data: {
        audioPath: path,
        audioUrl: uploadResult.url,
        transcriptionJobId: transcriptionJob.jobName,
        message: 'Audio uploaded and transcription started'
      }
    });

  } catch (error) {
    console.error('Upload audio error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload audio',
      message: error.message
    });
  }
}

async function generateAudio(req, res) {
  try {
    const { id: storyId } = req.params;
    const { voice, textScope = 'excerpt' } = req.body;
    let { format = 'mp3' } = req.body;
    
    if (!['mp3', 'ogg'].includes(format)) {
      format = 'mp3';
    }

    const storyRef = db.collection('stories').doc(storyId);
    const storyDoc = await storyRef.get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    const storyData = storyDoc.data();
    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Only the story author can generate audio'
      });
    }

    let textToSynthesize = storyData.title || '';
    
    if (textScope === 'content' && storyData.content) {
      textToSynthesize = `${textToSynthesize}. ${storyData.content}`;
    } else if (storyData.excerpt) {
      textToSynthesize = `${textToSynthesize}. ${storyData.excerpt}`;
    }

    if (!textToSynthesize.trim()) {
      return res.status(400).json({
        success: false,
        error: 'No text available to generate audio'
      });
    }

    const ttsResult = await ttsService.synthesizeSpeech(textToSynthesize, {
      voice,
      format
    });

    const path = storageHelper.generateAudioPath(storyId, format);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/ogg';
    const audioEncoding = getAudioEncoding(format);

    const uploadResult = await storageHelper.uploadAudioToStorage(
      ttsResult.audioContent,
      path,
      contentType
    );

    const audioDuration = await ttsService.estimateAudioDuration(ttsResult.characterCount);

    await storyRef.update({
      audioUrl: uploadResult.url,
      audioStatus: 'ready',
      audioPath: path,
      audioEncoding,
      audioDuration,
      ttsTaskId: null,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      data: {
        audioUrl: uploadResult.url,
        audioPath: path,
        audioDuration,
        characterCount: ttsResult.characterCount,
        message: 'Audio generated successfully'
      }
    });

  } catch (error) {
    console.error('Generate audio error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate audio',
      message: error.message
    });
  }
}

async function transcribeAudio(req, res) {
  try {
    const { id: storyId } = req.params;
    const { audioPath } = req.body;

    const storyRef = db.collection('stories').doc(storyId);
    const storyDoc = await storyRef.get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    const storyData = storyDoc.data();
    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Only the story author can transcribe audio'
      });
    }

    const pathToTranscribe = audioPath || storyData.audioPath;
    if (!pathToTranscribe) {
      return res.status(400).json({
        success: false,
        error: 'No audio path provided and no audio attached to story'
      });
    }

    const audioEncoding = storyData.audioEncoding || 'MP3';
    const bucket = storageHelper.getStorageBucket();
    const gsUri = `gs://${bucket.name}/${pathToTranscribe}`;

    const transcriptionJob = await sttService.startLongRunningTranscription(gsUri, {
      encoding: audioEncoding
    });

    await storyRef.update({
      transcriptionJobId: transcriptionJob.jobName,
      transcriptStatus: 'processing',
      updatedAt: new Date()
    });

    res.json({
      success: true,
      data: {
        jobId: transcriptionJob.jobName,
        status: 'processing',
        pollingUrl: `/api/stories/${storyId}/audio-status`,
        message: 'Transcription started'
      }
    });

  } catch (error) {
    console.error('Transcribe audio error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start transcription',
      message: error.message
    });
  }
}

async function getAudioStatus(req, res) {
  try {
    const { id: storyId } = req.params;

    const storyDoc = await db.collection('stories').doc(storyId).get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    const storyData = storyDoc.data();

    res.json({
      success: true,
      data: {
        audioStatus: storyData.audioStatus || 'none',
        audioUrl: storyData.audioUrl || null,
        audioDuration: storyData.audioDuration || null,
        transcriptStatus: storyData.transcriptStatus || 'none',
        transcript: storyData.transcript || null,
        transcriptionConfidence: storyData.transcriptionConfidence || null
      }
    });

  } catch (error) {
    console.error('Get audio status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get audio status',
      message: error.message
    });
  }
}

async function handleTranscriptionComplete(jobId, result) {
  try {
    const storiesSnapshot = await db.collection('stories')
      .where('transcriptionJobId', '==', jobId)
      .limit(1)
      .get();

    if (storiesSnapshot.empty) {
      console.warn(`No story found for transcription job: ${jobId}`);
      return;
    }

    const storyDoc = storiesSnapshot.docs[0];
    const updateData = {
      transcriptionJobId: null,
      updatedAt: new Date()
    };

    if (result.status === 'ready') {
      updateData.transcript = result.transcript;
      updateData.transcriptStatus = 'ready';
      updateData.transcriptionConfidence = result.confidence;
    } else if (result.status === 'failed') {
      updateData.transcriptStatus = 'failed';
      updateData.transcriptionError = result.error;
    }

    await storyDoc.ref.update(updateData);
    console.log(`✅ Transcription ${result.status} for story ${storyDoc.id}`);

  } catch (error) {
    console.error('Handle transcription complete error:', error);
    throw error;
  }
}

async function regenerateAudio(req, res) {
  try {
    const { id: storyId } = req.params;
    const { voice, textScope = 'excerpt' } = req.body;
    let { format = 'mp3' } = req.body;
    
    if (!['mp3', 'ogg'].includes(format)) {
      format = 'mp3';
    }

    const storyRef = db.collection('stories').doc(storyId);
    const storyDoc = await storyRef.get();

    if (!storyDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Story not found'
      });
    }

    const storyData = storyDoc.data();
    if (storyData.authorId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Only the story author can regenerate audio'
      });
    }

    if (storyData.audioPath) {
      await storageHelper.deleteFile(storyData.audioPath);
    }

    let textToSynthesize = storyData.title || '';
    
    if (textScope === 'content' && storyData.content) {
      textToSynthesize = `${textToSynthesize}. ${storyData.content}`;
    } else if (storyData.excerpt) {
      textToSynthesize = `${textToSynthesize}. ${storyData.excerpt}`;
    }

    const ttsResult = await ttsService.synthesizeSpeech(textToSynthesize, {
      voice,
      format
    });

    const path = storageHelper.generateAudioPath(storyId, format);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/ogg';
    const audioEncoding = getAudioEncoding(format);

    const uploadResult = await storageHelper.uploadAudioToStorage(
      ttsResult.audioContent,
      path,
      contentType
    );

    const audioDuration = await ttsService.estimateAudioDuration(ttsResult.characterCount);

    await storyRef.update({
      audioUrl: uploadResult.url,
      audioStatus: 'ready',
      audioPath: path,
      audioEncoding,
      audioDuration,
      transcript: null,
      transcriptStatus: 'none',
      transcriptionJobId: null,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      data: {
        audioUrl: uploadResult.url,
        audioPath: path,
        audioDuration,
        message: 'Audio regenerated successfully'
      }
    });

  } catch (error) {
    console.error('Regenerate audio error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate audio',
      message: error.message
    });
  }
}

module.exports = {
  upload,
  uploadAudio,
  generateAudio,
  transcribeAudio,
  getAudioStatus,
  handleTranscriptionComplete,
  regenerateAudio
};
