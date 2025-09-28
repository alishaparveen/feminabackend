/**
 * Request Validation Middleware using Zod
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export const validateRequest = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body against schema
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }));

        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid request data',
          details: errors
        });
      }

      // Handle other validation errors
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request format'
      });
    }
  };
};