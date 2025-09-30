const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

function getStorageBucket() {
  return admin.storage().bucket();
}

async function uploadAudioToStorage(buffer, path, contentType) {
  try {
    const bucket = getStorageBucket();
    const file = bucket.file(path);

    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: uuidv4()
        }
      },
      resumable: false
    });

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    return {
      path,
      url,
      gsUri: `gs://${bucket.name}/${path}`
    };
  } catch (error) {
    console.error('Storage upload error:', error);
    throw new Error(`Failed to upload to storage: ${error.message}`);
  }
}

async function generateSignedUploadUrl(path, contentType, expiresInMinutes = 15) {
  try {
    const bucket = getStorageBucket();
    const file = bucket.file(path);

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
      contentType
    });

    return {
      uploadUrl: url,
      path,
      gsUri: `gs://${bucket.name}/${path}`
    };
  } catch (error) {
    console.error('Signed URL generation error:', error);
    throw new Error(`Failed to generate upload URL: ${error.message}`);
  }
}

async function getPublicUrl(path) {
  try {
    const bucket = getStorageBucket();
    const file = bucket.file(path);

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    return url;
  } catch (error) {
    console.error('Get URL error:', error);
    throw new Error(`Failed to get file URL: ${error.message}`);
  }
}

async function deleteFile(path) {
  try {
    const bucket = getStorageBucket();
    const file = bucket.file(path);
    await file.delete();
    return true;
  } catch (error) {
    console.error('Delete file error:', error);
    return false;
  }
}

function generateAudioPath(storyId, extension) {
  const filename = `${uuidv4()}.${extension}`;
  return `stories/${storyId}/audio/${filename}`;
}

module.exports = {
  uploadAudioToStorage,
  generateSignedUploadUrl,
  getPublicUrl,
  deleteFile,
  generateAudioPath,
  getStorageBucket
};
