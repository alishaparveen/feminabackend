"use strict";
/**
 * File Upload Routes for Femina Platform
 * Handles image and document uploads to Firebase Storage
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadsRoutes = void 0;
const express_1 = require("express");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const sharp_1 = __importDefault(require("sharp"));
const zod_1 = require("zod");
const router = (0, express_1.Router)();
exports.uploadsRoutes = router;
const db = (0, firestore_1.getFirestore)();
// Initialize storage bucket with a default name for development
const bucket = (0, storage_1.getStorage)().bucket(process.env.FIREBASE_STORAGE_BUCKET || 'femina-aee4b.appspot.com');
// Configure multer for file uploads
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5 // Maximum 5 files per request
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type'));
        }
    }
});
// Validation schemas
const uploadMetadataSchema = zod_1.z.object({
    purpose: zod_1.z.enum(['profile_avatar', 'post_image', 'product_image', 'document', 'verification']),
    alt: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    isPublic: zod_1.z.boolean().default(true)
});
/**
 * POST /api/uploads/image
 * Upload and process images
 */
router.post('/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No File',
                message: 'No image file provided'
            });
        }
        const { purpose = 'post_image', alt, description, isPublic = true } = req.body;
        const userId = req.user.uid;
        // Validate file is actually an image
        if (!req.file.mimetype.startsWith('image/')) {
            return res.status(400).json({
                error: 'Invalid File Type',
                message: 'Only image files are allowed for this endpoint'
            });
        }
        // Check user upload quota
        const quotaCheck = await checkUploadQuota(userId, 'image');
        if (!quotaCheck.allowed) {
            return res.status(429).json({
                error: 'Quota Exceeded',
                message: quotaCheck.message
            });
        }
        // Generate unique filename
        const fileId = (0, uuid_1.v4)();
        const originalExtension = req.file.originalname.split('.').pop() || 'jpg';
        const fileName = `${fileId}.${originalExtension}`;
        // Process image based on purpose
        const processedImages = await processImage(req.file.buffer, purpose);
        // Upload processed images to Firebase Storage
        const uploadPromises = processedImages.map(async ({ buffer, suffix, width, height }) => {
            const fullFileName = suffix ? `${fileId}_${suffix}.${originalExtension}` : fileName;
            const filePath = `uploads/${userId}/images/${purpose}/${fullFileName}`;
            const file = bucket.file(filePath);
            await file.save(buffer, {
                metadata: {
                    contentType: req.file.mimetype,
                    metadata: {
                        uploadedBy: userId,
                        purpose,
                        originalName: req.file.originalname,
                        width: width?.toString(),
                        height: height?.toString(),
                        alt: alt || '',
                        description: description || ''
                    }
                },
                public: isPublic
            });
            // Get download URL
            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: '03-01-2500' // Far future date for permanent access
            });
            return {
                size: suffix || 'original',
                url,
                width,
                height,
                path: filePath
            };
        });
        const uploadedImages = await Promise.all(uploadPromises);
        // Store file metadata in Firestore
        const fileMetadata = {
            id: fileId,
            userId,
            type: 'image',
            purpose,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            sizes: uploadedImages,
            alt: alt || '',
            description: description || '',
            isPublic,
            uploadedAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('uploads').doc(fileId).set(fileMetadata);
        // Update user's upload quota
        await updateUploadQuota(userId, 'image', req.file.size);
        res.json({
            success: true,
            data: {
                fileId,
                images: uploadedImages,
                metadata: {
                    purpose,
                    alt: alt || '',
                    description: description || ''
                }
            }
        });
    }
    catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({
            error: 'Upload Error',
            message: 'Failed to upload image'
        });
    }
});
/**
 * POST /api/uploads/document
 * Upload documents (PDF, DOC, TXT)
 */
