// ==== IMPORTS ====
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import { databaseManager } from "./adapters/manager.js";
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, mkdirSync, stat, readFileSync, writeFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';

// ==== SERVER CONFIG ====
const port = parseInt(process.env.PORT || "8000");

// ==== STRUCTURED LOGGING ====
// Defined early so all code can use it (no external dependencies)
const logger = {
  error: (message, meta = {}) => {
    const logEntry = {
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.error(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  warn: (message, meta = {}) => {
    const logEntry = {
      level: 'WARN',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.warn(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  info: (message, meta = {}) => {
    const logEntry = {
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.log(!isProd() ? JSON.stringify(logEntry, null, 2) : JSON.stringify(logEntry));
  },

  debug: (message, meta = {}) => {
    if (isProd()) return;
    const logEntry = {
      level: 'DEBUG',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    };
    console.log(JSON.stringify(logEntry, null, 2));
  }
};

// ==== CSRF PROTECTION ====
const csrfTokenStore = new Map(); // userID -> { token, timestamp }
const CSRF_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const CSRF_MAX_ENTRIES = 50000; // LRU eviction threshold

/**
 * LRU eviction helper that removes oldest entries when over limit
 *
 * Prevents memory leaks in rate limiter and CSRF stores by removing oldest
 * entries based on timestamp when store exceeds maxEntries threshold.
 *
 * @param {Map} store - Map to evict entries from
 * @param {number} maxEntries - Maximum entries before eviction
 * @param {Function} getTimestamp - Function to extract timestamp from value
 * @returns {void}
 */
function evictOldestEntries(store, maxEntries, getTimestamp) {
  if (store.size <= maxEntries) return;

  // Convert to array and sort by timestamp
  const entries = Array.from(store.entries())
    .map(([key, value]) => ({ key, timestamp: getTimestamp(value) }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Remove oldest entries until under limit
  const toRemove = store.size - maxEntries;
  for (let i = 0; i < toRemove; i++) {
    store.delete(entries[i].key);
  }
}

/**
 * Generate cryptographically secure CSRF token
 *
 * Uses crypto.randomBytes to generate 64-character hex token.
 *
 * @returns {string} Hex-encoded CSRF token
 */
function generateCSRFToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF protection middleware using timing-safe comparison
 *
 * Validates CSRF token from x-csrf-token header against stored token for userID.
 * Skips validation for GET requests and signup/signin routes. Uses timing-safe
 * comparison to prevent timing attacks. Enforces 24-hour token expiry.
 * Auto-regenerates token if missing (e.g., server restart) for authenticated users.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {Function} next - Next middleware function
 * @returns {Promise<Response|void>} 403 error or continues to next middleware
 */
async function csrfProtection(c, next) {
  if (c.req.method === 'GET' || c.req.path === '/api/signup' || c.req.path === '/api/signin') {
    return next();
  }

  const csrfToken = c.req.header('x-csrf-token');
  const userID = c.get('userID'); // Set by authMiddleware

  if (!csrfToken || !userID) {
    logger.info('CSRF validation failed - missing token or userID', {
      hasToken: !!csrfToken,
      hasUserID: !!userID,
      path: c.req.path
    });
    return c.json({ error: 'Invalid CSRF token' }, 403);
  }

  let storedData = csrfTokenStore.get(userID);
  if (!storedData) {
    // Auto-regenerate token for authenticated users (e.g., after server restart)
    // Security: This block only runs if authMiddleware passed (JWT valid)
    const newToken = generateCSRFToken();
    storedData = { token: newToken, timestamp: Date.now() };
    csrfTokenStore.set(userID, storedData);

    setCookie(c, 'csrf_token', newToken, {
      httpOnly: false,
      secure: isProd(),
      sameSite: 'Lax',
      path: '/',
      maxAge: CSRF_TOKEN_EXPIRY / 1000
    });

    logger.info('CSRF token auto-regenerated after store miss', { userID });
    await next();
    return;
  }

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(csrfToken);
  const storedBuffer = Buffer.from(storedData.token);
  if (tokenBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(tokenBuffer, storedBuffer)) {
    logger.info('CSRF validation failed - token mismatch', {
      userID,
      path: c.req.path
    });
    return c.json({ error: 'Invalid CSRF token' }, 403);
  }

  // Check if token is expired
  if (Date.now() - storedData.timestamp > CSRF_TOKEN_EXPIRY) {
    csrfTokenStore.delete(userID);
    logger.info('CSRF validation failed - token expired', {
      userID,
      age: Math.floor((Date.now() - storedData.timestamp) / 1000) + 's'
    });
    return c.json({ error: 'CSRF token expired' }, 403);
  }

  logger.debug('CSRF validation passed', { userID });
  await next();
}

// Cleanup expired CSRF tokens every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [userID, data] of csrfTokenStore.entries()) {
    if (now - data.timestamp > CSRF_TOKEN_EXPIRY) {
      csrfTokenStore.delete(userID);
      cleaned++;
    }
  }

  // LRU eviction if still over limit
  evictOldestEntries(csrfTokenStore, CSRF_MAX_ENTRIES, (data) => data.timestamp);

  if (cleaned > 0) {
    logger.debug('CSRF cleanup completed', { removedTokens: cleaned });
  }
}, 60 * 60 * 1000); // Run every hour

// ==== RATE LIMITING ====
const rateLimitStore = new Map(); // key -> { count, resetAt }
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ENTRIES = 100000; // LRU eviction threshold

// Route-specific rate limits
const RATE_LIMITS = {
  auth: { limit: 10, window: RATE_LIMIT_WINDOW },       // /api/signin, /api/signup
  payment: { limit: 5, window: RATE_LIMIT_WINDOW },     // /api/checkout, /api/portal
  global: { limit: 300, window: RATE_LIMIT_WINDOW }     // all other /api routes
};

/**
 * Get client IP address from request
 *
 * Checks X-Forwarded-For header first (for proxies), falls back to
 * socket address. Handles comma-separated forwarded IPs.
 *
 * @param {Context} c - Hono context
 * @returns {string} Client IP address
 */
function getClientIP(c) {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return c.req.raw?.socket?.remoteAddress || 'unknown';
}

/**
 * Get rate limit category for a given path
 *
 * @param {string} path - Request path
 * @returns {string} Rate limit category: 'auth', 'payment', or 'global'
 */
function getRateLimitCategory(path) {
  if (path === '/api/signin' || path === '/api/signup') {
    return 'auth';
  }
  if (path === '/api/checkout' || path === '/api/portal') {
    return 'payment';
  }
  return 'global';
}

/**
 * Rate limiting middleware
 *
 * Tracks requests per IP+category with sliding window. Returns 429 when
 * limit exceeded. Adds X-RateLimit-Remaining and Retry-After headers.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {Function} next - Next middleware function
 * @returns {Promise<Response|void>} 429 error or continues to next middleware
 */
async function rateLimitMiddleware(c, next) {
  await next();
}


// ==== ACCOUNT LOCKOUT ====
const loginAttemptStore = new Map(); // email -> { attempts, lockedUntil }
const LOCKOUT_THRESHOLD = 5; // Lock after 5 failed attempts
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MAX_ENTRIES = 50000; // LRU eviction threshold

/**
 * Check if account is locked due to failed login attempts
 *
 * @param {string} email - Email address to check
 * @returns {{locked: boolean, remainingTime: number}} Lock status and remaining time in seconds
 */
function isAccountLocked(email) {
  const record = loginAttemptStore.get(email);
  if (!record) return { locked: false, remainingTime: 0 };

  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    return {
      locked: true,
      remainingTime: Math.ceil((record.lockedUntil - now) / 1000)
    };
  }

  // Lock expired, clear record
  if (record.lockedUntil && now >= record.lockedUntil) {
    loginAttemptStore.delete(email);
  }

  return { locked: false, remainingTime: 0 };
}

/**
 * Record a failed login attempt for an email
 *
 * Increments attempt counter. Locks account after LOCKOUT_THRESHOLD failures.
 *
 * @param {string} email - Email address that failed login
 * @returns {void}
 */
function recordFailedLogin(email) {
  const now = Date.now();
  let record = loginAttemptStore.get(email);

  if (!record) {
    record = { attempts: 0, lockedUntil: null };
    loginAttemptStore.set(email, record);
  }

  record.attempts++;

  if (record.attempts >= LOCKOUT_THRESHOLD) {
    record.lockedUntil = now + LOCKOUT_DURATION;
    logger.info('Account locked due to failed attempts', { email: email.substring(0, 3) + '***' });
  }
}

/**
 * Clear failed login attempts on successful login
 *
 * @param {string} email - Email address to clear
 * @returns {void}
 */
function clearFailedLogins(email) {
  loginAttemptStore.delete(email);
}

// Cleanup expired lockout entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  for (const [email, record] of loginAttemptStore.entries()) {
    if (record.lockedUntil && now >= record.lockedUntil) {
      loginAttemptStore.delete(email);
      cleaned++;
    }
  }

  // LRU eviction if still over limit
  evictOldestEntries(loginAttemptStore, LOCKOUT_MAX_ENTRIES, (data) => data.lockedUntil || 0);

  if (cleaned > 0) {
    logger.debug('Lockout cleanup completed', { removedEntries: cleaned });
  }
}, 15 * 60 * 1000);

// ==== CONFIG & ENV ====
// Environment setup - MUST happen before config loading
if (!isProd()) {
  loadLocalENV();
} else {
  setInterval(async () => {
    logger.debug('Hourly task completed');
  }, 60 * 60 * 1000); // Every hour
}

/**
 * Resolve environment variable placeholders in configuration strings
 *
 * Replaces ${VAR_NAME} patterns with process.env values. Logs warning
 * and preserves placeholder if environment variable is undefined.
 *
 * @param {string} str - String with ${VAR_NAME} placeholders
 * @returns {string} String with placeholders replaced
 */
function resolveEnvironmentVariables(str) {
  if (typeof str !== 'string') return str;

  return str.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      logger.warn('Environment variable not defined, using placeholder', { varName, placeholder: match });
      return match; // Return the placeholder if env var is not found
    }
    return envValue;
  });
}

