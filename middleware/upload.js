const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedAudioTypes = /mp3|wav|m4a|aac|ogg/;
  
  const extname = path.extname(file.originalname).toLowerCase().substring(1);
  
  if (file.fieldname === 'image') {
    if (allowedImageTypes.test(extname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Allowed: jpeg, jpg, png, gif, webp'), false);
    }
  } else if (file.fieldname === 'audio') {
    if (allowedAudioTypes.test(extname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio format. Allowed: mp3, wav, m4a, aac, ogg'), false);
    }
  } else {
    cb(new Error('Unexpected field'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

const uploadImageToStorage = async (file, userId) => {
  try {
    const bucket = admin.storage().bucket();
    const fileName = `stories/images/${userId}/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    return new Promise((resolve, reject) => {
      stream.on('error', (error) => {
        reject(error);
      });

      stream.on('finish', async () => {
        await fileUpload.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        resolve(publicUrl);
      });

      stream.end(file.buffer);
    });
  } catch (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
};

const uploadAudioToStorage = async (file, userId) => {
  try {
    const bucket = admin.storage().bucket();
    const fileName = `stories/audio/${userId}/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(fileName);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    return new Promise((resolve, reject) => {
      stream.on('error', (error) => {
        reject(error);
      });

      stream.on('finish', async () => {
        await fileUpload.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        resolve(publicUrl);
      });

      stream.end(file.buffer);
    });
  } catch (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
};

module.exports = {
  upload,
  uploadImageToStorage,
  uploadAudioToStorage
};