router.post('/document', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No File',
                message: 'No document file provided'
            });
        }
        const { purpose = 'document', description, isPublic = false } = req.body;
        const userId = req.user.uid;
        // Validate file type
        const allowedDocTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];
        if (!allowedDocTypes.includes(req.file.mimetype)) {
            return res.status(400).json({
                error: 'Invalid File Type',
                message: 'Only PDF, DOC, DOCX, and TXT files are allowed'
            });
        }
        // Check upload quota
        const quotaCheck = await checkUploadQuota(userId, 'document');
        if (!quotaCheck.allowed) {
            return res.status(429).json({
                error: 'Quota Exceeded',
                message: quotaCheck.message
            });
        }
        // Generate unique filename
        const fileId = (0, uuid_1.v4)();
        const originalExtension = req.file.originalname.split('.').pop() || 'pdf';
        const fileName = `${fileId}.${originalExtension}`;
        const filePath = `uploads/${userId}/documents/${purpose}/${fileName}`;
        // Upload to Firebase Storage
        const file = bucket.file(filePath);
        await file.save(req.file.buffer, {
            metadata: {
                contentType: req.file.mimetype,
                metadata: {
                    uploadedBy: userId,
                    purpose,
                    originalName: req.file.originalname,
                    description: description || '',
                    size: req.file.size.toString()
                }
            },
            public: isPublic
        });
        // Get download URL
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: '03-01-2500'
        });
        // Store metadata in Firestore
        const fileMetadata = {
            id: fileId,
            userId,
            type: 'document',
            purpose,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            url,
            path: filePath,
            description: description || '',
            isPublic,
            uploadedAt: new Date(),
            updatedAt: new Date()
        };
        await db.collection('uploads').doc(fileId).set(fileMetadata);
        // Update quota
        await updateUploadQuota(userId, 'document', req.file.size);
        res.json({
            success: true,
            data: {
                fileId,
                url,
                fileName: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype,
                metadata: {
                    purpose,
                    description: description || ''
                }
            }
        });
    }
    catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({
            error: 'Upload Error',
            message: 'Failed to upload document'
        });
    }
});
/**
 * POST /api/uploads/multiple
 * Upload multiple files at once
 */
router.post('/multiple', upload.array('files', 5), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                error: 'No Files',
                message: 'No files provided'
            });
        }
        const { purpose = 'post_image', isPublic = true } = req.body;
        const userId = req.user.uid;
        // Check quota for all files
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        const quotaCheck = await checkUploadQuota(userId, 'bulk', totalSize);
        if (!quotaCheck.allowed) {
            return res.status(429).json({
                error: 'Quota Exceeded',
                message: quotaCheck.message
            });
        }
        // Process each file
        const uploadPromises = files.map(async (file) => {
            const fileId = (0, uuid_1.v4)();
            const originalExtension = file.originalname.split('.').pop() || 'jpg';
            const fileName = `${fileId}.${originalExtension}`;
            try {
                if (file.mimetype.startsWith('image/')) {
                    // Process as image
                    const processedImages = await processImage(file.buffer, purpose);
                    const mainImage = processedImages[0]; // Use original size
                    const filePath = `uploads/${userId}/images/${purpose}/${fileName}`;
                    const storageFile = bucket.file(filePath);
                    await storageFile.save(mainImage.buffer, {
                        metadata: {
                            contentType: file.mimetype,
                            metadata: {
                                uploadedBy: userId,
                                purpose,
                                originalName: file.originalname
                            }
                        },
                        public: isPublic
                    });
                    const [url] = await storageFile.getSignedUrl({
                        action: 'read',
                        expires: '03-01-2500'
                    });
                    return {
                        fileId,
                        originalName: file.originalname,
                        type: 'image',
                        url,
                        size: file.size,
                        success: true
                    };
                }
                else {
                    // Process as document
                    const filePath = `uploads/${userId}/documents/${purpose}/${fileName}`;
                    const storageFile = bucket.file(filePath);
                    await storageFile.save(file.buffer, {
                        metadata: {
                            contentType: file.mimetype,
                            metadata: {
                                uploadedBy: userId,
                                purpose,
                                originalName: file.originalname
                            }
                        },
                        public: isPublic
                    });
                    const [url] = await storageFile.getSignedUrl({
                        action: 'read',
                        expires: '03-01-2500'
                    });
                    return {
                        fileId,
                        originalName: file.originalname,
                        type: 'document',
                        url,
                        size: file.size,
                        success: true
                    };
                }
            }
            catch (error) {
                console.error(`Error uploading file ${file.originalname}:`, error);
                return {
                    originalName: file.originalname,
                    success: false,
                    error: error.message
                };
            }
        });
        const results = await Promise.all(uploadPromises);
        // Store successful uploads in Firestore
        const successfulUploads = results.filter(result => result.success);
        const batchPromises = successfulUploads.map(async (upload) => {
            await db.collection('uploads').doc(upload.fileId).set({
                id: upload.fileId,
                userId,
                type: upload.type,
                purpose,
                originalName: upload.originalName,
                url: upload.url,
                size: upload.size,
                isPublic,
                uploadedAt: new Date()
            });
        });
        await Promise.all(batchPromises);
        // Update quota
        const successfulSize = successfulUploads.reduce((sum, upload) => sum + (upload.size || 0), 0);
        await updateUploadQuota(userId, 'bulk', successfulSize);
        res.json({
            success: true,
            data: {
                uploaded: successfulUploads.length,
                failed: results.length - successfulUploads.length,
                results
            }
        });
    }
    catch (error) {
        console.error('Error uploading multiple files:', error);
        res.status(500).json({
            error: 'Upload Error',
            message: 'Failed to upload files'
        });
    }
});
/**
 * GET /api/uploads/my-files
 * Get user's uploaded files
 */