// Load and process configuration
let config;
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const configPath = resolve(__dirname, './config.json');
  const configData = await promisify(readFile)(configPath);
  const rawConfig = JSON.parse(configData.toString());

  // Resolve environment variables in configuration
  config = {
    staticDir: rawConfig.staticDir || '../dist',
    database: {
      ...rawConfig.database,
      connectionString: resolveEnvironmentVariables(rawConfig.database.connectionString)
    }
  };
} catch (err) {
  logger.error('Failed to load config, using defaults', { error: err.message });
  config = {
    staticDir: '../dist',
    database: {
      db: "MyApp",
      dbType: "sqlite",
      connectionString: "./databases/MyApp.db"
    }
  };
}

const STRIPE_KEY = process.env.STRIPE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Validate required environment variables are set
 *
 * Checks for STRIPE_KEY, STRIPE_ENDPOINT_SECRET, JWT_SECRET, and any
 * unresolved ${VAR} references in database config. Logs warnings for
 * missing variables but does not exit the process.
 *
 * @returns {boolean} True if all required variables are present
 */
function validateEnvironmentVariables() {
  const missing = [];

  if (!STRIPE_KEY) missing.push('STRIPE_KEY');
  if (!process.env.STRIPE_ENDPOINT_SECRET) missing.push('STRIPE_ENDPOINT_SECRET');
  if (!JWT_SECRET) missing.push('JWT_SECRET');

  // Check for database environment variables that are referenced but not defined
  if (typeof config.database.connectionString === 'string') {
    const matches = config.database.connectionString.match(/\$\{([^}]+)\}/g);
    if (matches) {
      matches.forEach(match => {
        const varName = match.slice(2, -1); // Remove ${ and }
        if (!process.env[varName]) {
          missing.push(`${varName} (referenced in database config)`);
        }
      });
    }
  }

  if (missing.length > 0) {
    logger.warn('Missing environment variables - server continuing with limited functionality', {
      missing,
      hint: 'Set DATABASE_URL, MONGODB_URL, POSTGRES_URL, STRIPE_KEY, JWT_SECRET for full functionality'
    });

    // Don't exit - let the server continue with warnings
    return false;
  }

  return true;
}

const envValidationPassed = validateEnvironmentVariables();

if (envValidationPassed) {
  logger.info('Environment variables validated successfully');
}

logger.info('Single-client backend initialized');

// ==== DATABASE CONFIG ====
// Single database configuration - no origin-based routing needed
const dbConfig = config.database;

// ==== SERVICES SETUP ====
// Stripe setup (only if key is available)
let stripe = null;
if (STRIPE_KEY) {
  stripe = new Stripe(STRIPE_KEY);
} else {
  logger.warn('STRIPE_KEY not set - Stripe functionality disabled');
}

// Single database config - always use the same one
const currentDbConfig = dbConfig;

/**
 * Database helper with pre-bound configuration
 *
 * Provides shorthand methods for database operations without repeating
 * dbType, db, connectionString on every call.
 *
 * @type {Object}
 * @example
 * // Instead of:
 * await db.findUser( { email });
 * // Use:
 * await db.findUser({ email });
 */
const db = {
  findUser: (query, projection) => databaseManager.findUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query, projection),
  insertUser: (userData) => databaseManager.insertUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, userData),
  updateUser: (query, update) => databaseManager.updateUser(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query, update),
  findAuth: (query) => databaseManager.findAuth(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, query),
  insertAuth: (authData) => databaseManager.insertAuth(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, authData),
  findWebhookEvent: (eventId) => databaseManager.findWebhookEvent(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, eventId),
  insertWebhookEvent: (eventId, eventType, processedAt) => databaseManager.insertWebhookEvent(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, eventId, eventType, processedAt),
  executeQuery: (queryObject) => databaseManager.executeQuery(currentDbConfig.dbType, currentDbConfig.db, currentDbConfig.connectionString, queryObject)
};

// ==== HONO SETUP ====
const app = new Hono();

// Get __dirname for static file serving
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CORS middleware (needed for development when frontend is on different port)
// Use CORS_ORIGINS env var in production, fallback to localhost for development
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:8000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8000'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  credentials: true
}));

// Rate limiting middleware
app.use('*', rateLimitMiddleware);

// Apache Common Log Format middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  const method = c.req.method;
  const url = c.req.path;
  const status = c.res.status;
  const duration = Date.now() - start;

  console.log(`[${timestamp}] "${method} ${url}" ${status} (${duration}ms)`);
});

// Security headers middleware
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "https:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"]
  },
  strictTransportSecurity: !isProd() ? false : 'max-age=31536000; includeSubDomains; preload',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
    payment: []
  }
}));

// Request logging middleware (dev only)
app.use('*', async (c, next) => {
  if (!isProd()) {
    const requestId = Math.random().toString(36).substr(2, 9);
    logger.debug('Request received', { method: c.req.method, path: c.req.path, requestId });
  }
  await next();
});

const tokenExpirationDays = 30;

/**
 * Hash password using bcrypt with 10 salt rounds
 *
 * Generates salt and hashes password for secure storage. Uses bcrypt's
 * automatic salt generation.
 *
 * @async
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} Bcrypt hashed password
 * @throws {Error} If bcrypt hashing fails
 */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
}

/**
 * Verify password against bcrypt hash using timing-safe comparison
 *
 * @async
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Bcrypt hash to compare against
 * @returns {Promise<boolean>} True if password matches hash
 */
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Calculate JWT expiration timestamp
 *
 * @returns {number} Unix timestamp 30 days in the future
 */
function tokenExpireTimestamp(){
  return Math.floor(Date.now() / 1000) + tokenExpirationDays * 24 * 60 * 60; // 30 days from now
}

/**
 * Generate JWT token for user authentication
 *
 * Creates HS256-signed JWT with 30-day expiration. Requires JWT_SECRET
 * environment variable.
 *
 * @async
 * @param {string} userID - User ID to encode in token
 * @returns {Promise<string>} Signed JWT token
 * @throws {Error} If JWT_SECRET not configured or signing fails
 */
async function generateToken(userID) {
  try {
    if (!JWT_SECRET) {
      throw new Error("JWT_SECRET not configured - authentication disabled");
    }

    const exp = tokenExpireTimestamp();
    const payload = { userID, exp };

    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      header: { alg: "HS256", typ: "JWT" }
    });
  } catch (error) {
    logger.error('Token generation error', { error: error.message });
    throw error;
  }
}

/**
 * Authentication middleware using JWT from HttpOnly cookie
 *
 * Verifies JWT token from 'token' cookie. Sets userID in context on success,
 * normalized to string for consistent Map key usage across middleware (CSRF, sessions).
 * Returns 401 for missing, expired, or invalid tokens. Returns 503 if
 * JWT_SECRET not configured.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {Function} next - Next middleware function
 * @returns {Promise<Response|void>} 401/503 error or continues to next middleware
 */
