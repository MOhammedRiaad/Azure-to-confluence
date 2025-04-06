const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');

/**
 * Safe URI component decoder that handles malformed URIs
 * @param {string} uri - URI to decode
 * @returns {string} - Decoded URI
 */
function safeDecodeURIComponent(uri) {
  try {
    return decodeURIComponent(uri);
  } catch (error) {
    console.warn(`Warning: Failed to decode URI component "${uri}"`);
    // Handle common encodings manually
    let result = uri;
    // Replace common encodings
    result = result.replace(/%20/g, ' ')
      .replace(/%2D/g, '-')
      .replace(/%2F/g, '/')
      .replace(/%3A/g, ':');
    return result;
  }
}

/**
 * Parse Azure DevOps wiki structure
 * @param {string} wikiRoot - Path to wiki root
 * @returns {Promise<Object>} - Wiki structure
 */
async function parseWiki(wikiRoot) {
  console.log(`Parsing wiki at path: ${wikiRoot}`);
  
  const rootPages = await parseDirectory(wikiRoot);
  
  return {
    pages: rootPages.filter(page => page.title !== '.attachments')
  };
}

/**
 * Parses a directory in the wiki structure
 * @param {string} dirPath - Path to the directory to parse
 * @param {number} level - Level of nesting
 * @returns {Object} Pages in this directory and its subdirectories
 */
async function parseDirectory(dirPath, level = 0) {
  const indent = '  '.repeat(level);
  console.log(`${indent}Parsing directory: ${dirPath}`);
  
  try {
    const pages = [];
    const basePath = path.basename(dirPath);
    
    // Skip special directories and files that aren't part of the wiki content
    if (basePath.startsWith('.') && basePath !== '.attachments') {
      console.log(`${indent}Skipping directory: ${basePath} (hidden)`);
      return pages;
    }
    
    // Always include .attachments directory to properly handle images
    if (basePath === '.attachments') {
      return [{
        title: '.attachments',
        isDirectory: true,
        isAttachmentDir: true,
        path: dirPath,
        children: [],
      }];
    }
    
    const items = await fs.readdir(dirPath);
    
    // First check for .order file
    let orderFile = null;
    let orderItems = [];
    
    for (const item of items) {
      if (item.toLowerCase() === '.order') {
        orderFile = path.join(dirPath, item);
        try {
          const content = await fs.readFile(orderFile, 'utf8');
          orderItems = content.split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
              try {
                return decodeURIComponent(line.trim());
              } catch (e) {
                console.log(`Warning: Failed to decode URI component "${line.trim()}"`);
                return line.trim();
              }
            });
          
          console.log(`${indent}Order file found in ${dirPath} with entries: ${orderItems.join(', ')}`);
        } catch (error) {
          console.error(`${indent}Error reading order file: ${error.message}`);
        }
        break;
      }
    }
    
    // Create a map of ordered items for quick lookup - with proper title normalization
    const orderMap = new Map();
    
    // Function to normalize titles for comparison
    const normalizeTitle = (title) => {
      return title.replace(/[^\w\s-]/g, '-').replace(/\s+/g, '-');
    };
    
    // Create mapping of raw items in .order file to their positions
    orderItems.forEach((item, index) => {
      // We need to normalize the title for comparison
      const normalizedTitle = normalizeTitle(item);
      orderMap.set(normalizedTitle, index);
    });
    
    // Process all files and directories
    for (const item of items) {
      if (item.toLowerCase() === '.order') continue;
      
      const itemPath = path.join(dirPath, item);
      const stats = await fs.stat(itemPath);
      
      // Handle attachments directory
      if (stats.isDirectory() && item === '.attachments') {
        pages.push({
          title: item,
          isDirectory: true,
          isAttachmentDir: true,
          path: itemPath,
          children: [],
        });
        continue;
      }
      
      // Process markdown files
      if (stats.isFile() && item.toLowerCase().endsWith('.md')) {
        // Get the title from filename
        const title = path.basename(item, '.md');
        // Convert URL encoded characters
        let decodedTitle;
        try {
          decodedTitle = decodeURIComponent(title);
        } catch (e) {
          console.log(`${indent}Warning: Failed to decode URI component "${title}"`);
          decodedTitle = title;
        }
        
        // Find the order in the .order file, or default to high number
        // Normalize the title for comparison with order file entries
        const normalizedTitle = normalizeTitle(decodedTitle);
        const order = orderMap.has(normalizedTitle) ? orderMap.get(normalizedTitle) : 999;
        
        // Add to pages
        pages.push({
          title: decodedTitle,
          isDirectory: false,
          path: itemPath,
          order: order,
          originalFilename: item
        });
      }
      
      // Process subdirectories
      if (stats.isDirectory() && !item.startsWith('.') && item !== '.attachments') {
        // Normalize the directory name for comparison with order file
        const dirTitle = path.basename(item);
        let decodedDirTitle;
        try {
          decodedDirTitle = decodeURIComponent(dirTitle);
        } catch (e) {
          console.log(`${indent}Warning: Failed to decode URI component "${dirTitle}"`);
          decodedDirTitle = dirTitle;
        }
        
        // Check if subdirectory has markdown files or further subdirectories
        // before recursively parsing
        const subDirItems = await fs.readdir(itemPath);
        const hasMarkdownOrDirs = subDirItems.some(subItem => {
          const subItemPath = path.join(itemPath, subItem);
          return (
            subItem.toLowerCase().endsWith('.md') || 
            (fs.existsSync(subItemPath) && fs.statSync(subItemPath).isDirectory() && !subItem.startsWith('.'))
          );
        });
        
        // Only parse subdirectory if it contains markdown files or directories
        if (hasMarkdownOrDirs) {
          const subPages = await parseDirectory(itemPath, level + 1);
          
          // If we have child pages, add directory as a page
          if (subPages.length > 0) {
            // Find order in .order file, or default to high number
            const normalizedDirTitle = normalizeTitle(decodedDirTitle);
            const order = orderMap.has(normalizedDirTitle) ? orderMap.get(normalizedDirTitle) : 999;
            
            // Check for index file
            const indexFile = subDirItems.find(f => 
              f.toLowerCase() === 'index.md' || 
              f.toLowerCase() === `${item.toLowerCase()}.md`
            );
            
            // If index file exists, parse it and use as the parent
            let indexContent = null;
            if (indexFile) {
              const indexPath = path.join(itemPath, indexFile);
              try {
                indexContent = await fs.readFile(indexPath, 'utf8');
              } catch (error) {
                console.error(`${indent}Error reading index file: ${error.message}`);
              }
            }
            
            // Add directory as page with children
            pages.push({
              title: decodedDirTitle,
              isDirectory: true,
              path: itemPath,
              order: order,
              indexContent: indexContent,
              children: subPages,
              originalFilename: item
            });
            
            // If there's an explicit markdown file with same name as dir
            // add it also as a separate page at same level
            const explicitFile = subDirItems.find(f => 
              f.toLowerCase() === `${item.toLowerCase()}.md`
            );
            
            if (explicitFile) {
              const explicitPath = path.join(itemPath, explicitFile);
              pages.push({
                title: decodedDirTitle,
                isDirectory: false,
                path: explicitPath,
                order: order, // Use same order as directory
                originalFilename: explicitFile
              });
            }
          }
        }
      }
    }
    
    // Sort pages by order specified in .order file, or alphabetically if no order
    pages.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      return a.title.localeCompare(b.title);
    });
    
    // Log ordered pages
    if (pages.length > 0 && level === 0) {
      console.log(`${indent}Ordered pages in ${dirPath}:`);
      pages.forEach(page => {
        const filePart = page.isDirectory ? page.path.split(path.sep).pop() : page.originalFilename;
        console.log(`${indent}- ${page.title} (${filePart}, order: ${page.order})`);
      });
    }
    
    return pages;
  } catch (error) {
    console.error(`${indent}Error parsing directory: ${error.message}`);
    return [];
  }
}

