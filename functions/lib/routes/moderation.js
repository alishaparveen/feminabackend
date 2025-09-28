"use strict";
/**
 * Content Moderation Routes for Femina Platform
 * Handles content reporting, review, and automated moderation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderationRoutes = void 0;
const express_1 = require("express");
const firestore_1 = require("firebase-admin/firestore");
const generative_ai_1 = require("@google/generative-ai");
const zod_1 = require("zod");
const validation_1 = require("../middleware/validation");
const router = (0, express_1.Router)();
exports.moderationRoutes = router;
const db = (0, firestore_1.getFirestore)();
// Initialize Gemini AI for content moderation
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
// Validation schemas
const reportSchema = zod_1.z.object({
    contentId: zod_1.z.string(),
    contentType: zod_1.z.enum(['post', 'comment', 'message', 'profile', 'product']),
    reason: zod_1.z.enum(['spam', 'harassment', 'inappropriate', 'misinformation', 'hate_speech', 'violence', 'other']),
    description: zod_1.z.string().min(10).max(500).optional(),
    evidence: zod_1.z.array(zod_1.z.string()).optional() // URLs to screenshots or evidence
});
const reviewSchema = zod_1.z.object({
    action: zod_1.z.enum(['approve', 'remove', 'warn', 'suspend_user', 'escalate']),
    reason: zod_1.z.string().min(5).max(200),
    duration: zod_1.z.number().optional(), // For suspensions in days
    publicNote: zod_1.z.string().optional()
});
const moderationSettingsSchema = zod_1.z.object({
    autoModeration: zod_1.z.boolean(),
    strictnessLevel: zod_1.z.enum(['low', 'medium', 'high']),
    requireApproval: zod_1.z.boolean(),
    bannedWords: zod_1.z.array(zod_1.z.string()),
    trustedUsers: zod_1.z.array(zod_1.z.string())
});
/**
 * POST /api/moderation/report
 * Report content for moderation review
 */
router.post('/report', (0, validation_1.validateRequest)(reportSchema), async (req, res) => {
    try {
        const { contentId, contentType, reason, description, evidence } = req.body;
        const reporterId = req.user.uid;
        // Check if user has already reported this content
        const existingReportQuery = await db.collection('moderationQueue')
            .where('contentId', '==', contentId)
            .where('reporterId', '==', reporterId)
            .where('status', 'in', ['pending', 'under_review'])
            .get();
        if (!existingReportQuery.empty) {
            return res.status(400).json({
                error: 'Already Reported',
                message: 'You have already reported this content'
            });
        }
        // Get the reported content
        let contentData = null;
        let contentAuthorId = null;
        try {
            let contentDoc;
            switch (contentType) {
                case 'post':
                    contentDoc = await db.collection('posts').doc(contentId).get();
                    break;
                case 'comment':
                    contentDoc = await db.collection('comments').doc(contentId).get();
                    break;
                case 'profile':
                    contentDoc = await db.collection('users').doc(contentId).get();
                    break;
                case 'product':
                    contentDoc = await db.collection('products').doc(contentId).get();
                    break;
                default:
                    throw new Error('Unsupported content type');
            }
            if (contentDoc?.exists) {
                contentData = contentDoc.data();
                contentAuthorId = contentData.authorId || contentData.userId || contentId;
            }
        }
        catch (error) {
            console.error('Error fetching content:', error);
        }
        // Run automated content analysis if content exists
        let automatedAnalysis = null;
        if (contentData) {
            try {
                automatedAnalysis = await analyzeContentAutomatically(contentData, contentType);
            }
            catch (error) {
                console.error('Automated analysis failed:', error);
            }
        }
        // Create moderation report
        const reportId = db.collection('moderationQueue').doc().id;
        const reportData = {
            id: reportId,
            contentId,
            contentType,
            contentAuthorId,
            reporterId,
            reason,
            description: description || null,
            evidence: evidence || [],
            contentSnapshot: contentData,
            automatedAnalysis,
            status: 'pending',
            priority: calculatePriority(reason, automatedAnalysis),
            createdAt: new Date(),
            updatedAt: new Date(),
            reviewedBy: null,
            reviewedAt: null,
            action: null,
            reviewNotes: null
        };
        await db.collection('moderationQueue').doc(reportId).set(reportData);
        // Update content with moderation flag if high severity
        if (reportData.priority === 'high' || automatedAnalysis?.riskLevel === 'high') {
            await flagContentForReview(contentId, contentType, reportId);
        }
        // Notify administrators if critical
        if (reportData.priority === 'critical') {
            await notifyAdministrators(reportData);
        }
        res.json({
            success: true,
            data: {
                reportId,
                status: 'submitted',
                estimatedReviewTime: getEstimatedReviewTime(reportData.priority)
            }
        });
    }
    catch (error) {
        console.error('Error creating moderation report:', error);
        res.status(500).json({
            error: 'Moderation Error',
            message: 'Failed to submit report'
        });
    }
});
/**
 * GET /api/moderation/queue
 * Get pending moderation reports (admin only)
 */
