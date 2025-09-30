const express = require('express');
const router = express.Router();
const audioController = require('../controllers/audioController');
const { authenticateUser } = require('../middleware/authenticateUser');

router.post('/upload/:storyId', authenticateUser, audioController.upload.single('audio'), audioController.uploadAudio);

router.post('/stories/:id/generate-audio', authenticateUser, audioController.generateAudio);

router.post('/stories/:id/transcribe', authenticateUser, audioController.transcribeAudio);

router.get('/stories/:id/audio-status', audioController.getAudioStatus);

router.post('/stories/:id/regenerate-audio', authenticateUser, audioController.regenerateAudio);

module.exports = router;
