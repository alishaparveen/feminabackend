"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.speedLimiter = exports.uploadRateLimit = exports.aiRateLimit = exports.authRateLimit = exports.rateLimiter = void 0;
/**
 * Rate Limiting Middleware for API Protection
 */
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_slow_down_1 = __importDefault(require("express-slow-down"));
const inEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const keyGenerator = (req) => {
    // Prefer X-Forwarded-For (first IP), then req.ip, then socket remote address
    const xf = req.headers['x-forwarded-for'] || '';
    const forwarded = Array.isArray(xf) ? xf[0] : xf.split(',')[0]?.trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'local';
};
const baseLimiterOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skip: () => inEmulator, // don't rate limit in emulator (optional)
};
// General API rate limiting
exports.rateLimiter = (0, express_rate_limit_1.default)({
    ...baseLimiterOptions,
    max: 100,
    message: {
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes',
    },
});
// Strict rate limiting for auth endpoints
exports.authRateLimit = (0, express_rate_limit_1.default)({
    ...baseLimiterOptions,
    max: 20,
    message: {
        error: 'Too Many Auth Requests',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: '15 minutes',
    },
});
// Rate limiting for AI chat
exports.aiRateLimit = (0, express_rate_limit_1.default)({
    ...baseLimiterOptions,
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: {
        error: 'AI Rate Limit Exceeded',
        message: 'Too many AI requests, please wait before sending another message.',
        retryAfter: '1 minute',
    },
});
// Rate limiting for uploads
exports.uploadRateLimit = (0, express_rate_limit_1.default)({
    ...baseLimiterOptions,
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: {
        error: 'Upload Rate Limit Exceeded',
        message: 'Too many file uploads, please wait before uploading again.',
        retryAfter: '1 minute',
    },
});
// Slow down middleware for high-load endpoints
exports.speedLimiter = (0, express_slow_down_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 50, // allow 50 requests without delay
    delayMs: () => 500, // express-slow-down v2 expects a function
    maxDelayMs: 5000,
    // Optional: disable validation warning message
    // validate: { delayMs: false },
});
//# sourceMappingURL=rateLimit.js.map