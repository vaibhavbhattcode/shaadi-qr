import express from 'express';

/**
 * Wraps an async function so that any thrown errors are automatically
 * forwarded to next(err) for central error handling.
 */
export function asyncHandler(fn) {
  if (fn?.constructor?.name === 'AsyncFunction') {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }
  return fn;
}

// Automatically monkeypatch Express Route methods so that ANY async handler
// registered in routing files is automatically wrapped in asyncHandler.
// This prevents uncaught promise rejections without requiring manual wrapper code.
if (express && express.Route && express.Route.prototype) {
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'all'];
  for (const method of methods) {
    const original = express.Route.prototype[method];
    if (original) {
      express.Route.prototype[method] = function (...callbacks) {
        const wrapped = callbacks.map(cb => {
          if (typeof cb === 'function') {
            // Handle error middleware (4 parameters) separately
            if (cb.length === 4) {
              return (err, req, res, next) => Promise.resolve(cb(err, req, res, next)).catch(next);
            }
            // If it's an async function, wrap it
            if (cb.constructor?.name === 'AsyncFunction') {
              return (req, res, next) => Promise.resolve(cb(req, res, next)).catch(next);
            }
          }
          return cb;
        });
        return original.apply(this, wrapped);
      };
    }
  }
}
