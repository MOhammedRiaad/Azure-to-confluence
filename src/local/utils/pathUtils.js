/**
 * Path utilities for handling path calculations and navigation
 */

/**
 * Decode URL-encoded characters in text
 * @param {string} text - The text that may contain URL-encoded characters
 * @returns {string} - The decoded text
 */
function decodeUrlEncoded(text) {
  if (!text) return text;
  
  try {
    // Replace common URL encodings with their human-readable versions
    let decoded = text;
    decoded = decoded.replace(/%2D/g, '-');
    decoded = decoded.replace(/%20/g, ' ');
    decoded = decoded.replace(/%3A/g, ':');
    decoded = decoded.replace(/%2F/g, '/');
    decoded = decoded.replace(/%26/g, '&');
    decoded = decoded.replace(/%3F/g, '?');
    decoded = decoded.replace(/%3D/g, '=');
    decoded = decoded.replace(/%25/g, '%');
    decoded = decoded.replace(/%40/g, '@');
    decoded = decoded.replace(/%2B/g, '+');
    
    // Try to use decodeURIComponent for any remaining encoded characters
    try {
      decoded = decodeURIComponent(decoded);
    } catch (e) {
      // If decodeURIComponent fails, just use our manual replacements
    }
    
    return decoded;
  } catch (error) {
    // If any decoding fails, return the original text
    return text;
  }
}

/**
 * Sanitize a path segment to be used in a URL
 * @param {string} segment - Path segment to sanitize
 * @returns {string} - Sanitized path segment
 */
function sanitizePathSegment(segment) {
  if (!segment) return 'unnamed';
  
  // First decode any URL-encoded characters
  segment = decodeUrlEncoded(segment);
  
  // Replace characters that are invalid in Windows filenames
  let result = segment
    .replace(/[<>:"\/\\|?*]/g, '_')
    .replace(/"/g, "'")
    .replace(/:/g, '-')
    .replace(/\s+/g, '-')
    .trim();
    
  // Remove multiple consecutive hyphens
  result = result.replace(/-+/g, '-');
  
  // Ensure the result is not too long to avoid path length issues
  if (result.length > 50) {
    result = result.substring(0, 50);
  }
  
  // Trim hyphens from beginning and end
  result = result.replace(/^-+|-+$/g, '');
  
  return result.length === 0 ? 'unnamed' : result;
}

/**
 * Calculate the path to the root based on the current depth
 * @param {number} depth - Current depth in the directory structure
 * @returns {string} - Path to the root
 */
function calculatePathToRoot(depth) {
  // Add 1 to account for the 'pages' directory
  return depth > 0 ? '../'.repeat(depth + 1) : './';
}

/**
 * Create a script for dynamic root path calculation
 * @returns {string} - JavaScript code for dynamic root path calculation
 */
function createDynamicRootPathScript() {
  return `
  (function loadStylesheet() {
      // Get the current URL path
      const currentPath = window.location.pathname;
      
      // Find the root path (up to local-output)
      let rootPath = '';
      
      if (currentPath.includes('local-output')) {
        // Extract the path up to and including local-output
        const pathParts = currentPath.split('local-output');
        rootPath = pathParts[0] + 'local-output/';
      } else {
        // Fallback in case we can't find local-output in the path
        let tempPath = window.location.href;
        tempPath = tempPath.substring(0, tempPath.lastIndexOf('/') + 1);
        
        // Navigate up to find the root
        const pagesIndex = tempPath.indexOf('pages/');
        if (pagesIndex !== -1) {
          rootPath = tempPath.substring(0, pagesIndex);
        } else {
          rootPath = tempPath;
        }
      }
      
      // Create the stylesheet link element
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = rootPath + 'styles.css';
      
      // Log for debugging
      console.log('Loading stylesheet from: ' + stylesheet.href);
      
      // Add the stylesheet to the head
      document.head.appendChild(stylesheet);
})()
;`;
}

/**
 * Create a script for navigating between pages
 * @returns {string} - JavaScript code for navigation
 */
function createNavigationScript() {
  return `
  // Navigation function
  function navigateToPage(element) {
    const pagePath = element.getAttribute('data-page-path');
    if (!pagePath) return;
    
    // Log to help with debugging
    console.log('Current path:', window.location.pathname);
    console.log('Target page path:', pagePath);
    
    // Calculate current depth by counting directory segments
    // Split the path, filter out empty segments, and count
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const currentPath = pathParts.join('/');
    
    // Determine if we're in the index page or a content page
    const inIndexPage = !currentPath.includes('/pages/');
    
    // Calculate number of '../' needed based on current depth
    let depth = 0;
    if (!inIndexPage) {
      // Count the directories after "/pages/" in the path
      const pagesIndex = pathParts.indexOf('pages');
      if (pagesIndex !== -1) {
        depth = pathParts.length - pagesIndex - 1;
      }
    }
    
    // Build the path to the root
    const pathToRoot = inIndexPage ? './' : '../'.repeat(depth);
    console.log('Calculated path to root:', pathToRoot);
    
    // Determine the correct URL
    const url = pathToRoot + 'pages/' + pagePath + '/index.html';
    console.log('Navigating to:', url);
    
    // Navigate to the page
    window.location.href = url;
  }
  
  // Enhance all nav links to use the navigation function
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[data-page-path]').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        navigateToPage(this);
      });
    });
  });`;
}

module.exports = {
  sanitizePathSegment,
  calculatePathToRoot,
  createDynamicRootPathScript,
  createNavigationScript,
  decodeUrlEncoded
}; 