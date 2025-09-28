/**
 * Rate Limiting Middleware for API Protection
 */
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';

const inEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

const keyGenerator = (req: any) => {
  // Prefer X-Forwarded-For (first IP), then req.ip, then socket remote address
  const xf = (req.headers['x-forwarded-for'] as string) || '';
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
export const rateLimiter = rateLimit({
  ...baseLimiterOptions,
  max: 100,
  message: {
    error: 'Too Many Requests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
});

// Strict rate limiting for auth endpoints
export const authRateLimit = rateLimit({
  ...baseLimiterOptions,
  max: 20,
  message: {
    error: 'Too Many Auth Requests',
    message: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes',
  },
});

// Rate limiting for AI chat
export const aiRateLimit = rateLimit({
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
export const uploadRateLimit = rateLimit({
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
export const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50,          // allow 50 requests without delay
  delayMs: () => 500,      // express-slow-down v2 expects a function
  maxDelayMs: 5000,
  // Optional: disable validation warning message
  // validate: { delayMs: false },
});