router.get('/queue', async (req, res) => {
    try {
        const { status = 'pending', priority, contentType, page = 1, limit = 20 } = req.query;
        let query = db.collection('moderationQueue').orderBy('createdAt', 'desc');
        // Apply filters
        if (status !== 'all') {
            query = query.where('status', '==', status);
        }
        if (priority) {
            query = query.where('priority', '==', priority);
        }
        if (contentType) {
            query = query.where('contentType', '==', contentType);
        }
        // Pagination
        const offset = (Number(page) - 1) * Number(limit);
        query = query.offset(offset).limit(Number(limit));
        const querySnapshot = await query.get();
        const reports = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            contentSnapshot: undefined // Don't send full content in list view
        }));
        // Get total count for pagination
        const totalCountSnapshot = await db.collection('moderationQueue')
            .where('status', '==', status === 'all' ? 'pending' : status)
            .get();
        res.json({
            success: true,
            data: {
                reports,
                pagination: {
                    currentPage: Number(page),
                    totalPages: Math.ceil(totalCountSnapshot.size / Number(limit)),
                    totalCount: totalCountSnapshot.size,
                    hasMore: querySnapshot.size === Number(limit)
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching moderation queue:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch moderation queue'
        });
    }
});
/**
 * GET /api/moderation/report/:reportId
 * Get detailed report information (admin only)
 */
router.get('/report/:reportId', async (req, res) => {
    try {
        const { reportId } = req.params;
        const reportDoc = await db.collection('moderationQueue').doc(reportId).get();
        if (!reportDoc.exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Moderation report not found'
            });
        }
        const reportData = reportDoc.data();
        // Get reporter information
        const reporterDoc = await db.collection('users').doc(reportData.reporterId).get();
        const reporterInfo = reporterDoc.exists ? {
            displayName: reporterDoc.data()?.displayName,
            photoURL: reporterDoc.data()?.photoURL
        } : null;
        // Get content author information
        let authorInfo = null;
        if (reportData.contentAuthorId) {
            const authorDoc = await db.collection('users').doc(reportData.contentAuthorId).get();
            authorInfo = authorDoc.exists ? {
                displayName: authorDoc.data()?.displayName,
                photoURL: authorDoc.data()?.photoURL,
                role: authorDoc.data()?.role
            } : null;
        }
        res.json({
            success: true,
            data: {
                ...reportData,
                reporterInfo,
                authorInfo
            }
        });
    }
    catch (error) {
        console.error('Error fetching report details:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch report details'
        });
    }
});
/**
 * PUT /api/moderation/review/:reportId
 * Review and take action on a moderation report (admin only)
 */
