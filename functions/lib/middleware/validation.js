"use strict";
/**
 * Request Validation Middleware using Zod
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequest = void 0;
const zod_1 = require("zod");
const validateRequest = (schema) => {
    return (req, res, next) => {
        try {
            // Validate request body against schema
            schema.parse(req.body);
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError) {
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
exports.validateRequest = validateRequest;
//# sourceMappingURL=validation.js.map