router.get('/my-files', async (req, res) => {
    try {
        const userId = req.user.uid;
        const { type, purpose, page = 1, limit = 20, sortBy = 'uploadedAt', sortOrder = 'desc' } = req.query;
        let query = db.collection('uploads').where('userId', '==', userId);
        if (type) {
            query = query.where('type', '==', type);
        }
        if (purpose) {
            query = query.where('purpose', '==', purpose);
        }
        // Apply sorting
        query = query.orderBy(sortBy.toString(), sortOrder);
        // Apply pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        const files = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        res.json({
            success: true,
            data: {
                files,
                pagination: {
                    currentPage: Number(page),
                    hasMore: querySnapshot.size === Number(limit)
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching user files:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch files'
        });
    }
});
/**
 * DELETE /api/uploads/:fileId
 * Delete an uploaded file
 */
router.delete('/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.uid;
        // Get file metadata
        const fileDoc = await db.collection('uploads').doc(fileId).get();
        if (!fileDoc.exists) {
            return res.status(404).json({
                error: 'File Not Found',
                message: 'File not found'
            });
        }
        const fileData = fileDoc.data();
        // Check if user owns the file
        if (fileData.userId !== userId) {
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You can only delete your own files'
            });
        }
        // Delete from Firebase Storage
        try {
            if (fileData.type === 'image' && fileData.sizes) {
                // Delete all image sizes
                const deletePromises = fileData.sizes.map((size) => bucket.file(size.path).delete().catch(err => console.warn('File not found in storage:', size.path)));
                await Promise.all(deletePromises);
            }
            else if (fileData.path) {
                // Delete single file
                await bucket.file(fileData.path).delete();
            }
        }
        catch (storageError) {
            console.warn('Error deleting from storage:', storageError);
            // Continue with Firestore deletion even if storage deletion fails
        }
        // Delete from Firestore
        await fileDoc.ref.delete();
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            error: 'Delete Error',
            message: 'Failed to delete file'
        });
    }
});
/**
 * GET /api/uploads/quota
 * Get user's upload quota status
 */