/**
 * Find attachment directories and add them to the structure
 * @param {Object} pages - Pages structure
 * @param {string} basePath - Base path for finding attachments
 * @returns {Object} Updated pages structure with attachments
 */
async function findAttachmentDirectories(pages, basePath) {
  // Process all pages recursively
  const processPages = async (pageList, currentPath = '') => {
    for (let i = 0; i < pageList.length; i++) {
      const page = pageList[i];
      
      // For each page directory, check if .attachments exists
      if (page.isDirectory && !page.isAttachmentDir) {
        const attachmentPath = path.join(page.path, '.attachments');
        
        if (await fs.pathExists(attachmentPath)) {
          // Add attachments directory as a child of this page
          if (!page.children) {
            page.children = [];
          }
          
          page.children.push({
            title: '.attachments',
            isDirectory: true,
            isAttachmentDir: true,
            path: attachmentPath,
            children: []
          });
        }
        
        // Process children recursively
        if (page.children) {
          await processPages(page.children, path.join(currentPath, page.title));
        }
      }
    }
  };
  
  // Also check for root level .attachments directory
  const rootAttachmentsPath = path.join(basePath, '.attachments');
  if (await fs.pathExists(rootAttachmentsPath)) {
    pages.push({
      title: '.attachments',
      isDirectory: true,
      isAttachmentDir: true,
      path: rootAttachmentsPath,
      children: []
    });
  }
  
  // Process all pages to find attachment directories
  await processPages(pages);
  
  return pages;
}

module.exports = {
  parseWiki,
  parseDirectory,
  findAttachmentDirectories
}; 