/**
 * Sanitize page title to ensure it's compatible with Confluence
 * @param {string} title - The original page title
 * @returns {string} - Sanitized page title
 */
function sanitizePageTitle(title) {
  if (!title) return '';

  // We should preserve the original title as much as possible while ensuring it's compatible with Confluence
  // Confluence supports most special characters in titles, so we only need to handle problematic ones
  
  // First trim any whitespace
  let sanitized = title.trim();
  
  // Replace consecutive spaces with a single space
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Remove any characters that are known to cause issues in Confluence
  // These typically include control characters and some special Unicode characters
  sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  
  // Limit the length if it's excessively long (Confluence has a limit of around 255 chars)
  if (sanitized.length > 250) {
    sanitized = sanitized.substring(0, 250);
  }
  
  return sanitized;
}

module.exports = { sanitizePageTitle };