router.put('/review/:reportId', (0, validation_1.validateRequest)(reviewSchema), async (req, res) => {
    try {
        const { reportId } = req.params;
        const { action, reason, duration, publicNote } = req.body;
        const reviewerId = req.user.uid;
        const reportDoc = await db.collection('moderationQueue').doc(reportId).get();
        if (!reportDoc.exists) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Moderation report not found'
            });
        }
        const reportData = reportDoc.data();
        // Execute the moderation action
        const actionResult = await executeModerationAction(reportData.contentId, reportData.contentType, reportData.contentAuthorId, action, duration, reason);
        // Update the report with review information
        await db.collection('moderationQueue').doc(reportId).update({
            status: action === 'escalate' ? 'escalated' : 'reviewed',
            reviewedBy: reviewerId,
            reviewedAt: new Date(),
            action,
            reviewReason: reason,
            duration: duration || null,
            publicNote: publicNote || null,
            actionResult,
            updatedAt: new Date()
        });
        // Send notification to content author if action was taken
        if (action !== 'approve' && reportData.contentAuthorId) {
            await sendModerationNotification(reportData.contentAuthorId, action, reason, publicNote);
        }
        res.json({
            success: true,
            data: {
                reportId,
                action,
                actionResult,
                reviewedAt: new Date()
            }
        });
    }
    catch (error) {
        console.error('Error reviewing moderation report:', error);
        res.status(500).json({
            error: 'Moderation Error',
            message: 'Failed to process moderation review'
        });
    }
});
/**
 * GET /api/moderation/statistics
 * Get moderation statistics and metrics (admin only)
 */
