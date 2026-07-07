/**
 * Base Application Error class that all custom app errors extend.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (HTTP 400 Bad Request)
 */
export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, details);
  }
}

/**
 * Upload validation error (HTTP 400 Bad Request)
 * Keeps compatibility with existing UploadValidationError in storage.js
 */
export class UploadValidationError extends ValidationError {}

/**
 * Authentication error (HTTP 401 Unauthorized)
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

/**
 * Authorization error (HTTP 403 Forbidden)
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

/**
 * Resource not found (HTTP 404 Not Found)
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * State conflict error (HTTP 409 Conflict)
 */
export class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, details);
  }
}

/**
 * Storage quota exceeded (HTTP 413 Payload Too Large / Storage Limit Exceeded)
 */
export class StorageQuotaError extends AppError {
  constructor(message = 'Storage limit exceeded') {
    super(message, 413);
  }
}

/**
 * Generic internal server error (HTTP 500)
 */
export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
  }
}
