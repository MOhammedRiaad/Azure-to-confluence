const fs = require('fs-extra');
const path = require('path');
const { parseWiki } = require('./wikiParser');
const { logger } = require('../utils');


/**
 * Run a local test of the wiki conversion
 * @param {string} wikiRootPath - Path to the Azure DevOps wiki root
 * @param {string} outputPath - Path to save the output
 * @param {Object} options - Options for the conversion
 * @returns {Promise<void>}
 */
async function runLocalTest(wikiRootPath, outputPath, options = {}) {
  logger.info(`Starting local test of wiki conversion...`);
  logger.info(`Wiki source: ${wikiRootPath}`);
  logger.info(`Output path: ${outputPath}`);
  
  // If provided, we'll use wikiRootFolder to locate attachments
  const wikiRootFolder = options.wikiRootFolder || path.dirname(wikiRootPath);
  logger.info(`Wiki root folder (for attachments): ${wikiRootFolder}`);
  
  try {
    // Check if the wiki root path exists
    if (!(await fs.pathExists(wikiRootPath))) {
      throw new Error(`Wiki root path does not exist: ${wikiRootPath}`);
    }
    
    // Create output directory
    await fs.ensureDir(outputPath);
    
    // Clean up previous output if exists
    if (options.clean) {
      logger.info('Cleaning output directory...');
      await fs.emptyDir(outputPath);
    }
    
    // Create index file
    logger.info('Parsing wiki structure...');
    const wikiStructure = await parseWiki(wikiRootPath);
    await createIndexFile(outputPath, wikiStructure);
    
    // Process attachments first - create the attachments folder
    logger.info('Processing attachments...');
    const attachmentsOutputPath = path.join(outputPath, 'attachments');
    await fs.ensureDir(attachmentsOutputPath);
    
    // Process attachments using the correct paths
    // This returns the number of attachments processed, we'll use an empty object for attachmentMappings
    const attachmentCount = await processAttachmentsLocally(wikiRootPath, outputPath, wikiRootFolder);
    
    // Create a simple mapping object to pass to createLocalPages
    const attachmentMappings = {};
    
    logger.info('Creating local pages...');
    await createLocalPages(wikiStructure, outputPath, attachmentMappings);
    
    logger.info('Local test completed successfully!');
    logger.info(`Output saved to: ${outputPath}`);
    logger.info(`Open ${outputPath}\\index.html in your browser to view the preview.`);
  } catch (error) {
    console.error('Error during local test:', error);
    
    // Save error details to a file for easier debugging
    const errorReport = `Error during local test:\n${error.stack}\n`;
    await fs.ensureDir(path.join(outputPath));
    await fs.writeFile(path.join(outputPath, 'error-report.txt'), errorReport);
    
    console.error('Error report saved to:', path.join(outputPath, 'error-report.txt'));
    throw error;
  }
}

/**
 * Filter out project directory and irrelevant items from pages
 * @param {Array} pages - List of pages
 * @returns {Array} Filtered list of pages
 */
function filterOutProjectDir(pages) {
  if (!pages) return [];
  
  return pages.filter(page => {
    // Exclude the project directory itself and node_modules
    const excludedDirs = ['azure-to-confluence', 'node_modules', 'src', 'local-output', 'test-output'];
    return !excludedDirs.includes(page.title);
  }).map(page => {
    // If the page has children, recursively filter them too
    if (page.children && page.children.length > 0) {
      page.children = filterOutProjectDir(page.children);
    }
    return page;
  });
}

/**
 * Generate a hierarchical navigation menu with collapsible sections
 * @param {Array} pages - Pages to include in the menu
 * @param {string} basePath - Base path for links
 * @returns {string} - HTML for the navigation menu
 */
