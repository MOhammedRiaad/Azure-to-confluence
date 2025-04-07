/**
 * Page renderer for converting markdown to HTML
 */

const { marked } = require('marked');
const path = require('path');
const { logger } = require('../utils');
const { decodeUrlEncoded } = require('./utils/pathUtils');

/**
 * Clean up an attachment filename by removing size annotations and decoding URL-encoded characters
 * @param {string} filename - The original filename from the path
 * @returns {string} - Cleaned filename
 */
function cleanAttachmentFilename(filename) {
  if (!filename) return '';
   
   filename = removeAfterExtension(filename)
  // Remove size annotations like %20%3D750x or =750x at the end of the filename
  let cleaned = filename.replace(/(%20)*(%3D|\s*=\s*)[0-9x]+$/i, '');
  
  // Remove any GUID or hash suffixes (common in Azure DevOps wiki attachments)
  cleaned = cleaned.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
  
  // Now decode URL-encoded characters
  try {
    cleaned = decodeUrlEncoded(cleaned);
  } catch (err) {
    logger.warn(`Warning: Error decoding filename ${filename}: ${err.message}`);
  }
  
  // Clean any other artifacts
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Extract the actual image filename from a complex path
 * @param {string} imagePath - The full image path
 * @returns {string} - The clean filename
 */
function extractImageFilename(imagePath) {
  if (!imagePath) return '';
  
  try {
    // Extract filename from path
    const rawFilename = imagePath.split('/').pop().split('\\').pop();
    
    // Clean the filename
    return cleanAttachmentFilename(rawFilename);
  } catch (err) {
    logger.warn(`Warning: Error extracting image filename from ${imagePath}: ${err.message}`);
    return imagePath.split('/').pop().split('\\').pop(); // Fallback to basic extraction
  }
}

/**
 * Convert markdown to HTML with attachment paths
 * @param {string} markdown - Markdown content
 * @param {Object} attachmentMappings - Attachment mappings
 * @param {string} pagePath - Original page path
 * @param {string} parentPath - Parent path for hierarchy
 * @returns {string} HTML content
 */
function convertMarkdownToHtml(markdown, attachmentMappings, pagePath, parentPath) {
  try {
    // Check if markdown is undefined or null
    if (!markdown) {
      logger.warn(`Warning: No markdown content for page at ${pagePath}`);
      return '<p>No content</p>';
    }
    
    // Log the full path details for debugging
    console.log(`Processing markdown for page path: ${pagePath}, parentPath: ${parentPath}`);
    
    // Normalize parentPath to use forward slashes for consistent web URL path handling
    const normalizedParentPath = parentPath ? parentPath.split(path.sep).join('/') : '';
    
    // Process Azure Wiki syntax replacements before passing to marked
    
    // Replace [[_TOC_]] with a simple HTML TOC placeholder
    let processedMarkdown = markdown.replace(/\[\[_TOC_\]\]/g, '<div class="toc">Table of Contents</div>');
    
    // Convert tables to have proper formatting
    processedMarkdown = processedMarkdown.replace(/\|([^\n]+)\|/g, function(match) {
      return match.replace(/\s*\|\s*/g, '|');
    });
    
    // Calculate the path depth based on the number of segments in the parentPath
    let pathDepth = 0;
    if (normalizedParentPath) {
      // Count the actual path segments
      pathDepth = normalizedParentPath.split('/').filter(Boolean).length;
    }
    
    // Use relative paths from current directory to reach root
    // For a page at /pages/folder1/folder2/index.html, we need to go up levels:
    // 1 level for index.html to folder2/
    // +pathDepth for the additional directory levels
    // +1 for the 'pages' directory
    const levelsToRoot = pathDepth + 1; // +1 for the 'pages' directory
    const pathToRoot = '../'.repeat(levelsToRoot);
    const pathToAttachments = `${pathToRoot}attachments/`;
    
    console.log(`Path depth details: normalizedParentPath=${normalizedParentPath}, pathDepth=${pathDepth}, pathToRoot=${pathToRoot}`);
   
    try {
      // First, process simple markdown image references directly
      // This handles the format: ![alt text](path/to/image.png)
      processedMarkdown = processedMarkdown.replace(
        /!\[([^\]]*)\]\(([^)]+)(?:\s*=\s*([0-9x]+))?\)/g,
        (match, altText, imagePath, dimensions) => {
          if (!imagePath) return match;
          
          // Check if this is an attachment reference
          const isAttachment = 
            imagePath.includes('.attachments/') || 
            imagePath.includes('/attachments/') || 
            (!imagePath.startsWith('http') && !imagePath.startsWith('data:'));
          
          if (!isAttachment) return match; // Not an attachment, keep as is
          
          try {
            // Get clean filename from the image path
            const cleanFileName = extractImageFilename(imagePath);
            logger.info('cleaned file name 1',cleanFileName)
            // Create the path with URL encoding for spaces and special characters
            const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
            
            return `<img src="${newImagePath}" alt="${altText || cleanFileName}" />`;
          } catch (err) {
            logger.warn(`Warning: Error processing image reference (${imagePath}): ${err.message}`);
            return match; // Return original if error
          }
        }
      );
    } catch (error) {
      logger.warn(`Warning: Error processing markdown image references: ${error.message}`);
    }
    
    try {
      // Process wiki-style image links: ![[image.png]]
      processedMarkdown = processedMarkdown.replace(
        /!\[\[([^|\]]+)(?:\|[^\]]*)?]]/g,
        (match, imagePath) => {
          if (!imagePath) return match;
          
          try {
            
            // Get clean filename from the image path
            const cleanFileName = extractImageFilename(imagePath);
            logger.info('cleaned file name 2',cleanFileName)
            // Create the path with URL encoding for spaces and special characters
            const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
            
            return `<img src="${newImagePath}" alt="${cleanFileName}" />`;
          } catch (err) {
            logger.warn(`Warning: Error processing wiki-style image (${imagePath}): ${err.message}`);
            return match; // Return original if error
          }
        }
      );
    } catch (error) {
      logger.warn(`Warning: Error processing wiki-style image links: ${error.message}`);
    }
    
    try {
      // Process HTML img tags - use a more robust regex with a precise capture for src
      processedMarkdown = processedMarkdown.replace(
        /<img(?:[^>]*?\s+)src=["']([^"']*)["'](?:[^>]*?)>/g,
        (match, imagePath) => {
          if (!imagePath) return match;
          
          // Check if this is an attachment reference
          const isAttachment = 
            imagePath.includes('.attachments/') || 
            imagePath.includes('/attachments/') || 
            imagePath.includes('../attachments/') ||
            (!imagePath.startsWith('http') && !imagePath.startsWith('data:'));
          
          if (!isAttachment) return match; // Not an attachment, keep as is
          
          try {
            // For paths with relative notation (../../../../attachments/...), extract just the filename
            let filename;
            
            if (imagePath.includes('attachments/')) {
              // Extract everything after the last 'attachments/' occurrence
              const attachmentsPos = imagePath.lastIndexOf('attachments/');
              if (attachmentsPos !== -1) {
                filename = imagePath.substring(attachmentsPos + 'attachments/'.length);
              } else {
                // Fallback to just getting the filename
                filename = imagePath.split('/').pop();
              }
            } else {
              // For other paths, just get the filename
              filename = imagePath.split('/').pop();
            }
            
            // Clean the filename - remove size annotations, GUIDs, etc.
            const cleanFileName = cleanAttachmentFilename(filename);
            logger.info('cleaned file name 3',cleanFileName)
            // Extract alt text from the original tag if it exists
            const altMatch = match.match(/alt=["']([^"']*)["']/);
            const altText = altMatch ? altMatch[1] : cleanFileName;
            
            // Create the path with URL encoding for spaces and special characters
            const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
            
            console.log(`Converting image path: ${imagePath} → ${newImagePath}`);
            
            return `<img src="${newImagePath}" alt="${altText}" />`;
          } catch (err) {
            logger.warn(`Warning: Error processing HTML img tag (${imagePath}): ${err.message}`);
            return match; // Return original if error
          }
        }
      );
    } catch (error) {
      logger.warn(`Warning: Error processing HTML img tags: ${error.message}`);
    }

    try {
      // Replace links to other wiki pages
      processedMarkdown = processedMarkdown.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, function(match, text, href) {
        if (!href.includes('.attachment') && !href.includes('/attachments/')) {
          try {
            const pageName = path.basename(href);
            // Calculate proper path using normalized path - one level up for each path segment
            const relPathToPage = '../'.repeat(pathDepth);
            return `[${text}](${relPathToPage}${pageName}/index.html)`;
          } catch (err) {
            logger.warn(`Warning: Error processing wiki link (${href}): ${err.message}`);
            return match; // Return original if error
          }
        }
        return match; // Leave attachment links for the previous replacement
      });
    } catch (error) {
      logger.warn(`Warning: Error processing wiki page links: ${error.message}`);
    }

    // Use default marked parser with minimal options
    return marked.parse(processedMarkdown, { 
      gfm: true,
      breaks: true,
      sanitize: false 
    });
  } catch (error) {
    logger.error('Error converting markdown to HTML:', error);
    // Return basic formatted content in case of error
    return `<div class="error-message">
              <h3>Error rendering markdown</h3>
              <p>${error.message}</p>
              <details>
                <summary>Show raw content</summary>
                <pre>${markdown ? markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'No content'}</pre>
              </details>
            </div>`;
  }
}

function removeAfterExtension(filename) {
  // Find the last dot in the filename
  const lastDotIndex = filename.lastIndexOf('.');
  // If there's no dot, return the original filename
  if (lastDotIndex === -1) return filename;
  // Extract the base name and the extension
  const baseName = filename.substring(0, lastDotIndex);
  const extension = filename.substring(lastDotIndex);
  // Find the first space or % after the extension
  const endIndex = extension.search(/[\s%]/);
  // If there's no space or %, return the base name with the extension
  if (endIndex === -1) return baseName + extension;
  // Otherwise, return the base name with the extension up to the space or %
  return baseName + extension.substring(0, endIndex);
}

module.exports = {
  convertMarkdownToHtml
}; 