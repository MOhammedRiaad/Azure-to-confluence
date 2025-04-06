const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils');

async function parseWiki(wikiPath, projectDir = '') {
  try {
    logger.info(`Parsing wiki at path: ${wikiPath}`);
    const structure = {
      pages: []
    };

    // Read directory contents
    const items = await fs.readdir(wikiPath);
    
    // Process each item in the directory
    for (const item of items) {
      const fullPath = path.join(wikiPath, item);
      const stats = await fs.stat(fullPath);
      
      // Skip hidden files and specified directories
      if (item.startsWith('.') || ['node_modules', '.git'].includes(item)) {
        continue;
      }

      if (stats.isDirectory()) {
        // Handle directory
        const subStructure = await parseWiki(fullPath, projectDir);
        if (subStructure.pages.length > 0) {
          structure.pages.push({
            title: item,
            path: fullPath,
            children: subStructure.pages
          });
        }
      } else if (item.endsWith('.md')) {
        // Handle Markdown file
        logger.debug(`Reading Markdown file: ${fullPath}`);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          if (content) {
            structure.pages.push({
              title: path.basename(item, '.md'),
              path: fullPath,
              content: content,
              children: []
            });
            logger.debug(`Successfully loaded content for: ${item}`);
          } else {
            logger.warn(`Empty content in file: ${item}`);
          }
        } catch (readError) {
          logger.error(`Error reading file ${item}:`, readError);
        }
      }
    }

    return structure;
  } catch (error) {
    logger.error('Error parsing wiki structure:', error);
    throw error;
  }
}

/**
 * Sanitize a title for use in URLs or paths
 * @param {string} title - Raw title
 * @returns {string} - Sanitized title with URL encoding for special characters
 */
function sanitizeTitle(title) {
  if (!title) return '';
  
  try {
    // Replace encoded character sequences with their plain versions
    let decodedTitle = title;
    try {
      // First try to decode in case the title is already URL-encoded
      decodedTitle = decodeURIComponent(title);
    } catch (e) {
      // If decoding fails, use the original title
      logger.warn(`Could not decode title "${title}": ${e.message}`);
    }
    
    // Remove any path separators and problematic characters
    const sanitized = decodedTitle
      .replace(/[\\/]/g, '-')        // Replace slashes with hyphens
      .replace(/[<>:"|?*]/g, '_')    // Replace problematic characters with underscores
      .replace(/%/g, '-')            // Replace percent signs with hyphens
      .replace(/&/g, 'and')          // Replace ampersands with 'and'
      .replace(/\+/g, ' ');          // Replace plus signs with spaces
    
    // Trim the title and return the readable version
    return sanitized.trim();
  } catch (error) {
    logger.error(`Error sanitizing title "${title}":`, error);
    // Return a fallback safe version of the title
    return title.replace(/[^\w-]/g, '_').trim();
  }
}

module.exports = {
  parseWiki,
  sanitizeTitle
};