function generateNavMenu(pages, basePath = '') {
  if (!pages || pages.length === 0) return '';
  
  // First, identify and merge pages with same name (directory and file)
  const mergedPages = [];
  const nameMap = {};
  
  // First pass: group by sanitized title
  for (const page of pages) {
    // Skip attachment directories
    if (page.isAttachmentDir) continue;
    
    const sanitizedTitle = sanitizePathSegment(page.title);
    
    if (!nameMap[sanitizedTitle]) {
      nameMap[sanitizedTitle] = {
        dirPage: null,
        filePage: null
      };
    }
    
    if (page.isDirectory) {
      nameMap[sanitizedTitle].dirPage = page;
    } else {
      nameMap[sanitizedTitle].filePage = page;
    }
  }
  
  // Second pass: create merged pages
  for (const sanitizedTitle in nameMap) {
    const { dirPage, filePage } = nameMap[sanitizedTitle];
    
    if (dirPage && filePage) {
      // If both directory and file exist, prefer the directory but use the file's content
      const mergedPage = {
        ...dirPage,
        hasFileContent: true,
        filePath: filePage.path
      };
      mergedPages.push(mergedPage);
    } else if (dirPage) {
      mergedPages.push(dirPage);
    } else if (filePage) {
      mergedPages.push(filePage);
    }
  }
  
  // Sort merged pages
  const sortedPages = [...mergedPages].sort((a, b) => {
    // Sort by order first, then alphabetically by title
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title);
  });
  
  let html = '<ul class="nav-menu">';
  
  for (const page of sortedPages) {
    const sanitizedTitle = sanitizePathSegment(page.title);
    const hasChildren = page.children && page.children.length > 0 && !page.children.every(p => p.isAttachmentDir);
    
    const link = basePath ? 
      `./pages/${path.join(basePath, sanitizedTitle)}/index.html` : 
      `./pages/${sanitizedTitle}/index.html`;
    
    const itemId = `nav-item-${basePath ? basePath.replace(/[\/\\]/g, '-') + '-' : ''}${sanitizedTitle}`;
    
    html += `<li class="nav-item ${hasChildren ? 'has-children' : ''}">
      <div class="nav-item-header">
        ${hasChildren ? `<span class="toggle-icon" data-target="${itemId}">▶</span>` : '<span class="toggle-placeholder"></span>'}
        <a href="${link}">${page.title}</a>
      </div>`;
    
    if (hasChildren) {
      html += `<div id="${itemId}" class="nav-children collapsed">
        ${generateNavMenu(page.children, basePath ? path.join(basePath, sanitizedTitle) : sanitizedTitle)}
      </div>`;
    }
    
    html += '</li>';
  }
  
  html += '</ul>';
  return html;
}

/**
 * Create an index file for the output directory
 * @param {string} outputPath - Path to the output directory
 * @param {Object} wikiStructure - Wiki structure
 * @returns {Promise<void>}
 */
