/**
 * Navigation utilities for generating menus and breadcrumbs
 */

const { sanitizePathSegment, decodeUrlEncoded } = require('./pathUtils');

/**
 * Decode URL-encoded characters in titles for display
 * @param {string} title - The title that may contain URL-encoded characters
 * @returns {string} - The decoded, human-readable title
 */
function decodeTitle(title) {
  // Use the decodeUrlEncoded function from pathUtils for consistency
  return decodeUrlEncoded(title);
}

/**
 * Generate a navigation menu from a list of pages
 * @param {Array} pages - List of pages
 * @param {number} [level=0] - Current nesting level
 * @param {string} [parentPath=''] - Path to parent page
 * @returns {string} - HTML for the navigation menu
 */
function generateNavMenu(pages, level = 0, parentPath = '') {
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return '<div class="no-navigation">No pages available</div>';
  }
  
  let html = '<ul class="nav-list">';
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    
    // Skip attachment directories
    if (page.isAttachmentDir) continue;
    
    const hasChildren = page.isDirectory && page.children && page.children.length > 0;
    const toggleId = `nav-toggle-${level}-${i}`;
    const childrenId = `nav-children-${level}-${i}`;
    const sanitizedTitle = sanitizePathSegment(page.title);
    const displayTitle = decodeTitle(page.title); // Decode title for display
    
    // Build the full path including parent paths
    const currentPath = parentPath ? `${parentPath}/${sanitizedTitle}` : sanitizedTitle;
    
    // Determine the path for the link - now including parent path
    const pagePath = `pages/${currentPath}/index.html`;
    
    html += '<li class="nav-item">';
    
    if (hasChildren) {
      html += `<div class="nav-header">
        <span class="toggle-icon" data-target="${childrenId}">▼</span>
        <a data-page-path="${currentPath}" href="${pagePath}">${displayTitle}</a>
      </div>
      <div id="${childrenId}" class="nav-children">
        ${generateNavMenu(page.children, level + 1, currentPath)}
      </div>`;
    } else {
      html += `<a data-page-path="${currentPath}" href="${pagePath}">${displayTitle}</a>`;
    }
    
    html += '</li>';
  }
  
  html += '</ul>';
  
  return html;
}

/**
 * Generate breadcrumb navigation from a path
 * @param {string} path - Current page path
 * @returns {string} - HTML for breadcrumb navigation
 */
function generateBreadcrumbs(path) {
  if (!path) {
    return '<a href="../index.html">Home</a>';
  }
  
  const segments = path.split('/').filter(Boolean);
  let html = '<a href="../index.html">Home</a>';
  let cumPath = '';
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    cumPath += (i > 0 ? '/' : '') + segment;
    
    // For all but the last segment, create links
    if (i < segments.length - 1) {
      html += ` <span class="separator">/</span> <a href="../${cumPath}/index.html">${decodeTitle(segment)}</a>`;
    } else {
      // Last segment is current page, no link
      html += ` <span class="separator">/</span> <span class="current">${decodeTitle(segment)}</span>`;
    }
  }
  
  return html;
}

/**
 * Generate a list of top pages for the index page
 * @param {Array} pages - List of pages
 * @param {number} [limit=5] - Maximum number of pages to include
 * @returns {string} - HTML for the top pages section
 */
function generateTopPages(pages, limit = 5) {
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return '<div class="no-pages">No pages available</div>';
  }
  
  // Flatten the page hierarchy to get all pages
  const allPages = flattenPages(pages);
  
  // Sort pages by some criteria (here we just take the first 'limit' pages)
  const topPages = allPages.slice(0, limit);
  
  let html = '';
  
  for (const page of topPages) {
    const sanitizedTitle = sanitizePathSegment(page.title);
    // Find the full path to this page
    const pagePath = findPagePath(pages, page.title);
    const formattedPath = pagePath ? `pages/${pagePath}/index.html` : `pages/${sanitizedTitle}/index.html`;
    const displayTitle = decodeTitle(page.title); // Decode title for display
    
    html += `
    <div class="page-card">
      <h3><a href="${formattedPath}">${displayTitle}</a></h3>
      <p>${getPageDescription(page)}</p>
      <div class="card-footer">
        <span><i class="fas fa-folder"></i> ${getPageDirectory(page)}</span>
      </div>
    </div>`;
  }
  
  return html;
}

/**
 * Find the full path to a page in the hierarchy
 * @param {Array} pages - List of pages
 * @param {string} title - Page title to find
 * @param {string} [parentPath=''] - Current parent path
 * @returns {string|null} - Full path to the page or null if not found
 */
function findPagePath(pages, title, parentPath = '') {
  if (!pages || !Array.isArray(pages)) {
    return null;
  }
  
  for (const page of pages) {
    if (page.isAttachmentDir) continue;
    
    const sanitizedTitle = sanitizePathSegment(page.title);
    const currentPath = parentPath ? `${parentPath}/${sanitizedTitle}` : sanitizedTitle;
    
    if (page.title === title) {
      return currentPath;
    }
    
    if (page.isDirectory && page.children && Array.isArray(page.children)) {
      const foundInChildren = findPagePath(page.children, title, currentPath);
      if (foundInChildren) {
        return foundInChildren;
      }
    }
  }
  
  return null;
}

/**
 * Flatten a page hierarchy into a single array
 * @param {Array} pages - List of pages
 * @returns {Array} - Flattened array of pages
 */
function flattenPages(pages) {
  if (!pages || !Array.isArray(pages)) {
    return [];
  }
  
  let result = [];
  
  for (const page of pages) {
    // Skip attachment directories
    if (page.isAttachmentDir) continue;
    
    // Add this page
    result.push(page);
    
    // Recursively add children
    if (page.isDirectory && page.children && Array.isArray(page.children)) {
      result = result.concat(flattenPages(page.children));
    }
  }
  
  return result;
}

/**
 * Get a short description for a page
 * @param {Object} page - Page object
 * @returns {string} - Short description
 */
function getPageDescription(page) {
  // Return a simple description based on whether it's a directory
  if (page.isDirectory) {
    return `Directory with ${page.children ? page.children.length : 0} items`;
  } else {
    return 'Content page';
  }
}

/**
 * Get the directory path for a page
 * @param {Object} page - Page object
 * @returns {string} - Directory path
 */
function getPageDirectory(page) {
  // This is a simplification - in a real implementation, you'd get the actual directory
  return page.isDirectory ? 'Directory' : 'Page';
}

module.exports = {
  generateNavMenu,
  generateBreadcrumbs,
  generateTopPages,
  decodeTitle
}; 