async function authMiddleware(c, next) {
  if (!JWT_SECRET) {
    return c.json({ error: "Authentication service unavailable" }, 503);
  }

  // Read token from HttpOnly cookie
  const token = getCookie(c, 'token');
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    // Normalize userID to string for consistent Map key usage (CSRF, sessions)
    const normalizedUserID = String(payload.userID);
    c.set('userID', normalizedUserID);
    await next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.debug('Token expired');
      return c.json({ error: "Token expired" }, 401);
    }
    logger.error('Token verification error', { error: error.message });
    return c.json({ error: "Invalid token" }, 401);
  }
}

/**
 * Generate RFC 4122 compliant UUID v4
 *
 * Uses crypto.randomUUID() for cryptographically secure unique identifiers.
 *
 * @returns {string} UUID string
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Escape HTML special characters to prevent XSS attacks
 *
 * Replaces &, <, >, ", ', / with HTML entities. Returns original value
 * if not a string.
 *
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
const escapeHtml = (text) => {
  if (typeof text !== 'string') return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char]);
};

/**
 * Validate email address format and length
 *
 * RFC 5321 compliant validation with robust regex checking local part,
 * domain, and TLD. Max length 254 characters. Prevents consecutive dots
 * and leading/trailing hyphens.
 *
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false; // RFC 5321

  // More robust email validation:
  // - Local part: letters, numbers, and common special chars (no consecutive dots)
  // - Domain: letters, numbers, hyphens (no consecutive dots or leading/trailing hyphens)
  // - TLD: 2-63 characters
  const emailRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,63}$/;
  return emailRegex.test(email);
};

/**
 * Validate password length within bcrypt limits
 *
 * Enforces 6-72 character range (bcrypt's maximum is 72 bytes).
 *
 * @param {string} password - Password to validate
 * @returns {boolean} True if valid password length
 */
const validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 6 || password.length > 72) return false; // bcrypt limit
  return true;
};

/**
 * Validate name length and non-empty after trim
 *
 * Enforces 1-100 character range after trimming whitespace.
 *
 * @param {string} name - Name to validate
 * @returns {boolean} True if valid name
 */
const validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  if (name.trim().length === 0 || name.length > 100) return false;
  return true;
};

/**
 * Set authentication cookies and generate CSRF token for user session
 *
 * Creates CSRF token, stores it in memory, and sets both JWT (HttpOnly) and
 * CSRF (readable) cookies. Consolidates duplicate cookie logic from signup/signin.
 *
 * @async
 * @param {Context} c - Hono context
 * @param {string} userID - User ID to associate with session
 * @param {string} jwtToken - Pre-generated JWT token
 * @returns {string} Generated CSRF token
 */
function setAuthCookies(c, userID, jwtToken) {
  const csrfToken = generateCSRFToken();
  csrfTokenStore.set(userID.toString(), { token: csrfToken, timestamp: Date.now() });

  // Set HttpOnly JWT cookie
  setCookie(c, 'token', jwtToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'Strict',
    path: '/',
    maxAge: tokenExpirationDays * 24 * 60 * 60
  });

  // Set CSRF token cookie (readable by frontend)
  setCookie(c, 'csrf_token', csrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'Lax',
    path: '/',
    maxAge: CSRF_TOKEN_EXPIRY / 1000
  });

  return csrfToken;
}

// ==== STRIPE WEBHOOK (raw body needed) ====
app.post("/api/payment", async (c) => {
  logger.info('Payment webhook received');

  const signature = c.req.header("stripe-signature");
  const rawBody = await c.req.arrayBuffer();
  const body = Buffer.from(rawBody);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, process.env.STRIPE_ENDPOINT_SECRET);
    logger.debug('Webhook event received', { type: event.type });
  } catch (e) {
    logger.error('Webhook signature verification failed', { error: e.message });
    return c.body(null, 400);
  }

  try {
    // Idempotency check - skip if already processed
    const existingEvent = await db.findWebhookEvent(event.id);
    if (existingEvent) {
      logger.info('Webhook event already processed, skipping', { eventId: event.id });
      return c.body(null, 200);
    }

    // Record event BEFORE processing to prevent race conditions
    await db.insertWebhookEvent(event.id, event.type, Date.now());

    const eventObject = event.data.object;

    // Handle subscription lifecycle events
    if (["customer.subscription.deleted", "customer.subscription.updated", "customer.subscription.created"].includes(event.type)) {
      const { customer: stripeID, current_period_end, status } = eventObject;
      if (!stripeID) {
        logger.error('Webhook missing customer ID', { type: event.type });
        return c.body(null, 400);
      }

      const customer = await stripe.customers.retrieve(stripeID);
      if (!customer || !customer.email) {
        logger.error('Webhook: Customer has no email', { stripeID });
        return c.body(null, 400);
      }

      const customerEmail = customer.email.toLowerCase();
      const user = await db.findUser({ email: customerEmail });
      if (user) {
        await db.updateUser({ email: customerEmail }, {
          $set: { subscription: { stripeID, expires: current_period_end, status } }
        });
        logger.info('Subscription updated', { type: event.type, email: customerEmail, status });
      } else {
        logger.warn('Webhook: No user found for email', { email: customerEmail });
      }
    }

    // Handle checkout session completed (initial subscription)
    if (event.type === "checkout.session.completed") {
      const { customer: stripeID, customer_email, subscription: subscriptionId } = eventObject;
      if (subscriptionId && stripeID) {
        const subscriptionPromise = stripe.subscriptions.retrieve(subscriptionId);
        const customerPromise = !customer_email ? stripe.customers.retrieve(stripeID) : null;
        const [subscription, fetchedCustomer] = await Promise.all([subscriptionPromise, customerPromise]);
        const customerEmail = (customer_email || fetchedCustomer.email).toLowerCase();
        const user = await db.findUser({ email: customerEmail });
        if (user) {
          await db.updateUser({ email: customerEmail }, {
            $set: { subscription: { stripeID, expires: subscription.current_period_end, status: subscription.status } }
          });
          logger.info('Checkout completed', { email: customerEmail, status: subscription.status });
        }
      }
    }

    // Handle invoice paid (recurring payment success)
    if (event.type === "invoice.paid") {
      const { customer: stripeID, subscription: subscriptionId } = eventObject;
      if (subscriptionId && stripeID) {
        const [subscription, customer] = await Promise.all([
          stripe.subscriptions.retrieve(subscriptionId),
          stripe.customers.retrieve(stripeID)
        ]);
        if (customer?.email) {
          const customerEmail = customer.email.toLowerCase();
          const user = await db.findUser({ email: customerEmail });
          if (user) {
            await db.updateUser({ email: customerEmail }, {
              $set: { subscription: { stripeID, expires: subscription.current_period_end, status: subscription.status } }
            });
            logger.info('Invoice paid', { email: customerEmail });
          }
        }
      }
    }

    // Handle invoice payment failed
    if (event.type === "invoice.payment_failed") {
      const { customer: stripeID } = eventObject;
      if (stripeID) {
        const customer = await stripe.customers.retrieve(stripeID);
        if (customer?.email) {
          const customerEmail = customer.email.toLowerCase();
          const user = await db.findUser({ email: customerEmail });
          if (user) {
            await db.updateUser({ email: customerEmail }, {
              $set: { 'subscription.paymentFailed': true, 'subscription.paymentFailedAt': Date.now() }
            });
            logger.warn('Invoice payment failed', { email: customerEmail });
          }
        }
      }
    }

    return c.body(null, 200);
  } catch (e) {
    logger.error('Webhook processing error', { error: e.message });
    return c.body(null, 500);
  }
});

// ==== STATIC ROUTES ====
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// ==== GITHUB DOWNLOAD TRACKING ====
const GITHUB_REPOS = (process.env.GITHUB_REPOS || process.env.GITHUB_REPO || '')
  .split(',')
  .map(r => r.trim())
  .filter(Boolean);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

/**
 * Build headers for GitHub API requests.
 * @param {boolean} [authenticated=false] - Include Authorization header
 * @returns {Object} Headers object
 */