async function createIndexFile(outputPath, wikiStructure) {
  // Generate navigation menu
  const navMenu = generateNavMenu(wikiStructure.pages);
  
  // Create index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Azure Wiki Preview</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background-color: #f5f5f5;
      padding: 10px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    h1 {
      color: #0052cc;
    }
    .container {
      display: flex;
      flex-wrap: wrap;
    }
    .sidebar {
      flex: 1;
      min-width: 250px;
      background-color: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      margin-right: 20px;
      max-height: 80vh;
      overflow-y: auto;
    }
    .content {
      flex: 3;
      min-width: 300px;
    }
    /* Navigation styles */
    .nav-menu {
      padding-left: 0;
      list-style-type: none;
    }
    .nav-menu ul {
      padding-left: 20px;
      list-style-type: none;
    }
    .nav-item {
      margin-bottom: 5px;
    }
    .nav-item-header {
      display: flex;
      align-items: center;
    }
    .toggle-icon, .toggle-placeholder {
      display: inline-block;
      width: 15px;
      margin-right: 5px;
      cursor: pointer;
      font-size: 10px;
      transition: transform 0.2s;
    }
    .toggle-icon.expanded {
      transform: rotate(90deg);
    }
    .nav-children {
      overflow: hidden;
      transition: max-height 0.3s ease-out;
    }
    .nav-children.collapsed {
      max-height: 0;
      display: none;
    }
    .nav-children.expanded {
      max-height: 1000px;
      display: block;
    }
    .nav-item.has-children > .nav-item-header {
      font-weight: bold;
    }
    .nav-item a {
      text-decoration: none;
      color: #0052CC;
    }
    .nav-item a:hover {
      text-decoration: underline;
    }
    .nav-controls {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .nav-button {
      background-color: #0052CC;
      color: white;
      border: none;
      padding: 5px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .nav-button:hover {
      background-color: #003d99;
    }
    .title-with-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <header>
    <h1>Azure Wiki Local Preview</h1>
    <p>This is a local preview of the wiki content generated by the Azure-to-Confluence tool.</p>
  </header>
  
  <div class="container">
    <div class="sidebar">
      <div class="title-with-controls">
        <h2>Pages</h2>
        <div class="nav-controls">
          <button id="expand-all" class="nav-button">Expand All</button>
          <button id="collapse-all" class="nav-button">Collapse All</button>
        </div>
      </div>
      ${navMenu}
    </div>
    <div class="content">
      <h2>Welcome to the Wiki Preview</h2>
      <p>This is a local preview of your Azure DevOps wiki. Select a page from the navigation menu to view its content.</p>
      <h3>Notes:</h3>
      <ul>
        <li>Some attachments may be missing or may not display correctly in the local preview.</li>
        <li>Links to other wiki pages should work within this preview.</li>
        <li>This preview is for verification purposes and may differ slightly from the final Confluence output.</li>
        <li>Click on the triangles (▶) in the navigation menu to expand/collapse sections.</li>
      </ul>
    </div>
  </div>
  
  <script>
    // Add click event to all toggle icons
    document.addEventListener('DOMContentLoaded', function() {
      const toggleIcons = document.querySelectorAll('.toggle-icon');

      toggleIcons.forEach(icon => {
        icon.addEventListener('click', function() {
          const targetId = this.getAttribute('data-target');
          const targetElement = document.getElementById(targetId);

          // Toggle icon and target element classes
          if (this.classList.contains('expanded')) {
            this.classList.remove('expanded');
            targetElement.classList.remove('expanded');
            targetElement.classList.add('collapsed');
            this.textContent = '▶';
          } else {
            this.classList.add('expanded');
            targetElement.classList.remove('collapsed');
            targetElement.classList.add('expanded');
            this.textContent = '▼';
          }
        });
      });

      // Expand all function
      document.getElementById('expand-all').addEventListener('click', function() {
        toggleIcons.forEach(icon => {
          const targetId = icon.getAttribute('data-target');
          const targetElement = document.getElementById(targetId);
          
          icon.classList.add('expanded');
          targetElement.classList.remove('collapsed');
          targetElement.classList.add('expanded');
          icon.textContent = '▼';
        });
      });

      // Collapse all function
      document.getElementById('collapse-all').addEventListener('click', function() {
        toggleIcons.forEach(icon => {
          const targetId = icon.getAttribute('data-target');
          const targetElement = document.getElementById(targetId);
          
          icon.classList.remove('expanded');
          targetElement.classList.remove('expanded');
          targetElement.classList.add('collapsed');
          icon.textContent = '▶';
        });
      });

      // Expand current page's parents based on URL path
      function expandCurrentPage() {
        const path = window.location.pathname;
        if (path.includes('/pages/')) {
          const pathParts = path.split('/pages/')[1].split('/');
          let currentPath = '';
          
          // For each part of the path, expand the corresponding section
          for (let i = 0; i < pathParts.length - 1; i++) {
            if (pathParts[i]) {
              currentPath += (currentPath ? '/' : '') + pathParts[i];
              const navItem = document.querySelector(\`[data-path="\${currentPath}"]\`);
              if (navItem) {
                const toggleIcon = navItem.querySelector('.toggle-icon');
                if (toggleIcon) {
                  const targetId = toggleIcon.getAttribute('data-target');
                  const targetElement = document.getElementById(targetId);
                  
                  toggleIcon.classList.add('expanded');
                  targetElement.classList.remove('collapsed');
                  targetElement.classList.add('expanded');
                  toggleIcon.textContent = '▼';
                }
              }
            }
          }
        }
      }
      
      // Call the function to expand current page's parents
      expandCurrentPage();
    });
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(outputPath, 'index.html'), indexHtml);
}

/**
 * Process attachments locally
 * @param {string} wikiPath - Path to wiki root
 * @param {string} outputPath - Path to save attachments
 * @param {string} wikiRootFolder - Root folder for attachments
 * @returns {Promise<number>} - Number of copied attachment files
 */
async function processAttachmentsLocally(wikiPath, outputPath, wikiRootFolder) {
  logger.info('Processing attachments locally...');
  logger.info(`Wiki path: ${wikiPath}`);
  logger.info(`Output path: ${outputPath}`);
  logger.info(`Wiki root folder: ${wikiRootFolder}`);
  
  // The exact path where the .attachments folder is located
  const attachmentsPath = path.join(process.cwd(), '..', '.attachments');
  logger.info(`Checking for .attachments folder at: ${attachmentsPath}`);
  
  try {
    const attachmentsExists = await fs.stat(attachmentsPath).then(() => true).catch(() => false);
    
    if (attachmentsExists) {
      logger.info(`Found .attachments folder at ${attachmentsPath}`);
      
      // Create the attachments output directory
      const outputAttachmentsPath = path.join(outputPath, 'attachments');
      logger.info(`Creating attachments directory at: ${outputAttachmentsPath}`);
      
      // Make sure the directory exists but is empty
      await fs.emptyDir(outputAttachmentsPath);
      
      const attachmentFiles = await fs.readdir(attachmentsPath);
      logger.info(`Found ${attachmentFiles.length} attachment files to copy`);
      
      // Copy each attachment file to the output directory
      let copiedCount = 0;
      for (const file of attachmentFiles) {
        const sourcePath = path.join(attachmentsPath, file);
        // Fix: Place files directly in the attachments folder, not in a nested subfolder
        const destPath = path.join(outputAttachmentsPath, file);
        
        try {
          await fs.copyFile(sourcePath, destPath);
          copiedCount++;
        } catch (err) {
          console.error(`Error copying file ${file}: ${err.message}`);
        }
      }
      
      logger.info(`Successfully copied ${copiedCount} attachment files to ${outputAttachmentsPath}`);
      
      return copiedCount;
    } else {
      logger.info('No .attachments folder found at the expected location');
      return 0;
    }
  } catch (error) {
    console.error(`Error processing attachments: ${error.message}`);
    return 0;
  }
}

/**
 * Sanitize a path segment (file or directory name) for filesystem compatibility
 * @param {string} segment - Path segment to sanitize
 * @returns {string} - Sanitized path segment
 */
function sanitizePathSegment(segment) {
  if (!segment) return 'unnamed';
  
  // Replace characters that are invalid in Windows filenames
  // Windows doesn't allow: < > : " / \ | ? *
  return segment
    .replace(/[<>:"\/\\|?*]/g, '_')
    .replace(/"/g, "'")
    .replace(/:/g, '-')
    .replace(/\s+/g, '-')
    .trim();
}

/**
 * Sanitizes a string to be used as a path segment
 * @param {string} str - The string to sanitize
 * @returns {string} - The sanitized string
 */
function slugify(str) {
  if (!str) return '';
  
  // Replace spaces with hyphens
  let result = str.replace(/\s+/g, '-');
  
  // Remove special characters and replace them with hyphens
  result = result.replace(/[^a-zA-Z0-9-_]/g, '-');
  
  // Remove multiple consecutive hyphens
  result = result.replace(/-+/g, '-');
  
  // Trim hyphens from beginning and end
  result = result.replace(/^-+|-+$/g, '');
  
  return result;
}

/**
 * Create HTML pages for each wiki page
 * @param {Object} wikiStructure - Wiki structure
 * @param {string} outputPath - Output path
 * @param {Object} attachmentMappings - Attachment mappings
 * @returns {Promise<void>}
 */
async function createLocalPages(wikiStructure, outputPath, attachmentMappings) {
  console.log('Creating local pages...');
  
  // Create output directory
  await fs.ensureDir(outputPath);
  
  // Create pages directory
  const pagesDir = path.join(outputPath, 'pages');
  await fs.ensureDir(pagesDir);

  // First, preprocess pages to merge directories and files with the same name
  const preprocessPages = (pages) => {
    const mergedPages = [];
    const nameMap = {};
    
    // First pass: group by sanitized title
    for (const page of pages) {
      if (page.isAttachmentDir) continue;
      
      const sanitizedTitle = sanitizePathSegment(page.title);
      
      if (!nameMap[sanitizedTitle]) {
        nameMap[sanitizedTitle] = {
          dirPage: null,
          filePage: null
        };
      }
      
      if (page.isDirectory) {
        // If it has children, preprocess them recursively
        if (page.children && page.children.length > 0) {
          page.children = preprocessPages(page.children);
        }
        nameMap[sanitizedTitle].dirPage = page;
      } else {
        nameMap[sanitizedTitle].filePage = page;
      }
    }
    
    // Second pass: create merged pages
    for (const sanitizedTitle in nameMap) {
      const { dirPage, filePage } = nameMap[sanitizedTitle];
      
      if (dirPage && filePage) {
        // If both directory and file exist, prefer the directory but use the file's content
        const mergedPage = {
          ...dirPage,
          hasFileContent: true,
          filePath: filePage.path
        };
        mergedPages.push(mergedPage);
      } else if (dirPage) {
        mergedPages.push(dirPage);
      } else if (filePage) {
        mergedPages.push(filePage);
      }
    }
    
    return mergedPages;
  };
  
  // Preprocess the pages to merge directories and files with same name
  const processedPages = preprocessPages(wikiStructure.pages);

  // Process pages recursively
  const processPages = async (pages, parentPath = '') => {
    console.log(`Processing ${pages.length} pages under parentPath: ${parentPath}`);
    
    for (const page of pages) {
      try {
        if (page.isAttachmentDir) continue; // Skip attachment directories
        
        // Create directory for this page
        const pageDirName = sanitizePathSegment(page.title);
        const pagePath = parentPath ? path.join(parentPath, pageDirName) : pageDirName;
        const pageOutputDir = path.join(pagesDir, pagePath);
        
        console.log(`Creating page: ${page.title} at ${pagePath}`);
        await fs.ensureDir(pageOutputDir);
        
        // If it's a directory with children, process them
        if (page.isDirectory && page.children && page.children.length > 0) {
          // Process children
          const newParentPath = pagePath;
          await processPages(page.children, newParentPath);
          
          // For merged pages, use file content if available
          let content;
          if (page.hasFileContent && page.filePath) {
            try {
              content = await fs.readFile(page.filePath, 'utf8');
            } catch (error) {
              console.warn(`Warning: Could not read file content for merged page at ${page.filePath}`);
              content = page.indexContent || `# ${page.title}\n\nThis is a directory page for ${page.title}.`;
            }
          } else {
            // Get content from indexContent if it exists, or create simple content
            content = page.indexContent;
            if (!content) {
              content = `# ${page.title}\n\nThis is a directory page for ${page.title}.`;
            }
          }
          
          // Convert markdown to HTML
          const html = convertMarkdownToHtml(content, attachmentMappings, page.hasFileContent ? page.filePath : page.path, pagePath);
          
          // Create HTML file
          const htmlContent = createHtmlPage(page.title, html, pagePath);
          await fs.writeFile(path.join(pageOutputDir, 'index.html'), htmlContent);
          
          console.log(`Created page: ${page.title}`);
        } else if (!page.isDirectory) {
          // Read markdown content from file
          let content;
          try {
            // Read the file only if it's not a directory
            content = await fs.readFile(page.path, 'utf8');
          } catch (error) {
            console.warn(`Warning: No markdown content for page at ${page.path}`);
            content = `# ${page.title}\n\nNo content available.`;
          }
          
          try {
            // Convert markdown to HTML with the correct parent path
            const html = convertMarkdownToHtml(content, attachmentMappings, page.path, pagePath);
            
            // Create HTML file
            const htmlContent = createHtmlPage(page.title, html, pagePath);
            await fs.writeFile(path.join(pageOutputDir, 'index.html'), htmlContent);
            
            console.log(`Created page: ${page.title}`);
          } catch (error) {
            console.error(`Error creating local page for ${page.title}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error creating local page for ${page.title}:`, error);
      }
    }
  };
  
  // Start processing from root pages
  await processPages(processedPages);
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
      console.log(`Warning: No markdown content for page at ${pagePath}`);
      return '<p>No content</p>';
    }

    // Define safer, minimal marked usage
    const { marked } = require('marked');
    
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
        
        // Extract filename from path
        const imageFileName = imagePath.split('/').pop().split('\\').pop();
        
        // Clean any URL encoding in the filename
        const cleanFileName = decodeURIComponent(imageFileName);
        
        // Create the path with URL encoding for spaces and special characters
        const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
        
        const dimensionsAttr = dimensions ? ` =${dimensions}` : '';
        return `<img src="${newImagePath}" alt="${altText || cleanFileName}" />`;
      }
    );
    
    // Process wiki-style image links: ![[image.png]]
    processedMarkdown = processedMarkdown.replace(
      /!\[\[([^|\]]+)(?:\|[^\]]*)?]]/g,
      (match, imagePath) => {
        if (!imagePath) return match;
        
        // Extract filename from path
        const imageFileName = imagePath.split('/').pop().split('\\').pop();
        
        // Clean any URL encoding in the filename
        const cleanFileName = decodeURIComponent(imageFileName);
        
        // Create the path with URL encoding for spaces and special characters
        const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
        
        return `<img src="${newImagePath}" alt="${cleanFileName}" />`;
      }
    );
    
    // Process HTML img tags
    processedMarkdown = processedMarkdown.replace(
      /<img[^>]*src=["']([^"']*)["'][^>]*>/g,
      (match, imagePath) => {
        if (!imagePath) return match;
        
        // Check if this is an attachment reference
        const isAttachment = 
          imagePath.includes('.attachments/') || 
          imagePath.includes('/attachments/') || 
          (!imagePath.startsWith('http') && !imagePath.startsWith('data:'));
        
        if (!isAttachment) return match; // Not an attachment, keep as is
        
        // Extract filename from path
        const imageFileName = imagePath.split('/').pop().split('\\').pop();
        
        // Clean any URL encoding in the filename
        const cleanFileName = decodeURIComponent(imageFileName);
        
        // Extract alt text from the original tag if it exists
        const altMatch = match.match(/alt=["']([^"']*)["']/);
        const altText = altMatch ? altMatch[1] : cleanFileName;
        
        // Create the path with URL encoding for spaces and special characters
        const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
        
        return `<img src="${newImagePath}" alt="${altText}" />`;
      }
    );

    // Replace links to other wiki pages
    processedMarkdown = processedMarkdown.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, function(match, text, href) {
      if (!href.includes('.attachment') && !href.includes('/attachments/')) {
        const pageName = path.basename(href);
        // Calculate proper path using normalized path - one level up for each path segment
        const relPathToPage = '../'.repeat(pathDepth);
        return `[${text}](${relPathToPage}${pageName}/index.html)`;
      }
      return match; // Leave attachment links for the previous replacement
    });

    // Use default marked parser with minimal options
    return marked.parse(processedMarkdown, { 
      gfm: true,
      breaks: true,
      sanitize: false 
    });
  } catch (error) {
    console.error('Error converting markdown to HTML:', error);
    // Return basic formatted content in case of error
    return `<p>Error rendering markdown: ${error.message}</p>
            <pre>${markdown ? markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'No content'}</pre>`;
  }
}

