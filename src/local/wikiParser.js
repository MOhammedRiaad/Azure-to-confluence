/**
 * Wiki parser for local testing
 */

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils');
const { countPages, countAttachments, countFolders } = require('./utils/statsUtils');
const { sanitizePathSegment, decodeUrlEncoded } = require('./utils/pathUtils');

/**
 * Check if a directory or file should be excluded from the wiki structure
 * @param {string} itemName - Name of the directory or file
 * @param {string} itemPath - Full path to the directory or file
 * @returns {boolean} - True if the directory should be excluded
 */
function shouldExcludeItem(itemName, itemPath) {
  // Exclude hidden files and directories
  if (itemName.startsWith('.')) return true;
  
  // Exclude common directories that shouldn't be part of the wiki
  const excludedDirs = [
    'node_modules',
    'dist',
    'build',
    '.git',
    'coverage',
    'logs',
    'tmp',
    'temp',
    '.github',
    '.vscode',
    '.vs',
    'bin',
    'obj',
    'azure-to-confluence'
  ];
  
  // Check if the current item name is in the exclusion list
  if (excludedDirs.includes(itemName)) return true;
  
  // Check if the path contains any of the excluded directories
  for (const dir of excludedDirs) {
    if (itemPath.includes(`/${dir}/`) || itemPath.includes(`\\${dir}\\`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse the wiki structure for local testing
 * @param {string} wikiRootPath - Path to the Azure DevOps wiki root
 * @returns {Promise<Object>} - Wiki structure object
 */
async function parseWiki(wikiRootPath) {
  logger.info(`Parsing wiki at ${wikiRootPath}`);
  
  try {
    // Check if the wiki root exists
    if (!(await fs.pathExists(wikiRootPath))) {
      throw new Error(`Wiki root path does not exist: ${wikiRootPath}`);
    }
    
    // Parse the wiki structure
    const rootDir = path.dirname(wikiRootPath);
    const wikiStructure = {
      root: rootDir,
      rootPage: wikiRootPath,
      pages: [],
      attachments: {
        path: path.join(rootDir, '.attachments'),
        count: 0
      }
    };
    
    // Check if .order file exists to determine page ordering
    const orderPath = path.join(rootDir, '.order');
    let pageOrder = [];
    
    try {
      if (await fs.pathExists(orderPath)) {
        const orderContent = await fs.readFile(orderPath, 'utf8');
        pageOrder = orderContent.split('\n').filter(Boolean);
        logger.info(`Found .order file with ${pageOrder.length} entries`);
      }
    } catch (error) {
      logger.warn(`Error reading .order file: ${error.message}`);
    }
    
    // Get and process contents of the wiki root
    const rootContents = await fs.readdir(rootDir);
    
    // Sort contents according to .order file if available
    const sortedContents = [...rootContents].sort((a, b) => {
      const aIndex = pageOrder.indexOf(a);
      const bIndex = pageOrder.indexOf(b);
      
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    
    // Process each item in the wiki root
    for (const item of sortedContents) {
      try {
        const itemPath = path.join(rootDir, item);
        
        // Skip items that should be excluded (except .attachments)
        if (item === '.attachments') {
          wikiStructure.attachments.path = itemPath;
          wikiStructure.attachments.count = await countAttachments(itemPath);
          logger.info(`Found .attachments directory with ${wikiStructure.attachments.count} files`);
          continue;
        }
        
        if (shouldExcludeItem(item, itemPath)) {
          continue;
        }
        
        const stats = await fs.stat(itemPath);
        
        // Process item based on whether it's a directory or file
        if (stats.isDirectory()) {
          // It's a directory - process it recursively
          const directory = await processDirectory(itemPath, item);
          wikiStructure.pages.push(directory);
        } else if (stats.isFile() && item.endsWith('.md')) {
          // It's a markdown file - process it as a page
          const page = processMarkdownFile(itemPath, item);
          wikiStructure.pages.push(page);
        }
      } catch (error) {
        logger.warn(`Error processing wiki item ${item}: ${error.message}`);
      }
    }
    
    // Add statistics
    wikiStructure.stats = {
      pageCount: countPages(wikiStructure.pages),
      folderCount: countFolders(wikiStructure.pages),
      attachmentCount: wikiStructure.attachments.count
    };
    
    // Process the wiki structure to set file paths consistently
    normalizeWikiStructure(wikiStructure.pages);
    
    logger.info(`Wiki parsing complete - found ${wikiStructure.stats.pageCount} pages, ${wikiStructure.stats.folderCount} folders, and ${wikiStructure.stats.attachmentCount} attachments`);
    
    return wikiStructure;
  } catch (error) {
    logger.error(`Error parsing wiki: ${error.message}`);
    throw error;
  }
}

/**
 * Normalize the wiki structure to ensure consistent naming for files and directories
 * @param {Array} pages - Array of page objects
 */
function normalizeWikiStructure(pages) {
  if (!pages || !Array.isArray(pages)) return;
  
  for (const page of pages) {
    // Make sure every page has originalTitle for filesystem operations
    if (!page.originalTitle) {
      page.originalTitle = page.title;
    }
    
    // Make sure each directory has a sanitized filesystem path
    page.filePath = page.originalTitle;
    
    // Process children recursively
    if (page.isDirectory && page.children && Array.isArray(page.children)) {
      normalizeWikiStructure(page.children);
    }
  }
}

/**
 * Process a directory in the wiki
 * @param {string} dirPath - Path to the directory
 * @param {string} dirName - Name of the directory
 * @returns {Promise<Object>} - Directory object
 */
async function processDirectory(dirPath, dirName) {
  logger.debug(`Processing directory: ${dirPath}`);
  
  // Decode URL-encoded characters in the directory name
  const decodedDirName = decodeUrlEncoded(dirName);
  
  // Check if this is an attachments directory
  const isAttachmentDir = dirName === '.attachments' || dirPath.includes('.attachments');
  
  const directory = {
    title: decodedDirName,
    originalTitle: dirName, // Keep the original title for path construction
    path: dirPath,
    isDirectory: true,
    isAttachmentDir,
    children: []
  };
  
  // If this is an attachments directory, we don't need to process further
  if (isAttachmentDir) {
    return directory;
  }
  
  // Check for index.md in the directory
  const indexPath = path.join(dirPath, 'index.md');
  if (await fs.pathExists(indexPath)) {
    try {
      const indexContent = await fs.readFile(indexPath, 'utf8');
      directory.indexContent = indexContent;
    } catch (error) {
      logger.warn(`Error reading index.md for directory ${dirName}: ${error.message}`);
    }
  }
  
  // Check if .order file exists for ordering pages
  const orderPath = path.join(dirPath, '.order');
  let pageOrder = [];
  
  try {
    if (await fs.pathExists(orderPath)) {
      const orderContent = await fs.readFile(orderPath, 'utf8');
      pageOrder = orderContent.split('\n').filter(Boolean);
    }
  } catch (error) {
    logger.warn(`Error reading .order file in ${dirName}: ${error.message}`);
  }
  
  // Get directory contents
  const contents = await fs.readdir(dirPath);
  
  // Sort contents according to .order file if available
  const sortedContents = [...contents].sort((a, b) => {
    const aIndex = pageOrder.indexOf(a);
    const bIndex = pageOrder.indexOf(b);
    
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  
  // Process each item in the directory
  for (const item of sortedContents) {
    try {
      // Skip index.md as it's already processed
      if (item === 'index.md') continue;
      
      const itemPath = path.join(dirPath, item);
      
      // Skip items that should be excluded
      if (shouldExcludeItem(item, itemPath)) {
        continue;
      }
      
      const stats = await fs.stat(itemPath);
      
      if (stats.isDirectory()) {
        // Process subdirectory recursively
        const subdirectory = await processDirectory(itemPath, item);
        directory.children.push(subdirectory);
      } else if (stats.isFile() && item.endsWith('.md')) {
        // Process markdown file
        const page = processMarkdownFile(itemPath, item);
        directory.children.push(page);
      }
    } catch (error) {
      logger.warn(`Error processing item ${item} in directory ${dirName}: ${error.message}`);
    }
  }
  
  return directory;
}

/**
 * Process a markdown file
 * @param {string} filePath - Path to the markdown file
 * @param {string} fileName - Name of the file
 * @returns {Object} - Page object
 */
function processMarkdownFile(filePath, fileName) {
  logger.debug(`Processing markdown file: ${filePath}`);
  
  // Remove .md extension from filename
  const title = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
  
  // Decode URL-encoded characters in the title
  const decodedTitle = decodeUrlEncoded(title);
  
  return {
    title: decodedTitle,
    originalTitle: title, // Keep the original title for path construction
    path: filePath,
    isDirectory: false
  };
}

module.exports = {
  parseWiki,
  shouldExcludeItem
}; 