/**
 * Authentication and User Types
 */
import { Request } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        uid: string;
        email?: string;
        role?: 'user' | 'expert' | 'moderator' | 'admin';
        verified?: boolean;
    };
}
export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    role: 'user' | 'expert' | 'moderator' | 'admin';
    specialties?: string[];
    bio?: string;
    interests?: string[];
    verified: boolean;
    isPremium?: boolean;
    createdAt: Date;
    lastActive: Date;
    settings?: {
        notifications?: {
            email: boolean;
            push: boolean;
            marketing: boolean;
        };
        privacy?: {
            profileVisibility: 'public' | 'private';
            showOnlineStatus: boolean;
        };
    };
}
export interface AuthTokenClaims {
    uid: string;
    email?: string;
    role?: string;
    verified?: boolean;
    iat: number;
    exp: number;
}
//# sourceMappingURL=auth.d.ts.map