router.get('/statistics', async (req, res) => {
    try {
        const { timeframe = '7d' } = req.query;
        const timeframeDays = timeframe === '24h' ? 1 :
            timeframe === '7d' ? 7 :
                timeframe === '30d' ? 30 : 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - timeframeDays);
        // Get report statistics
        const reportsQuery = db.collection('moderationQueue')
            .where('createdAt', '>=', startDate);
        const reportsSnapshot = await reportsQuery.get();
        const reports = reportsSnapshot.docs.map(doc => doc.data());
        const stats = {
            totalReports: reports.length,
            pendingReports: reports.filter(r => r.status === 'pending').length,
            reviewedReports: reports.filter(r => r.status === 'reviewed').length,
            escalatedReports: reports.filter(r => r.status === 'escalated').length,
            reportsByReason: {},
            reportsByContentType: {},
            reportsByPriority: {},
            averageReviewTime: 0,
            actionsSummary: {
                approved: 0,
                removed: 0,
                warned: 0,
                suspended: 0
            }
        };
        // Calculate statistics
        reports.forEach(report => {
            // By reason
            stats.reportsByReason[report.reason] = (stats.reportsByReason[report.reason] || 0) + 1;
            // By content type
            stats.reportsByContentType[report.contentType] = (stats.reportsByContentType[report.contentType] || 0) + 1;
            // By priority
            stats.reportsByPriority[report.priority] = (stats.reportsByPriority[report.priority] || 0) + 1;
            // Actions summary
            if (report.action) {
                stats.actionsSummary[report.action] = (stats.actionsSummary[report.action] || 0) + 1;
            }
        });
        // Calculate average review time
        const reviewedReports = reports.filter(r => r.reviewedAt && r.createdAt);
        if (reviewedReports.length > 0) {
            const totalReviewTime = reviewedReports.reduce((sum, report) => {
                return sum + (report.reviewedAt.toDate().getTime() - report.createdAt.toDate().getTime());
            }, 0);
            stats.averageReviewTime = Math.round(totalReviewTime / reviewedReports.length / (1000 * 60 * 60)); // in hours
        }
        res.json({
            success: true,
            data: stats
        });
    }
    catch (error) {
        console.error('Error fetching moderation statistics:', error);
        res.status(500).json({
            error: 'Database Error',
            message: 'Failed to fetch moderation statistics'
        });
    }
});
// Helper functions
async function analyzeContentAutomatically(content, contentType) {
    try {
        const textToAnalyze = extractTextFromContent(content, contentType);
        const moderationPrompt = `
      Analyze this content for potential policy violations. Consider:
      - Hate speech, harassment, or discrimination
      - Spam or promotional content
      - Misinformation or harmful advice
      - Inappropriate sexual content
      - Violence or threats
      - Community guideline violations for a women's platform
      
      Content: "${textToAnalyze}"
      
      Respond with JSON: {
        "riskLevel": "low|medium|high",
        "violationType": "none|spam|harassment|inappropriate|misinformation|hate_speech|violence",
        "confidence": 0.0-1.0,
        "explanation": "brief explanation"
      }
    `;
        const result = await model.generateContent(moderationPrompt);
        const response = result.response.text();
        try {
            return JSON.parse(response);
        }
        catch {
            return {
                riskLevel: 'low',
                violationType: 'none',
                confidence: 0.5,
                explanation: 'Analysis completed'
            };
        }
    }
    catch (error) {
        console.error('Automated analysis error:', error);
        return null;
    }
}
function extractTextFromContent(content, contentType) {
    switch (contentType) {
        case 'post':
            return content.content || content.text || '';
        case 'comment':
            return content.text || content.content || '';
        case 'profile':
            return `${content.displayName || ''} ${content.bio || ''}`;
        case 'product':
            return `${content.title || ''} ${content.description || ''}`;
        default:
            return JSON.stringify(content);
    }
}
function calculatePriority(reason, automatedAnalysis) {
    // High priority reasons
    if (['hate_speech', 'violence', 'harassment'].includes(reason)) {
        return 'critical';
    }
    // Check automated analysis
    if (automatedAnalysis?.riskLevel === 'high') {
        return 'high';
    }
    if (['misinformation', 'inappropriate'].includes(reason)) {
        return 'high';
    }
    if (['spam'].includes(reason)) {
        return 'medium';
    }
    return 'low';
}
async function executeModerationAction(contentId, contentType, authorId, action, duration, reason) {
    const batch = db.batch();
    try {
        switch (action) {
            case 'remove':
                // Remove or hide the content
                const contentRef = db.collection(getCollectionName(contentType)).doc(contentId);
                batch.update(contentRef, {
                    moderationStatus: 'removed',
                    removedAt: new Date(),
                    removalReason: reason
                });
                break;
            case 'warn':
                // Add warning to user profile
                const warningRef = db.collection('warnings').doc();
                batch.set(warningRef, {
                    userId: authorId,
                    reason,
                    contentId,
                    contentType,
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
                });
                break;
            case 'suspend_user':
                // Suspend user account
                const suspensionEnd = new Date();
                suspensionEnd.setDate(suspensionEnd.getDate() + (duration || 7));
                const userRef = db.collection('users').doc(authorId);
                batch.update(userRef, {
                    suspended: true,
                    suspendedUntil: suspensionEnd,
                    suspensionReason: reason
                });
                break;
        }
        await batch.commit();
        return { success: true, action, executedAt: new Date() };
    }
    catch (error) {
        console.error('Error executing moderation action:', error);
        return { success: false, error: error.message };
    }
}
function getCollectionName(contentType) {
    const mapping = {
        post: 'posts',
        comment: 'comments',
        profile: 'users',
        product: 'products'
    };
    return mapping[contentType] || contentType;
}
async function flagContentForReview(contentId, contentType, reportId) {
    try {
        const contentRef = db.collection(getCollectionName(contentType)).doc(contentId);
        await contentRef.update({
            flaggedForReview: true,
            flaggedAt: new Date(),
            flaggedReportId: reportId,
            visibility: 'hidden' // Hide until reviewed
        });
    }
    catch (error) {
        console.error('Error flagging content:', error);
    }
}
async function notifyAdministrators(reportData) {
    // Implementation for admin notifications (email, Slack, etc.)
    console.log('Critical moderation report created:', reportData.id);
    // This would typically send notifications via email or messaging service
    // For now, we'll just log it and potentially store in notifications collection
    try {
        await db.collection('adminNotifications').add({
            type: 'critical_moderation',
            reportId: reportData.id,
            message: `Critical moderation report for ${reportData.contentType}: ${reportData.reason}`,
            createdAt: new Date(),
            read: false
        });
    }
    catch (error) {
        console.error('Error creating admin notification:', error);
    }
}
async function sendModerationNotification(userId, action, reason, publicNote) {
    try {
        await db.collection('notifications').add({
            userId,
            type: 'moderation_action',
            title: 'Content Moderation Action',
            message: `Action taken: ${action}. Reason: ${reason}`,
            publicNote: publicNote || null,
            createdAt: new Date(),
            read: false
        });
    }
    catch (error) {
        console.error('Error sending moderation notification:', error);
    }
}
function getEstimatedReviewTime(priority) {
    const estimates = {
        critical: '1-2 hours',
        high: '4-8 hours',
        medium: '1-2 days',
        low: '3-5 days'
    };
    return estimates[priority] || '3-5 days';
}
//# sourceMappingURL=moderation.js.map