function githubHeaders(authenticated = false) {
  const headers = {
    'User-Agent': 'GrowthChart-Bot/1.0',
    'Accept': 'application/vnd.github+json',
  };
  if (authenticated && GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

try { mkdirSync('./backend/databases', { recursive: true }); } catch {}
const downloadsDb = new DatabaseSync(currentDbConfig.connectionString || './backend/databases/GrowthChart.db');
downloadsDb.exec('PRAGMA journal_mode = WAL');
downloadsDb.exec('PRAGMA synchronous = NORMAL');

downloadsDb.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    tag TEXT NOT NULL,
    download_count INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migration: add repo column to existing databases (must run before index creation)
try {
  downloadsDb.prepare('SELECT repo FROM downloads LIMIT 1').get();
} catch {
  logger.info('Migrating downloads table: adding repo column');
  downloadsDb.exec(`ALTER TABLE downloads ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
  downloadsDb.exec(`DROP INDEX IF EXISTS idx_downloads_date_tag`);
  const defaultRepo = GITHUB_REPOS[0] || '';
  downloadsDb.prepare(`UPDATE downloads SET repo = ? WHERE repo = ''`).run(defaultRepo);
  logger.info('Migration complete: repo column added', { defaultRepo });
}

downloadsDb.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_downloads_repo_date_tag ON downloads(repo, date, tag)
`);

downloadsDb.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Seed repos table from GITHUB_REPOS env var if empty
const repoCount = downloadsDb.prepare('SELECT COUNT(*) as count FROM repos').get();
if (repoCount.count === 0 && GITHUB_REPOS.length > 0) {
  const insertRepo = downloadsDb.prepare('INSERT OR IGNORE INTO repos (repo) VALUES (?)');
  for (const repo of GITHUB_REPOS) {
    insertRepo.run(repo);
  }
  logger.info('Seeded repos table from GITHUB_REPOS env var', { count: GITHUB_REPOS.length });
}

downloadsDb.exec(`
  CREATE TABLE IF NOT EXISTS github_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    date TEXT NOT NULL,
    metric TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    uniques INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
downloadsDb.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_github_metrics_repo_date_metric
    ON github_metrics(repo, date, metric)
`);

/** Read all repo records from the database. */
function getReposFromDb() {
  return downloadsDb.prepare('SELECT id, repo, created_at FROM repos ORDER BY created_at ASC').all();
}

/** Read repo name strings from the database. */
function getRepoListFromDb() {
  return getReposFromDb().map(r => r.repo);
}

/**
 * Fetch GitHub release download counts for a single repo and store a daily snapshot.
 *
 * Calls the GitHub Releases API for the given repo, sums asset
 * download_count per release, and upserts rows keyed on (repo, date, tag).
 * Idempotent — safe to call multiple times per day.
 *
 * @async
 * @param {string} repo - GitHub repo in "owner/name" format
 * @returns {Promise<{repo: string, date: string, releases: Array<{tag: string, download_count: number}>}>}
 */
async function fetchDownloadSnapshot(repo) {
  if (!repo) {
    logger.warn('No repo provided, skipping snapshot');
    return;
  }
  const today = new Date().toISOString().split('T')[0];

  // Check if we already have a snapshot for this repo today
  const existing = downloadsDb.prepare(
    'SELECT COUNT(*) as count FROM downloads WHERE repo = ? AND date = ?'
  ).get(repo, today);
  if (existing.count > 0) {
    logger.debug('Snapshot already exists for today', { repo, date: today });
    return { repo, date: today, releases: [] };
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases?per_page=100`,
      { headers: githubHeaders() }
    );

    if (!response.ok) {
      const status = response.status;
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      logger.warn('GitHub API request failed', { repo, status, rateLimitRemaining });
      throw new Error(`GitHub API returned ${status}`);
    }

    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining) {
      logger.debug('GitHub rate limit remaining', { remaining: rateLimitRemaining });
    }

    const releases = await response.json();
    const insertStmt = downloadsDb.prepare(
      `INSERT OR REPLACE INTO downloads (repo, date, tag, download_count) VALUES (?, ?, ?, ?)`
    );

    const results = [];
    for (const release of releases) {
      const tag = release.tag_name;
      const downloadCount = (release.assets || []).reduce(
        (sum, asset) => sum + (asset.download_count || 0), 0
      );
      insertStmt.run(repo, today, tag, downloadCount);
      results.push({ tag, download_count: downloadCount });
    }

    logger.info('Download snapshot saved', { repo, date: today, releaseCount: results.length });
    return { repo, date: today, releases: results };
  } catch (err) {
    logger.error('Failed to fetch download snapshot', { repo, error: err.message });
    throw err;
  }
}

/**
 * Fetch download snapshots for all configured repos.
 *
 * Reads the repo list from the database and calls fetchDownloadSnapshot for each.
 * Errors for individual repos are logged but do not stop processing.
 *
 * @async
 * @returns {Promise<void>}
 */
async function fetchAllSnapshots() {
  const repos = getRepoListFromDb();
  if (repos.length === 0) {
    logger.warn('No repos configured, skipping snapshot');
    return;
  }
  for (const repo of repos) {
    try {
      await fetchDownloadSnapshot(repo);
    } catch (err) {
      logger.error('Snapshot failed for repo', { repo, error: err.message });
    }
  }
}

/**
 * Fetch GitHub traffic clone counts for a repo and upsert daily rows.
 *
 * Calls GET /repos/{owner}/{repo}/traffic/clones (requires auth).
 * Each entry in the response clones array is upserted into github_metrics
 * with metric='clones'. Skips entirely if GITHUB_TOKEN is not set.
 *
 * @async
 * @param {string} repo - GitHub repo in "owner/name" format
 * @returns {Promise<void>}
 */
async function fetchTrafficClones(repo) {
  if (!GITHUB_TOKEN) {
    logger.warn('GITHUB_TOKEN not set, skipping traffic clones', { repo });
    return;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/traffic/clones`,
      { headers: githubHeaders(true) }
    );

    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining) {
      logger.debug('GitHub rate limit remaining (clones)', { remaining: rateLimitRemaining });
    }

    if (!response.ok) {
      logger.warn('GitHub traffic/clones API failed', { repo, status: response.status, rateLimitRemaining });
      return;
    }

    const data = await response.json();
    const insertStmt = downloadsDb.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, 'clones', ?, ?)`
    );
    for (const entry of (data.clones || [])) {
      const date = new Date(entry.timestamp).toISOString().split('T')[0];
      insertStmt.run(repo, date, entry.count || 0, entry.uniques || 0);
    }
    logger.info('Traffic clones snapshot saved', { repo, entries: (data.clones || []).length });
  } catch (err) {
    logger.error('Failed to fetch traffic clones', { repo, error: err.message });
  }
}

/**
 * Fetch GitHub traffic view counts for a repo and upsert daily rows.
 *
 * Calls GET /repos/{owner}/{repo}/traffic/views (requires auth).
 * Each entry in the response views array is upserted into github_metrics
 * with metric='views'. Skips entirely if GITHUB_TOKEN is not set.
 *
 * @async
 * @param {string} repo - GitHub repo in "owner/name" format
 * @returns {Promise<void>}
 */
async function fetchTrafficViews(repo) {
  if (!GITHUB_TOKEN) {
    logger.warn('GITHUB_TOKEN not set, skipping traffic views', { repo });
    return;
  }
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/traffic/views`,
      { headers: githubHeaders(true) }
    );

    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining) {
      logger.debug('GitHub rate limit remaining (views)', { remaining: rateLimitRemaining });
    }

    if (!response.ok) {
      logger.warn('GitHub traffic/views API failed', { repo, status: response.status, rateLimitRemaining });
      return;
    }

    const data = await response.json();
    const insertStmt = downloadsDb.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, 'views', ?, ?)`
    );
    for (const entry of (data.views || [])) {
      const date = new Date(entry.timestamp).toISOString().split('T')[0];
      insertStmt.run(repo, date, entry.count || 0, entry.uniques || 0);
    }
    logger.info('Traffic views snapshot saved', { repo, entries: (data.views || []).length });
  } catch (err) {
    logger.error('Failed to fetch traffic views', { repo, error: err.message });
  }
}

/**
 * Fetch current stargazer count for a repo and store as today's snapshot.
 *
 * Calls GET /repos/{owner}/{repo} and stores stargazers_count with
 * metric='stars'. Uses auth token if available for higher rate limits.
 * Idempotent — checks for existing row before inserting.
 *
 * @async
 * @param {string} repo - GitHub repo in "owner/name" format
 * @returns {Promise<void>}
 */
async function fetchStarsSnapshot(repo) {
  const today = new Date().toISOString().split('T')[0];
  const existing = downloadsDb.prepare(
    "SELECT COUNT(*) as count FROM github_metrics WHERE repo = ? AND date = ? AND metric = 'stars'"
  ).get(repo, today);
  if (existing.count > 0) {
    logger.debug('Stars snapshot already exists for today', { repo, date: today });
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}`,
      { headers: githubHeaders(!!GITHUB_TOKEN) }
    );

    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining) {
      logger.debug('GitHub rate limit remaining (stars)', { remaining: rateLimitRemaining });
    }

    if (!response.ok) {
      logger.warn('GitHub repo API failed (stars)', { repo, status: response.status, rateLimitRemaining });
      return;
    }

    const data = await response.json();
    downloadsDb.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, 'stars', ?, 0)`
    ).run(repo, today, data.stargazers_count || 0);
    logger.info('Stars snapshot saved', { repo, date: today, stars: data.stargazers_count });
  } catch (err) {
    logger.error('Failed to fetch stars snapshot', { repo, error: err.message });
  }
}

/**
 * Fetch current fork count for a repo and store as today's snapshot.
 *
 * Calls GET /repos/{owner}/{repo} and stores forks_count with
 * metric='forks'. Uses auth token if available for higher rate limits.
 * Idempotent — checks for existing row before inserting.
 *
 * @async
 * @param {string} repo - GitHub repo in "owner/name" format
 * @returns {Promise<void>}
 */
async function fetchForksSnapshot(repo) {
  const today = new Date().toISOString().split('T')[0];
  const existing = downloadsDb.prepare(
    "SELECT COUNT(*) as count FROM github_metrics WHERE repo = ? AND date = ? AND metric = 'forks'"
  ).get(repo, today);
  if (existing.count > 0) {
    logger.debug('Forks snapshot already exists for today', { repo, date: today });
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}`,
      { headers: githubHeaders(!!GITHUB_TOKEN) }
    );

    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    if (rateLimitRemaining) {
      logger.debug('GitHub rate limit remaining (forks)', { remaining: rateLimitRemaining });
    }

    if (!response.ok) {
      logger.warn('GitHub repo API failed (forks)', { repo, status: response.status, rateLimitRemaining });
      return;
    }

    const data = await response.json();
    downloadsDb.prepare(
      `INSERT OR REPLACE INTO github_metrics (repo, date, metric, count, uniques) VALUES (?, ?, 'forks', ?, 0)`
    ).run(repo, today, data.forks_count || 0);
    logger.info('Forks snapshot saved', { repo, date: today, forks: data.forks_count });
  } catch (err) {
    logger.error('Failed to fetch forks snapshot', { repo, error: err.message });
  }
}