/**
 * Create an HTML page with the given content
 * @param {string} title - Page title
 * @param {string} content - HTML content
 * @param {string} parentPath - Path to the parent directory
 * @returns {string} - HTML content for the page
 */
function createHtmlPage(title, content, parentPath) {
  // Calculate the right path to go back to home
  // One level up for each segment in the parentPath
  const pathSegments = parentPath ? parentPath.split('/').filter(Boolean).length : 0;
  const relPathToHome = '../'.repeat(pathSegments + 1); // +1 for /pages/ directory
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Azure Wiki Preview</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background-color: #f5f5f5;
      padding: 10px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    nav {
      background-color: #f0f0f0;
      padding: 10px;
      margin-bottom: 20px;
      border-radius: 5px;
    }
    h1 {
      color: #0052cc;
    }
    .content {
      background-color: #fff;
      padding: 15px;
      border-radius: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    /* Code and pre styles */
    code {
      background-color: #f8f8f8;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: Consolas, Monaco, 'Andale Mono', monospace;
    }
    pre {
      background-color: #f8f8f8;
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
      font-family: Consolas, Monaco, 'Andale Mono', monospace;
    }
    /* Table styles */
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 15px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
    }
    th {
      background-color: #f2f2f2;
      font-weight: bold;
    }
    tr:nth-child(even) {
      background-color: #f5f5f5;
    }
    /* Image styles */
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 15px 0;
      border-radius: 3px;
    }
    /* Link styles */
    a {
      color: #0052cc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    /* Breadcrumb styles */
    .breadcrumbs {
      list-style: none;
      padding: 0;
      margin: 0 0 10px 0;
    }
    .breadcrumbs li {
      display: inline;
    }
    .breadcrumbs li:not(:last-child)::after {
      content: " > ";
      color: #666;
    }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
  </header>
  <nav>
    <ul class="breadcrumbs">
      <li><a href="${relPathToHome}index.html">Home</a></li>
      ${generateBreadcrumbs(parentPath)}
    </ul>
  </nav>
  <div class="content">
    ${content}
  </div>
</body>
</html>`;
}

/**
 * Generate breadcrumbs for the page
 * @param {string} path - Path to the page
 * @returns {string} - HTML for breadcrumbs
 */
function generateBreadcrumbs(path) {
  if (!path) return '';
  
  const parts = path.split('/').filter(Boolean);
  let currentPath = '';
  let breadcrumbs = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    
    // Calculate path for this breadcrumb
    currentPath += (i > 0 ? '/' : '') + part;
    
    // Calculate relative path to the breadcrumb page
    // Need to go up one level per remaining segment after this one
    const relativePath = '../'.repeat(parts.length - i);
    
    // Add breadcrumb
    if (isLast) {
      breadcrumbs += `<li>${part}</li>`;
    } else {
      breadcrumbs += `<li><a href="${relativePath}index.html">${part}</a></li>`;
    }
  }
  
  return breadcrumbs;
}

module.exports = {
  runLocalTest
}; 