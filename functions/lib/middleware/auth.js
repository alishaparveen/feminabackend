"use strict";
/**
 * Authentication Middleware for Femina Platform
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderatorOnly = exports.expertOnly = exports.adminOnly = exports.authMiddleware = void 0;
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
/**
 * Middleware to verify Firebase ID token
 */
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'No valid authorization token provided'
            });
        }
        const idToken = authHeader.split('Bearer ')[1];
        // Verify the ID token
        const decodedToken = await (0, auth_1.getAuth)().verifyIdToken(idToken);
        // Get additional user data from Firestore
        const db = (0, firestore_1.getFirestore)();
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        const userData = userDoc.data();
        // Attach user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            role: userData?.role || 'user',
            verified: userData?.verified || false
        };
        next();
    }
    catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired token'
        });
    }
};
exports.authMiddleware = authMiddleware;
/**
 * Middleware to check if user has admin role
 */
const adminOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access required'
        });
    }
    next();
};
exports.adminOnly = adminOnly;
/**
 * Middleware to check if user has expert role or higher
 */
const expertOnly = (req, res, next) => {
    if (!req.user || !['expert', 'admin'].includes(req.user.role || '')) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Expert access required'
        });
    }
    next();
};
exports.expertOnly = expertOnly;
/**
 * Middleware to check if user has moderator role or higher
 */
const moderatorOnly = (req, res, next) => {
    if (!req.user || !['moderator', 'admin'].includes(req.user.role || '')) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Moderator access required'
        });
    }
    next();
};
exports.moderatorOnly = moderatorOnly;
//# sourceMappingURL=auth.js.map