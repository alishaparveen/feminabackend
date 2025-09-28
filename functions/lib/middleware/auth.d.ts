/**
 * Authentication Middleware for Femina Platform
 */
import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        uid: string;
        email?: string;
        role?: string;
        verified?: boolean;
    };
}
/**
 * Middleware to verify Firebase ID token
 */
export declare const authMiddleware: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>>>;
/**
 * Middleware to check if user has admin role
 */
export declare const adminOnly: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
/**
 * Middleware to check if user has expert role or higher
 */
export declare const expertOnly: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
/**
 * Middleware to check if user has moderator role or higher
 */
export declare const moderatorOnly: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>>;
//# sourceMappingURL=auth.d.ts.map