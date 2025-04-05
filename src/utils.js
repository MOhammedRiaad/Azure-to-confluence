const path = require('path');
const fs = require('fs-extra');

/**
 * Helper function to get MIME type
 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Count the total number of pages in a page structure
 * @param {Array} pages - Array of pages
 * @returns {number} - Total number of pages
 */
function countPages(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let total = pages.length;
  
  for (const page of pages) {
    if (page.children && Array.isArray(page.children)) {
      total += countPages(page.children);
    }
  }
  
  return total;
}

/**
 * Logger utility to standardize logging across the application
 * Supports different log levels and contextual information
 */
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/**
 * Logger utility for consistent logging with timestamp and log level
 */
const logger = {
  /**
   * Get formatted timestamp for logs
   * @returns {string} Formatted timestamp
   */
  _getTimestamp() {
    return new Date().toISOString();
  },
  
  /**
   * Log a message with debug level
   * @param {string} message - Log message
   * @param {Object} [context] - Optional context object
   */
  debug(message, context) {
    console.debug(`[${this._getTimestamp()}] [DEBUG] ${message}${context ? ' ' + JSON.stringify(context) : ''}`);
  },
  
  /**
   * Log a message with info level
   * @param {string} message - Log message
   * @param {Object} [context] - Optional context object
   */
  info(message, context) {
    console.log(`[${this._getTimestamp()}] [INFO] ${message}${context ? ' ' + JSON.stringify(context) : ''}`);
  },
  
  /**
   * Log a message with warning level
   * @param {string} message - Log message
   * @param {Object} [context] - Optional context object
   */
  warn(message, context) {
    console.warn(`[${this._getTimestamp()}] [WARN] ${message}${context ? ' ' + JSON.stringify(context) : ''}`);
  },
  
  /**
   * Log a message with error level
   * @param {string} message - Log message
   * @param {Error|Object} [error] - Optional error object
   * @param {Object} [context] - Optional context object
   */
  error(message, error, context) {
    console.error(
      `[${this._getTimestamp()}] [ERROR] ${message}${error ? ` - ${error.message || JSON.stringify(error)}` : ''}${context ? ' ' + JSON.stringify(context) : ''}`
    );
  }
};

module.exports = {
  getMimeType,
  countPages,
  logger
};