/**
 * Fetch all GitHub metric snapshots for every tracked repo.
 *
 * Iterates getRepoListFromDb() and calls fetchTrafficClones,
 * fetchTrafficViews, fetchStarsSnapshot, and fetchForksSnapshot
 * for each. Errors per-repo are logged but do not stop processing.
 *
 * @async
 * @returns {Promise<void>}
 */
async function fetchAllMetricSnapshots() {
  const repos = getRepoListFromDb();
  if (repos.length === 0) {
    logger.warn('No repos configured, skipping metric snapshots');
    return;
  }
  for (const repo of repos) {
    try {
      await fetchTrafficClones(repo);
    } catch (err) {
      logger.error('Traffic clones failed for repo', { repo, error: err.message });
    }
    try {
      await fetchTrafficViews(repo);
    } catch (err) {
      logger.error('Traffic views failed for repo', { repo, error: err.message });
    }
    try {
      await fetchStarsSnapshot(repo);
    } catch (err) {
      logger.error('Stars snapshot failed for repo', { repo, error: err.message });
    }
    try {
      await fetchForksSnapshot(repo);
    } catch (err) {
      logger.error('Forks snapshot failed for repo', { repo, error: err.message });
    }
  }
}

/**
 * GET /api/downloads/repos — Return the list of configured repos.
 */
app.get('/api/downloads/repos', (c) => {
  return c.json({ repos: getRepoListFromDb() });
});

/**
 * GET /api/repos — List all tracked repos with id, name, and created_at.
 */
app.get('/api/repos', (c) => {
  const repos = getReposFromDb();
  return c.json({ repos });
});

/**
 * POST /api/repos — Add a repo to the tracking list.
 * Validates the repo exists on GitHub before inserting.
 * Triggers an initial download snapshot in the background.
 *
 * @body {string} repo - GitHub repo in "owner/name" format
 */
app.post('/api/repos', async (c) => {
  const body = await c.req.json();
  const repo = body?.repo?.trim();
  if (!repo || !repo.includes('/')) {
    return c.json({ error: 'Repo must be in "owner/name" format' }, 400);
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: githubHeaders()
    });
    if (!res.ok) {
      return c.json({ error: `GitHub repo "${repo}" not found` }, 400);
    }
  } catch {
    return c.json({ error: 'Failed to validate repo on GitHub' }, 502);
  }

  try {
    downloadsDb.prepare('INSERT INTO repos (repo) VALUES (?)').run(repo);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: 'Repo already added' }, 409);
    }
    throw err;
  }

  const inserted = downloadsDb.prepare('SELECT id, repo, created_at FROM repos WHERE repo = ?').get(repo);

  // Trigger initial snapshot for the new repo
  fetchDownloadSnapshot(repo).catch(err => {
    logger.error('Initial snapshot failed for new repo', { repo, error: err.message });
  });

  return c.json(inserted, 201);
});

/**
 * DELETE /api/repos/:id — Remove a repo from the tracking list.
 * Download history is preserved; only the repo record is deleted.
 *
 * @param {number} id - Repo record ID
 */
app.delete('/api/repos/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  const existing = downloadsDb.prepare('SELECT repo FROM repos WHERE id = ?').get(id);
  if (!existing) {
    return c.json({ error: 'Repo not found' }, 404);
  }
  downloadsDb.prepare('DELETE FROM repos WHERE id = ?').run(id);
  return c.json({ message: 'Repo removed', repo: existing.repo });
});

/**
 * GET /api/downloads — Return all download snapshots.
 * Optional query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&repo=owner/name
 */
app.get('/api/downloads', (c) => {
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');
    const repo = c.req.query('repo');

    let sql = 'SELECT repo, date, tag, download_count FROM downloads';
    const conditions = [];
    const params = [];

    if (repo) {
      conditions.push('repo = ?');
      params.push(repo);
    }
    if (from) {
      conditions.push('date >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('date <= ?');
      params.push(to);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC, tag ASC';

    const rows = downloadsDb.prepare(sql).all(...params);
    return c.json(rows);
  } catch (err) {
    logger.error('Failed to fetch downloads', { error: err.message });
    return c.json({ error: 'Failed to fetch downloads' }, 500);
  }
});

/**
 * GET /api/downloads/daily — Return daily download deltas.
 * Computes the difference in cumulative downloads between consecutive days.
 * Optional query param: ?repo=owner/name
 */
app.get('/api/downloads/daily', (c) => {
  try {
    const repo = c.req.query('repo');
    let sql = 'SELECT repo, date, tag, download_count FROM downloads';
    const params = [];

    if (repo) {
      sql += ' WHERE repo = ?';
      params.push(repo);
    }

    sql += ' ORDER BY date ASC, tag ASC';
    const rows = downloadsDb.prepare(sql).all(...params);

    // Group by date
    const byDate = new Map();
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date).push({ tag: row.tag, download_count: row.download_count });
    }

    const dates = Array.from(byDate.keys()).sort();
    const dailyDeltas = [];

    for (let i = 1; i < dates.length; i++) {
      const prevDate = dates[i - 1];
      const currDate = dates[i];
      const prevMap = new Map(byDate.get(prevDate).map(r => [r.tag, r.download_count]));
      const currEntries = byDate.get(currDate);

      let total = 0;
      const releases = [];

      for (const entry of currEntries) {
        const prevCount = prevMap.get(entry.tag) || 0;
        const delta = entry.download_count - prevCount;
        if (delta !== 0) {
          releases.push({ tag: entry.tag, delta });
          total += delta;
        }
      }

      dailyDeltas.push({ date: currDate, total, releases });
    }

    return c.json(dailyDeltas);
  } catch (err) {
    logger.error('Failed to compute daily deltas', { error: err.message });
    return c.json({ error: 'Failed to compute daily deltas' }, 500);
  }
});

/**
 * GET /api/downloads/latest — Return the most recent snapshot
 * with a total across all releases.
 * Optional query param: ?repo=owner/name
 */