router.get('/quota', async (req, res) => {
    try {
        const userId = req.user.uid;
        const quotaDoc = await db.collection('uploadQuotas').doc(userId).get();
        let quotaData = {
            userId,
            monthlyUsed: 0,
            monthlyLimit: 100 * 1024 * 1024, // 100MB default
            dailyUploads: 0,
            dailyLimit: 50,
            lastReset: new Date()
        };
        if (quotaDoc.exists) {
            quotaData = { ...quotaData, ...quotaDoc.data() };
        }
        const remaining = quotaData.monthlyLimit - quotaData.monthlyUsed;
        const percentUsed = (quotaData.monthlyUsed / quotaData.monthlyLimit) * 100;
        res.json({
            success: true,
            data: {
                monthlyUsed: quotaData.monthlyUsed,
                monthlyLimit: quotaData.monthlyLimit,
                remaining,
                percentUsed: Math.round(percentUsed),
                dailyUploads: quotaData.dailyUploads,
                dailyLimit: quotaData.dailyLimit,
                lastReset: quotaData.lastReset
            }
        });
    }
    catch (error) {
        console.error('Error fetching quota:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch quota information'
        });
    }
});
// Helper functions
async function processImage(buffer, purpose) {
    const processed = [];
    try {
        // Get original dimensions
        const metadata = await (0, sharp_1.default)(buffer).metadata();
        switch (purpose) {
            case 'profile_avatar':
                // Create multiple sizes for avatars
                processed.push({
                    buffer: await (0, sharp_1.default)(buffer).resize(200, 200).jpeg({ quality: 90 }).toBuffer(),
                    suffix: 'large',
                    width: 200,
                    height: 200
                });
                processed.push({
                    buffer: await (0, sharp_1.default)(buffer).resize(100, 100).jpeg({ quality: 85 }).toBuffer(),
                    suffix: 'medium',
                    width: 100,
                    height: 100
                });
                processed.push({
                    buffer: await (0, sharp_1.default)(buffer).resize(50, 50).jpeg({ quality: 80 }).toBuffer(),
                    suffix: 'small',
                    width: 50,
                    height: 50
                });
                break;
            case 'post_image':
                // Optimize for posts with responsive sizes
                if (metadata.width && metadata.width > 1200) {
                    processed.push({
                        buffer: await (0, sharp_1.default)(buffer).resize(1200, null, { withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(),
                        suffix: 'large',
                        width: 1200
                    });
                }
                if (metadata.width && metadata.width > 800) {
                    processed.push({
                        buffer: await (0, sharp_1.default)(buffer).resize(800, null, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(),
                        suffix: 'medium',
                        width: 800
                    });
                }
                processed.push({
                    buffer: await (0, sharp_1.default)(buffer).resize(400, null, { withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer(),
                    suffix: 'small',
                    width: 400
                });
                break;
            default:
                // Keep original but optimize
                processed.push({
                    buffer: await (0, sharp_1.default)(buffer).jpeg({ quality: 85 }).toBuffer(),
                    width: metadata.width,
                    height: metadata.height
                });
                break;
        }
        // Always include original if not already processed
        if (processed.length === 0) {
            processed.push({ buffer, width: metadata.width, height: metadata.height });
        }
    }
    catch (error) {
        console.error('Error processing image:', error);
        // Fallback to original buffer
        processed.push({ buffer });
    }
    return processed;
}
async function checkUploadQuota(userId, type, size) {
    try {
        const quotaDoc = await db.collection('uploadQuotas').doc(userId).get();
        const quotaData = quotaDoc.exists ? quotaDoc.data() : {
            monthlyUsed: 0,
            monthlyLimit: 100 * 1024 * 1024, // 100MB
            dailyUploads: 0,
            dailyLimit: 50
        };
        // Check monthly size limit
        const newMonthlyUsed = quotaData.monthlyUsed + (size || 0);
        if (newMonthlyUsed > quotaData.monthlyLimit) {
            return {
                allowed: false,
                message: `Monthly upload limit exceeded. Used: ${Math.round(newMonthlyUsed / 1024 / 1024)}MB, Limit: ${Math.round(quotaData.monthlyLimit / 1024 / 1024)}MB`
            };
        }
        // Check daily upload count
        if (quotaData.dailyUploads >= quotaData.dailyLimit) {
            return {
                allowed: false,
                message: `Daily upload limit exceeded. Uploads today: ${quotaData.dailyUploads}, Limit: ${quotaData.dailyLimit}`
            };
        }
        return { allowed: true };
    }
    catch (error) {
        console.error('Error checking quota:', error);
        return { allowed: true }; // Allow on error to not block users
    }
}
async function updateUploadQuota(userId, type, size) {
    try {
        const quotaRef = db.collection('uploadQuotas').doc(userId);
        await quotaRef.set({
            userId,
            monthlyUsed: firestore_1.FieldValue.increment(size),
            dailyUploads: firestore_1.FieldValue.increment(1),
            lastUpload: new Date()
        }, { merge: true });
    }
    catch (error) {
        console.error('Error updating quota:', error);
    }
}
//# sourceMappingURL=uploads.js.map