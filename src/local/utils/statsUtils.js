/**
 * Statistics utility functions for local preview generation
 */

const fs = require('fs-extra');
const path = require('path');

/**
 * Count the total number of pages in the pages array
 * @param {Array} pages - List of pages
 * @returns {number} Number of pages
 */
function countPages(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let count = 0;
  
  for (const page of pages) {
    if (!page.isDirectory || page.isContentPage || page.hasFileContent) {
      count++;
    }
    
    if (page.children && page.children.length > 0) {
      count += countPages(page.children);
    }
  }
  
  return count;
}

/**
 * Count the total number of folders in the pages array
 * @param {Array} pages - List of pages
 * @returns {number} Number of folders
 */
function countFolders(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let count = 0;
  
  for (const page of pages) {
    if (page.isDirectory) {
      count++;
    }
    
    if (page.children && page.children.length > 0) {
      count += countFolders(page.children);
    }
  }
  
  return count;
}

/**
 * Count the total number of attachments in the wiki structure
 * @param {Object} wikiStructure - Wiki structure
 * @returns {number} Number of attachments
 */
function countAttachments(wikiStructure) {
  let count = 0;
  
  const countAttachmentsInDir = (dir) => {
    if (!dir || !dir.files) return 0;
    return dir.files.length;
  };
  
  // Count attachments in root
  if (wikiStructure.attachments) {
    count += countAttachmentsInDir(wikiStructure.attachments);
  }
  
  // Also check for .attachments folder directly
  try {
    const attachmentsPath = path.join(process.cwd(), '..', '.attachments');
    if (fs.existsSync(attachmentsPath)) {
      const files = fs.readdirSync(attachmentsPath);
      if (files && files.length > 0) {
        // Use this count if we found files
        return files.length;
      }
    }
  } catch (error) {
    console.warn('Error checking .attachments folder:', error.message);
  }
  
  // Recursively count attachments in all pages
  const processPages = (pages) => {
    if (!pages || !Array.isArray(pages)) return;
    
    for (const page of pages) {
      if (page.attachments) {
        count += countAttachmentsInDir(page.attachments);
      }
      
      if (page.children && page.children.length > 0) {
        processPages(page.children);
      }
    }
  };
  
  processPages(wikiStructure.pages);
  
  return count;
}

module.exports = {
  countPages,
  countFolders,
  countAttachments
}; 