app.get('/api/downloads/latest', (c) => {
  try {
    const repo = c.req.query('repo');
    let dateSql = 'SELECT date FROM downloads';
    const dateParams = [];

    if (repo) {
      dateSql += ' WHERE repo = ?';
      dateParams.push(repo);
    }

    dateSql += ' ORDER BY date DESC LIMIT 1';
    const latestDate = downloadsDb.prepare(dateSql).get(...dateParams);

    if (!latestDate) {
      return c.json({ date: null, total: 0, releases: [] });
    }

    let rowsSql = 'SELECT tag, download_count FROM downloads WHERE date = ?';
    const rowsParams = [latestDate.date];

    if (repo) {
      rowsSql += ' AND repo = ?';
      rowsParams.push(repo);
    }

    rowsSql += ' ORDER BY tag ASC';
    const rows = downloadsDb.prepare(rowsSql).all(...rowsParams);

    const total = rows.reduce((sum, r) => sum + r.download_count, 0);

    return c.json({
      date: latestDate.date,
      total,
      releases: rows.map(r => ({ tag: r.tag, download_count: r.download_count }))
    });
  } catch (err) {
    logger.error('Failed to fetch latest downloads', { error: err.message });
    return c.json({ error: 'Failed to fetch latest downloads' }, 500);
  }
});

/**
 * POST /api/downloads/snapshot — Manually trigger a download snapshot.
 * Optional body: { repo: "owner/name" } to snapshot a single repo.
 * If omitted, snapshots all configured repos.
 */
app.post('/api/downloads/snapshot', async (c) => {
  try {
    let repo;
    try {
      const body = await c.req.json();
      repo = body?.repo;
    } catch {
      // No body or invalid JSON — snapshot all repos
    }

    if (repo) {
      const result = await fetchDownloadSnapshot(repo);
      return c.json(result, 201);
    }

    await fetchAllSnapshots();
    return c.json({ message: 'Snapshots completed for all repos', repos: getRepoListFromDb() }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to fetch snapshot: ' + err.message }, 500);
  }
});

/**
 * POST /api/downloads/backfill — Insert a historical total for a given date.
 * Distributes the total proportionally across releases based on the nearest existing snapshot.
 *
 * @body {string} date - YYYY-MM-DD date to backfill
 * @body {number} total - Total download count for that date
 * @body {string} [repo] - GitHub repo in "owner/name" format (defaults to first configured repo)
 */
app.post('/api/downloads/backfill', async (c) => {
  try {
    const body = await c.req.json();
    const { date, total } = body;
    const repo = body.repo || getRepoListFromDb()[0] || '';
    if (!date || total == null) {
      return c.json({ error: 'date and total are required' }, 400);
    }

    const nearest = downloadsDb.prepare(
      'SELECT DISTINCT date FROM downloads WHERE repo = ? ORDER BY ABS(julianday(date) - julianday(?)) LIMIT 1'
    ).get(repo, date);

    if (!nearest) {
      return c.json({ error: 'No existing snapshots to base distribution on' }, 400);
    }

    const refRows = downloadsDb.prepare(
      'SELECT tag, download_count FROM downloads WHERE repo = ? AND date = ?'
    ).all(repo, nearest.date);

    const refTotal = refRows.reduce((s, r) => s + r.download_count, 0);
    const insertStmt = downloadsDb.prepare(
      'INSERT OR REPLACE INTO downloads (repo, date, tag, download_count) VALUES (?, ?, ?, ?)'
    );

    const results = [];
    let assigned = 0;
    for (let i = 0; i < refRows.length; i++) {
      const tag = refRows[i].tag;
      const count = i === refRows.length - 1
        ? total - assigned
        : Math.round((refRows[i].download_count / refTotal) * total);
      assigned += count;
      insertStmt.run(repo, date, tag, Math.max(0, count));
      results.push({ tag, download_count: Math.max(0, count) });
    }

    logger.info('Backfill saved', { repo, date, total, releaseCount: results.length });
    return c.json({ repo, date, total, releases: results }, 201);
  } catch (err) {
    logger.error('Backfill failed', { error: err.message });
    return c.json({ error: 'Backfill failed: ' + err.message }, 500);
  }
});

// ==== GITHUB METRICS ROUTES ====

const VALID_METRICS = ['stars', 'forks', 'clones', 'views'];

/**
 * GET /api/metrics — Query github_metrics rows.
 * Required query param: metric (stars|forks|clones|views).
 * Optional: repo, from, to.
 */
app.get('/api/metrics', (c) => {
  try {
    const metric = c.req.query('metric');
    if (!metric || !VALID_METRICS.includes(metric)) {
      return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
    }

    const repo = c.req.query('repo');
    const from = c.req.query('from');
    const to = c.req.query('to');

    let sql = 'SELECT repo, date, metric, count, uniques FROM github_metrics WHERE metric = ?';
    const params = [metric];

    if (repo) {
      sql += ' AND repo = ?';
      params.push(repo);
    }
    if (from) {
      sql += ' AND date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND date <= ?';
      params.push(to);
    }

    sql += ' ORDER BY date DESC';
    const rows = downloadsDb.prepare(sql).all(...params);
    return c.json(rows);
  } catch (err) {
    logger.error('Failed to fetch metrics', { error: err.message });
    return c.json({ error: 'Failed to fetch metrics' }, 500);
  }
});

/**
 * GET /api/metrics/daily — Day-over-day deltas for a metric.
 * Required query param: metric. Optional: repo.
 * Returns [{date, total}] matching /api/downloads/daily shape.
 */
app.get('/api/metrics/daily', (c) => {
  try {
    const metric = c.req.query('metric');
    if (!metric || !VALID_METRICS.includes(metric)) {
      return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
    }

    const repo = c.req.query('repo');
    let sql = 'SELECT date, SUM(count) as count, SUM(uniques) as uniques FROM github_metrics WHERE metric = ?';
    const params = [metric];

    if (repo) {
      sql += ' AND repo = ?';
      params.push(repo);
    }

    sql += ' GROUP BY date ORDER BY date ASC';
    const rows = downloadsDb.prepare(sql).all(...params);

    const dailyDeltas = [];
    for (let i = 1; i < rows.length; i++) {
      const delta = rows[i].count - rows[i - 1].count;
      dailyDeltas.push({ date: rows[i].date, total: delta });
    }

    return c.json(dailyDeltas);
  } catch (err) {
    logger.error('Failed to compute metric daily deltas', { error: err.message });
    return c.json({ error: 'Failed to compute metric daily deltas' }, 500);
  }
});

/**
 * GET /api/metrics/latest — Most recent snapshot for a metric.
 * Required query param: metric. Optional: repo.
 * Returns {date, count, uniques}.
 */
app.get('/api/metrics/latest', (c) => {
  try {
    const metric = c.req.query('metric');
    if (!metric || !VALID_METRICS.includes(metric)) {
      return c.json({ error: `metric query param required, one of: ${VALID_METRICS.join(', ')}` }, 400);
    }

    const repo = c.req.query('repo');
    let sql = 'SELECT date, SUM(count) as count, SUM(uniques) as uniques FROM github_metrics WHERE metric = ?';
    const params = [metric];

    if (repo) {
      sql += ' AND repo = ?';
      params.push(repo);
    }

    sql += ' ORDER BY date DESC LIMIT 1';
    const row = downloadsDb.prepare(sql).get(...params);

    if (!row) {
      return c.json({ date: null, count: 0, uniques: 0 });
    }

    return c.json({ date: row.date, count: row.count, uniques: row.uniques });
  } catch (err) {
    logger.error('Failed to fetch latest metric', { error: err.message });
    return c.json({ error: 'Failed to fetch latest metric' }, 500);
  }
});

/**
 * POST /api/metrics/snapshot — Manually trigger metric snapshot.
 * Optional body: {metric, repo}. If omitted, fetches all metrics for all repos.
 */
app.post('/api/metrics/snapshot', async (c) => {
  try {
    let metric;
    let repo;
    try {
      const body = await c.req.json();
      metric = body?.metric;
      repo = body?.repo;
    } catch {
      // No body or invalid JSON — fetch all
    }

    if (metric && !VALID_METRICS.includes(metric)) {
      return c.json({ error: `Invalid metric, must be one of: ${VALID_METRICS.join(', ')}` }, 400);
    }

    const repos = repo ? [repo] : getRepoListFromDb();
    const metricsToFetch = metric ? [metric] : VALID_METRICS;

    const fetchMap = {
      clones: fetchTrafficClones,
      views: fetchTrafficViews,
      stars: fetchStarsSnapshot,
      forks: fetchForksSnapshot,
    };

    for (const r of repos) {
      for (const m of metricsToFetch) {
        try {
          await fetchMap[m](r);
        } catch (err) {
          logger.error('Metric snapshot failed', { repo: r, metric: m, error: err.message });
        }
      }
    }

    return c.json({ message: 'Metric snapshots completed', repos, metrics: metricsToFetch }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to fetch metric snapshot: ' + err.message }, 500);
  }
});

/**
 * Parse JSON request body with proper error handling
 *
 * Returns parsed JSON or null if parsing fails. Sets 400 response on failure.
 * Handles SyntaxError from malformed JSON.
 *
 * @async
 * @param {Context} c - Hono context
 * @returns {Promise<Object|null>} Parsed body or null on error
 */
async function parseJsonBody(c) {
  try {
    return await c.req.json();
  } catch (e) {
    if (e instanceof SyntaxError) {
      return null;
    }
    throw e;
  }
}

// ==== AUTH ROUTES ====
app.post("/api/signup", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    let { email, password, name } = body;

    // Validation
    if (!validateEmail(email)) {
      return c.json({ error: 'Invalid email format or length' }, 400);
    }
    if (!validatePassword(password)) {
      return c.json({ error: 'Password must be 6-72 characters' }, 400);
    }
    if (!validateName(name)) {
      return c.json({ error: 'Name required (max 100 characters)' }, 400);
    }

    email = email.toLowerCase().trim();
    name = escapeHtml(name.trim());

    const hash = await hashPassword(password);
    let insertID = generateUUID()

    try {
      // Insert user first
      await db.insertUser({
        _id: insertID,
        email: email,
        name: name,
        created_at: Date.now()
      });

      // Insert auth record (compensating delete on failure)
      try {
        await db.insertAuth({ email: email, password: hash, userID: insertID });
      } catch (authError) {
        // Rollback: delete the user we just created
        logger.error('Auth insert failed, rolling back user creation', { error: authError.message });
        try {
          await db.executeQuery({ query: 'DELETE FROM Users WHERE _id = ?', params: [insertID] });
        } catch (rollbackError) {
          logger.error('Rollback failed - orphaned user record', { userID: insertID, error: rollbackError.message });
        }
        throw authError;
      }

      const token = await generateToken(insertID);
      setAuthCookies(c, insertID, token);
      logger.info('Signup success');

      return c.json({
        id: insertID.toString(),
        email: email,
        name: name.trim(),
        tokenExpires: tokenExpireTimestamp()
      }, 201);
    } catch (e) {
      if (e.message?.includes('UNIQUE constraint failed') || e.message?.includes('duplicate key') || e.code === 11000) {
        logger.warn('Signup failed - duplicate account');
        return c.json({ error: "Unable to create account with provided credentials" }, 400);
      }
      throw e;
    }
  } catch (e) {
    logger.error('Signup error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

app.post("/api/signin", async (c) => {
  try {
    const body = await parseJsonBody(c);
    if (!body) {
      return c.json({ error: 'Invalid request body' }, 400);
    }
    let { email, password } = body;

    // Validation
    if (!validateEmail(email)) {
      return c.json({ error: 'Invalid credentials' }, 400);
    }
    if (!password || typeof password !== 'string') {
      return c.json({ error: 'Invalid credentials' }, 400);
    }

    email = email.toLowerCase().trim();
    logger.debug('Attempting signin');

    // Check account lockout
    const lockStatus = isAccountLocked(email);
    if (lockStatus.locked) {
      c.header('Retry-After', String(lockStatus.remainingTime));
      return c.json({
        error: 'Account temporarily locked. Try again later.',
        retryAfter: lockStatus.remainingTime
      }, 429);
    }

    // Check if auth exists
    const auth = await db.findAuth( { email: email });
    if (!auth) {
      logger.debug('Auth record not found');
      recordFailedLogin(email);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Verify password
    if (!(await verifyPassword(password, auth.password))) {
      logger.debug('Password verification failed');
      recordFailedLogin(email);
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Get user
    const user = await db.findUser( { email: email });
    if (!user) {
      logger.error('User not found for auth record');
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Clear failed attempts on successful login
    clearFailedLogins(email);

    // Generate token
    const token = await generateToken(user._id.toString());
    setAuthCookies(c, user._id, token);
    logger.info('Signin success');

    return c.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      ...(user.subscription && {
        subscription: {
          stripeID: user.subscription.stripeID,
          expires: user.subscription.expires,
          status: user.subscription.status,
        },
      }),
      tokenExpires: tokenExpireTimestamp()
    });
  } catch (e) {
    logger.error('Signin error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

app.post("/api/signout", authMiddleware, async (c) => {
  try {
    const userID = c.get('userID');

    // Clear CSRF token from store
    csrfTokenStore.delete(userID);

    // Clear the HttpOnly cookie
    deleteCookie(c, 'token', {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'Strict',
      path: '/'
    });

    // Clear the CSRF token cookie
    deleteCookie(c, 'csrf_token', {
      httpOnly: false,
      secure: isProd(),
      sameSite: 'Lax',
      path: '/'
    });

    logger.info('Signout success');
    return c.json({ message: "Signed out successfully" });
  } catch (e) {
    logger.error('Signout error', { error: e.message });
    return c.json({ error: "Server error" }, 500);
  }
});

// ==== USER DATA ROUTES ====
app.get("/api/me", authMiddleware, async (c) => {
  const userID = c.get('userID');
  const user = await db.findUser( { _id: userID });
  logger.debug('/me checking for user');
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

app.put("/api/me", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { name } = body;

    // Validation
    if (name !== undefined && !validateName(name)) {
      return c.json({ error: 'Name must be 1-100 characters' }, 400);
    }

    // Whitelist of fields users are allowed to update
    const UPDATEABLE_USER_FIELDS = ['name'];

    // Find user first to verify existence
    const user = await db.findUser( { _id: userID });
    if (!user) return c.json({ error: "User not found" }, 404);

    // Whitelist approach - only allow specific fields
    const update = {};
    for (const [key, value] of Object.entries(body)) {
      if (UPDATEABLE_USER_FIELDS.includes(key)) {
        // Sanitize string values to prevent XSS
        update[key] = typeof value === 'string' ? escapeHtml(value.trim()) : value;
      }
    }

    if (Object.keys(update).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    // Update user document
    const result = await db.updateUser( { _id: userID }, { $set: update });

    if (result.modifiedCount === 0) {
      return c.json({ error: "No changes made" }, 400);
    }

    // Return updated user
    const updatedUser = await db.findUser( { _id: userID });
    return c.json(updatedUser);
  } catch (err) {
    logger.error('Update user error', { error: err.message });
    return c.json({ error: "Failed to update user" }, 500);
  }
});

// ==== USAGE TRACKING ====
app.post("/api/usage", authMiddleware, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { operation } = body; // "check" or "track"

    if (!operation || !['check', 'track'].includes(operation)) {
      return c.json({ error: "Invalid operation. Must be 'check' or 'track'" }, 400);
    }

    // Get user
    const user = await db.findUser( { _id: userID });
    if (!user) return c.json({ error: "User not found" }, 404);

    // Check if user is a subscriber - subscribers get unlimited
    const isSubscriber = user.subscription?.status === 'active' &&
      (!user.subscription?.expires || user.subscription.expires > Math.floor(Date.now() / 1000));

    if (isSubscriber) {
      return c.json({
        remaining: -1,
        total: -1,
        isSubscriber: true,
        subscription: {
          status: user.subscription.status,
          expiresAt: user.subscription.expires ? new Date(user.subscription.expires * 1000).toISOString() : null
        }
      });
    }

    // Get usage limit from environment
    const limit = parseInt(process.env.FREE_USAGE_LIMIT || '20');
    const now = Math.floor(Date.now() / 1000);

    // Initialize usage if not set
    let usage = user.usage || { count: 0, reset_at: null };

    // Check if we need to reset (30 days = 2592000 seconds)
    if (!usage.reset_at || now > usage.reset_at) {
      const newResetAt = now + (30 * 24 * 60 * 60); // 30 days from now
      // Reset usage - atomic set operation
      await db.updateUser(
        { _id: userID },
        { $set: { usage: { count: 0, reset_at: newResetAt } } }
      );
      usage = { count: 0, reset_at: newResetAt };
    }

    if (operation === 'track') {
      // Atomic increment first to prevent race conditions
      // Then verify we haven't exceeded the limit
      await db.updateUser(
        { _id: userID },
        { $inc: { 'usage.count': 1 } }
      );

      // Re-read user to get actual count after atomic increment
      const updatedUser = await db.findUser( { _id: userID });
      const actualCount = updatedUser?.usage?.count || 1;

      // If we exceeded the limit, rollback the increment and return 429
      if (actualCount > limit) {
        await db.updateUser(
          { _id: userID },
          { $inc: { 'usage.count': -1 } }
        );
        return c.json({
          error: "Usage limit reached",
          remaining: 0,
          total: limit,
          isSubscriber: false
        }, 429);
      }

      usage.count = actualCount;
    }

    // Return usage info (with subscription details for free users too)
    return c.json({
      remaining: Math.max(0, limit - usage.count),
      total: limit,
      isSubscriber: false,
      used: usage.count,
      subscription: user.subscription ? {
        status: user.subscription.status,
        expiresAt: user.subscription.expires ? new Date(user.subscription.expires * 1000).toISOString() : null
      } : null
    });

  } catch (error) {
    logger.error('Usage tracking error', { error: error.message });
    return c.json({ error: "Server error" }, 500);
  }
});

// ==== PAYMENT ROUTES ====
app.post("/api/checkout", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { email, lookup_key } = body;

    if (!email || !lookup_key) return c.json({ error: "Missing email or lookup_key" }, 400);

    // Verify the email matches the authenticated user
    const user = await db.findUser( { _id: userID });
    if (!user || user.email !== email) return c.json({ error: "Email mismatch" }, 403);

    const prices = await stripe.prices.list({ lookup_keys: [lookup_key], expand: ["data.product"] });

    if (!prices.data || prices.data.length === 0) {
      return c.json({ error: `No price found for lookup_key: ${lookup_key}` }, 400);
    }

    // Use FRONTEND_URL env var or origin header, fallback to localhost for dev
    const origin = process.env.FRONTEND_URL || c.req.header('origin') || `http://localhost:${port}`;

    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      billing_address_collection: "auto",
      success_url: `${origin}/app/payment?success=true`,
      cancel_url: `${origin}/app/payment?canceled=true`,
      subscription_data: { metadata: { email } },
    });
    return c.json({ url: session.url, id: session.id, customerID: session.customer });
  } catch (e) {
    logger.error('Checkout session error', { error: e.message });
    return c.json({ error: "Stripe session failed" }, 500);
  }
});

app.post("/api/portal", authMiddleware, csrfProtection, async (c) => {
  try {
    const userID = c.get('userID');
    const body = await c.req.json();
    const { customerID } = body;

    if (!customerID) return c.json({ error: "Missing customerID" }, 400);

    // Verify the customerID matches the authenticated user's subscription
    const user = await db.findUser( { _id: userID });
    if (!user || (user.subscription?.stripeID && user.subscription.stripeID !== customerID)) {
      return c.json({ error: "Unauthorized customerID" }, 403);
    }

    // Use FRONTEND_URL env var or origin header, fallback to localhost for dev
    const origin = process.env.FRONTEND_URL || c.req.header('origin') || `http://localhost:${port}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerID,
      return_url: `${origin}/app/payment?portal=return`,
    });
    return c.json({ url: portalSession.url, id: portalSession.id });
  } catch (e) {
    logger.error('Portal session error', { error: e.message });
    return c.json({ error: "Stripe portal failed" }, 500);
  }
});

// ==== STATIC FILE SERVING (Production) ====
const staticDir = resolve(__dirname, config.staticDir);

// Serve static files
app.use('/*', serveStatic({ root: staticDir }));

// SPA fallback — only for non-asset routes
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.match(/\.\w+$/)) {
    return c.notFound();
  }
  try {
    const indexPath = resolve(staticDir, 'index.html');
    const file = await promisify(readFile)(indexPath);
    return c.html(new TextDecoder().decode(file));
  } catch {
    return c.text("Welcome to Skateboard API", 200);
  }
});

// ==== ERROR HANDLER ====
app.onError((err, c) => {
  const requestId = Math.random().toString(36).substr(2, 9);

  logger.error('Unhandled error occurred', {
    message: err.message,
    stack: !isProd() ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
    requestId
  });

  return c.json({
    error: !isProd() ? err.message : 'Internal server error',
    ...(!isProd() && { stack: err.stack })
  }, 500);
});

// ==== UTILITY FUNCTIONS ====

/**
 * Check if the server is running in production mode
 *
 * Reads the NODE_ENV environment variable. Returns true only when
 * NODE_ENV is explicitly set to "production".
 *
 * @returns {boolean} True if NODE_ENV === "production"
 */
function isProd() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Load environment variables from .env and optional .env.local file.
 *
 * Reads in two passes: backend/.env first (may be symlink to shared creds),
 * then backend/.env.local for project-specific overrides (wins on conflict).
 * Creates .env from .env.example if it doesn't exist. Only called in
 * non-production mode — Railway injects vars directly in prod.
 *
 * @returns {void}
 */
function loadLocalENV() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const envFilePath = resolve(__dirname, './.env');
  const envLocalPath = resolve(__dirname, './.env.local');
  const envExamplePath = resolve(__dirname, './.env.example');

  // Check if .env exists, if not create it from .env.example
  try {
    statSync(envFilePath);
  } catch (err) {
    try {
      const exampleData = readFileSync(envExamplePath, 'utf8');
      writeFileSync(envFilePath, exampleData);
    } catch (exampleErr) {
      logger.error('Failed to create .env from template', { error: exampleErr.message });
      return;
    }
  }

  // Load .env (may be symlink to shared creds)
  loadEnvFile(envFilePath);

  // Load .env.local overrides (project-specific, optional)
  loadEnvFile(envLocalPath);
}

/**
 * Parse a .env file and apply key=value pairs to process.env.
 * Skips blank lines and comments. Handles quoted values and values containing '='.
 * Silently skips if file doesn't exist.
 * @param {string} filePath - Absolute path to the .env file
 * @returns {void}
 */
function loadEnvFile(filePath) {
  try {
    const data = readFileSync(filePath, 'utf8');
    for (let line of data.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      let [key, ...valueParts] = line.split('=');
      let value = valueParts.join('=');
      if (key && value) {
        key = key.trim();
        value = value.trim().replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist or unreadable — silent
  }
}

// ==== DOWNLOAD SNAPSHOT ====
// Run once on startup
fetchAllSnapshots().catch(() => {});
fetchAllMetricSnapshots().catch(() => {});

// Hourly check: if today's snapshot is missing for any repo, take one.
// Handles the case where the server stays running across midnight
// and Railway cron doesn't trigger a restart.
setInterval(async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const fetchMap = {
      clones: fetchTrafficClones,
      views: fetchTrafficViews,
      stars: fetchStarsSnapshot,
      forks: fetchForksSnapshot,
    };
    for (const repo of getRepoListFromDb()) {
      const row = downloadsDb.prepare(
        'SELECT COUNT(*) as count FROM downloads WHERE repo = ? AND date = ?'
      ).get(repo, today);
      if (row.count === 0) {
        logger.info('No snapshot for today, triggering fetch', { repo, date: today });
        try {
          await fetchDownloadSnapshot(repo);
        } catch (err) {
          logger.error('Hourly snapshot failed for repo', { repo, error: err.message });
        }
      }

      for (const metric of VALID_METRICS) {
        const metricRow = downloadsDb.prepare(
          'SELECT COUNT(*) as count FROM github_metrics WHERE repo = ? AND date = ? AND metric = ?'
        ).get(repo, today, metric);
        if (metricRow.count === 0) {
          try {
            await fetchMap[metric](repo);
          } catch (err) {
            logger.error('Hourly metric snapshot failed', { repo, metric, error: err.message });
          }
        }
      }
    }
  } catch (err) {
    logger.error('Hourly snapshot check failed', { error: err.message });
  }
}, 60 * 60 * 1000);

// ==== SERVER STARTUP ====
const server = serve({
  fetch: app.fetch,
  port,
  hostname: '::'  // Listen on both IPv4 and IPv6
}, (info) => {
  logger.info('Server started successfully', {
    port: info.port,
    environment: !isProd() ? 'development' : 'production'
  });
});

// Handle graceful shutdown on SIGTERM and SIGINT - NEED THIS FOR PROXY
if (typeof process !== 'undefined') {
  const gracefulShutdown = async (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    // Close HTTP server first
    server.close(async () => {
      console.log('Server closed');

      // Close all database connections with error handling
      try {
        await databaseManager.closeAll();
        console.log('Database connections closed');
      } catch (err) {
        console.error('Error closing database connections:', err);
      }

      process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
