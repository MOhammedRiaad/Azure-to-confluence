const fs = require('fs-extra');
const path = require('path');
const marked = require('marked');
const { parseWiki } = require('./confluence/wikiParser');
const { logger } = require('./utils');

/**
 * Run a local test of the wiki conversion
 * @param {string} wikiRootPath - Path to the Azure DevOps wiki root
 * @param {string} outputPath - Path to save the output
 * @param {Object} options - Options for the conversion
 * @returns {Promise<void>}
 */
async function runLocalTest(wikiRootPath, outputPath, options = {}) {
  try {
    logger.info('Starting local test...');
    logger.info(`Wiki root path: ${wikiRootPath}`);
    logger.info(`Output path: ${outputPath}`);

    // Ensure paths exist
    if (!await fs.pathExists(wikiRootPath)) {
      throw new Error(`Wiki root path does not exist: ${wikiRootPath}`);
    }

    // Clean and create output directory
    await fs.ensureDir(outputPath);
    if (options.clean) {
      logger.info('Cleaning output directory...');
      await fs.emptyDir(outputPath);
    }

    // Parse wiki structure
    logger.info('Parsing wiki structure...');
    const wikiStructure = await parseWiki(wikiRootPath);
    logger.info(`Found ${wikiStructure.pages.length} root pages`);

    // Create local pages
    logger.info('Creating local pages...');
    await createLocalPages(wikiStructure, outputPath, {});

    // Process attachments
    logger.info('Processing attachments...');
    const attachmentCount = await processAttachmentsLocally(wikiRootPath, outputPath, path.basename(wikiRootPath));
    logger.info(`Processed ${attachmentCount} attachments`);

    // Create index file
    logger.info('Creating index file...');
    await createIndexFile(outputPath, wikiStructure);

    logger.info('Local test completed successfully!');
    logger.info(`Output saved to: ${outputPath}`);
    
  } catch (error) {
    logger.error('Error during local test:', error);
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
    
    // Decode the original title for display purposes
    const displayTitle = decodeURIComponent(page.title);
    
    const link = basePath ? 
      `./pages/${path.join(basePath, sanitizedTitle)}/index.html` : 
      `./pages/${sanitizedTitle}/index.html`;
    
    const itemId = `nav-item-${basePath ? basePath.replace(/[\/\\]/g, '-') + '-' : ''}${sanitizedTitle}`;
    
    html += `<li class="nav-item ${hasChildren ? 'has-children' : ''}">
      <div class="nav-item-header">
        ${hasChildren ? `<span class="toggle-icon" data-target="${itemId}">▶</span>` : '<span class="toggle-placeholder"></span>'}
        <a href="${link}">${displayTitle}</a>
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
  console.log('Processing attachments locally...');
  
  try {
    // Log initial parameters for debugging
    console.log(`Wiki path: ${wikiPath}`);
    console.log(`Output path: ${outputPath}`);
    console.log(`Wiki root folder: ${wikiRootFolder}`);
    
    // Calculate possible attachment paths
    const possibleAttachmentPaths = [
      // Common attachment locations
      path.join(process.cwd(), '..', '.attachments'),
      path.join(wikiPath, '.attachments'),
      path.join(wikiPath, 'attachments'),
      path.join(wikiPath, '..', '.attachments'),
      path.join(wikiPath, '..', 'attachments')
    ];
    
    // Find the first existing attachment directory
    let attachmentsPath = null;
    for (const potentialPath of possibleAttachmentPaths) {
      console.log(`Checking for attachments at: ${potentialPath}`);
      try {
        const exists = await fs.pathExists(potentialPath);
        if (exists) {
          const stats = await fs.stat(potentialPath);
          if (stats.isDirectory()) {
            attachmentsPath = potentialPath;
            console.log(`Found attachments directory at: ${attachmentsPath}`);
            break;
          }
        }
      } catch (checkError) {
        console.log(`Error checking path ${potentialPath}: ${checkError.message}`);
      }
    }
    
    if (!attachmentsPath) {
      console.warn('No attachments directory found at any of the expected locations');
      return 0;
    }
    
    // Create the attachments output directory
    const outputAttachmentsPath = path.join(outputPath, 'attachments');
    console.log(`Creating attachments directory at: ${outputAttachmentsPath}`);
    
    // Make sure the directory exists but is empty
    await fs.ensureDir(outputAttachmentsPath);
    
    // Read all files in the attachments directory
    const attachmentFiles = await fs.readdir(attachmentsPath);
    console.log(`Found ${attachmentFiles.length} attachment files to copy`);
    
    // Process attachments in batches to avoid overwhelming the file system
    const batchSize = 20;
    let copiedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < attachmentFiles.length; i += batchSize) {
      const batch = attachmentFiles.slice(i, i + batchSize);
      const copyPromises = batch.map(async (file) => {
        const sourcePath = path.join(attachmentsPath, file);
        const destPath = path.join(outputAttachmentsPath, file);
        
        try {
          // Check if this is a file (not a directory)
          const stats = await fs.stat(sourcePath);
          if (stats.isFile()) {
            await fs.copyFile(sourcePath, destPath);
            return { success: true, file };
          } else {
            console.log(`Skipping directory: ${file}`);
            return { success: true, file, skipped: true };
          }
        } catch (err) {
          console.error(`Error copying file ${file}: ${err.message}`);
          return { success: false, file, error: err.message };
        }
      });
      
      const results = await Promise.all(copyPromises);
      
      // Track successes and failures
      const successfulCopies = results.filter(r => r.success && !r.skipped);
      const failures = results.filter(r => !r.success);
      
      copiedCount += successfulCopies.length;
      errorCount += failures.length;
      
      // Log batch progress
      if (batch.length > 5) {
        console.log(`Processed ${i + batch.length}/${attachmentFiles.length} attachments (${copiedCount} copied, ${errorCount} errors)`);
      }
    }
    
    console.log(`Successfully copied ${copiedCount} attachment files to ${outputAttachmentsPath}`);
    if (errorCount > 0) {
      console.warn(`Failed to copy ${errorCount} attachment files`);
    }
    
    return copiedCount;
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
  
  // First trim any leading/trailing whitespace
  let sanitized = segment.trim();
  
  // Define character sets for different handling:
  // 1. Problematic chars: Characters that are invalid in filesystems (Windows, macOS, Linux)
  // 2. Special chars: Characters that are valid but might cause issues in URLs and should be encoded
  const problematicChars = /[<>:\/\\|?*]/g;
  const specialChars = /["'!@#$%^&()=+{}[\]]/g;
  
  // First replace truly invalid filesystem characters with underscores
  sanitized = sanitized.replace(problematicChars, '_');
  
  // Then URL encode special characters to preserve them in the path
  // This allows for better readability in URLs while maintaining compatibility
  sanitized = sanitized.replace(specialChars, (match) => {
    return encodeURIComponent(match);
  });
  
  // Replace spaces with dashes for better URL readability
  sanitized = sanitized.replace(/\s+/g, '-');
  
  // For filesystem compatibility, avoid trailing dots or spaces which can cause issues
  sanitized = sanitized.replace(/[. ]+$/, '');
  
  // If a filename is too long, truncate it (240 is a safe limit across filesystems)
  // We use 240 instead of 255 to leave room for extensions and path separators
  if (sanitized.length > 240) {
    sanitized = sanitized.substring(0, 240);
  }
  
  return sanitized;
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
  
  try {
    // Create pages directory
    const pagesDir = path.join(outputPath, 'pages');
    await fs.ensureDir(pagesDir);
  
    // Recursive function to process pages
    async function processPage(page, currentPath = '') {
      try {
        // Skip attachment directories
        if (page.isAttachmentDir) {
          return;
        }
  
        // Check for required page properties
        if (!page || !page.title) {
          console.warn('Skipping invalid page object:', page);
          return;
        }
  
        // Preserve original title for display but sanitize for file system
        const originalTitle = page.title;
        const pageDirName = sanitizePathSegment(originalTitle);
        const pagePath = path.join(pagesDir, currentPath, pageDirName);
        
        console.log(`Creating directory for page: ${pagePath}`);
        console.log(`Original title: ${originalTitle}, Sanitized directory name: ${pageDirName}`);
        
        try {
          await fs.ensureDir(pagePath);
        } catch (dirError) {
          console.error(`Failed to create directory for page "${originalTitle}":`, dirError);
          throw new Error(`Directory creation failed for "${pagePath}": ${dirError.message}`);
        }
  
        // Get page content
        let content = '';
        if (page.path && !page.isDirectory) {
          try {
            content = await fs.readFile(page.path, 'utf8');
            console.log(`Read content from: ${page.path}`);
          } catch (readError) {
            console.warn(`Could not read file: ${page.path}`, readError);
            // Provide fallback content when file reading fails
            content = `# ${originalTitle}\n\nNo content available. Error: ${readError.message}`;
          }
        } else if (page.isDirectory) {
          content = `# ${originalTitle}\n\nThis is a directory page.`;
        }
  
        // Store title mapping for linking purposes
        page.sanitizedTitle = pageDirName;
  
        // Convert content to HTML - wrap in try/catch to ensure one page failure doesn't stop the process
        let html;
        try {
          html = convertMarkdownToHtml(content, attachmentMappings, page.path, currentPath);
        } catch (convertError) {
          console.error(`Error converting markdown to HTML for page "${originalTitle}":`, convertError);
          html = `<h1>${originalTitle}</h1><p>Error converting content: ${convertError.message}</p>`;
        }
        
        // Create index.html with original title for display
        const htmlContent = createHtmlPage(originalTitle, html, currentPath);
        const indexPath = path.join(pagePath, 'index.html');
        
        try {
          console.log(`Writing page to: ${indexPath}`);
          await fs.writeFile(indexPath, htmlContent);
        } catch (writeError) {
          console.error(`Failed to write HTML file for page "${originalTitle}":`, writeError);
          throw new Error(`File write failed for "${indexPath}": ${writeError.message}`);
        }
  
        // Process child pages with the updated path
        const nextPath = currentPath ? `${currentPath}/${pageDirName}` : pageDirName;
        if (page.children && page.children.length > 0) {
          for (const childPage of page.children) {
            // Process each child page sequentially to avoid overwhelming the file system
            // Any error in child pages won't stop processing other children
            try {
              await processPage(childPage, nextPath);
            } catch (childError) {
              console.error(`Error processing child page "${childPage.title}" of "${originalTitle}":`, childError);
              // Continue with other children
            }
          }
        }
      } catch (pageError) {
        // Handle page-level errors and rethrow with context
        console.error(`Error processing page: ${page?.title || 'unknown'}`, pageError);
        throw new Error(`Failed to process page "${page?.title || 'unknown'}": ${pageError.message}`);
      }
    }
  
    // Make sure we handle both array and object with pages property
    let pagesToProcess = [];
    if (Array.isArray(wikiStructure)) {
      pagesToProcess = wikiStructure;
    } else if (wikiStructure && wikiStructure.pages && Array.isArray(wikiStructure.pages)) {
      pagesToProcess = wikiStructure.pages;
    } else {
      const structureError = new Error('Invalid wiki structure format. Expected an array of pages or an object with a pages property.');
      console.error(structureError);
      throw structureError;
    }
  
    // Process all root level pages - try to complete as many as possible
    const errors = [];
    for (const page of pagesToProcess) {
      try {
        await processPage(page);
      } catch (rootPageError) {
        // Collect errors but continue processing other pages
        errors.push({
          page: page.title || 'unknown',
          error: rootPageError.message
        });
        console.error(`Error processing root page "${page.title || 'unknown'}":`, rootPageError);
      }
    }
  
    // Report any errors at the end
    if (errors.length > 0) {
      console.warn(`Created local pages with ${errors.length} errors:`, errors);
    } else {
      console.log('All local pages created successfully.');
    }
  } catch (globalError) {
    console.error('Fatal error in createLocalPages:', globalError);
    throw new Error(`Failed to create local pages: ${globalError.message}`);
  }
}

/**
 * Process markdown image references with format: ![alt text](path/to/image.png)
 * @param {string} markdown - Markdown content
 * @param {string} pathToAttachments - Path to attachments directory
 * @returns {string} - Processed markdown with updated image paths
 */
function processMarkdownImages(markdown, pathToAttachments) {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)(?:\s*=\s*([0-9x]+))?\)/g,
    (match, altText, imagePath, dimensions) => {
      if (!imagePath) return match;
      
      // Debug logging
      console.log(`Processing image reference: ${match}`);
      console.log(`  Alt text: ${altText}`);
      console.log(`  Original image path: ${imagePath}`);
      
      // Normalize the path by trimming whitespace
      const normalizedPath = imagePath.trim();
      
      // Check if this is an attachment reference
      const isAttachment = 
        normalizedPath.includes('.attachments/') || 
        normalizedPath.includes('/attachments/') || 
        normalizedPath.startsWith('../') || 
        (!normalizedPath.startsWith('http') && !normalizedPath.startsWith('data:'));
      
      if (!isAttachment) {
        console.log(`  Not an attachment, keeping original: ${normalizedPath}`);
        return match; // Not an attachment, keep as is
      }
      
      // Extract filename from path
      const imageFileName = normalizedPath.split('/').pop().split('\\').pop();
      
      // Clean any URL encoding in the filename
      const cleanFileName = decodeURIComponent(imageFileName);
      
      // Create the path with URL encoding for spaces and special characters
      const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
      
      console.log(`  Converted image path: ${newImagePath}`);
      
      const dimensionsAttr = dimensions ? ` width="${dimensions.split('x')[0]}" height="${dimensions.split('x')[1] || 'auto'}"` : '';
      return `<img src="${newImagePath}" alt="${altText || cleanFileName}"${dimensionsAttr} style="max-width: 100%;" />`;
    }
  );
}

/**
 * Process wiki-style image references with format: ![[image.png]]
 * @param {string} markdown - Markdown content
 * @param {string} pathToAttachments - Path to attachments directory
 * @returns {string} - Processed markdown with updated image paths
 */
function processWikiStyleImages(markdown, pathToAttachments) {
  return markdown.replace(
    /!\[\[([^|\]]+)(?:\|[^\]]*)?]]/g,
    (match, imagePath) => {
      if (!imagePath) return match;
      
      console.log(`Processing wiki-style image: ${match}`);
      console.log(`  Image path: ${imagePath}`);
      
      // Extract filename from path
      const imageFileName = imagePath.split('/').pop().split('\\').pop();
      
      // Clean any URL encoding in the filename
      const cleanFileName = decodeURIComponent(imageFileName);
      
      // Create the path with URL encoding for spaces and special characters
      const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
      
      console.log(`  Converted wiki-style image path: ${newImagePath}`);
      
      return `<img src="${newImagePath}" alt="${cleanFileName}" style="max-width: 100%;" />`;
    }
  );
}

/**
 * Process HTML image tags
 * @param {string} markdown - Markdown content containing HTML img tags
 * @param {string} pathToAttachments - Path to attachments directory
 * @returns {string} - Processed markdown with updated image paths in HTML tags
 */
function processHtmlImageTags(markdown, pathToAttachments) {
  return markdown.replace(
    /<img[^>]*src=["']([^"']*)["'][^>]*>/g,
    (match, imagePath) => {
      if (!imagePath) return match;
      
      console.log(`Processing HTML img tag: ${match.substring(0, 50)}...`);
      console.log(`  Src attribute: ${imagePath}`);
      
      // Check if this is an attachment reference
      const isAttachment = 
        imagePath.includes('.attachments/') || 
        imagePath.includes('/attachments/') || 
        imagePath.startsWith('../') || 
        (!imagePath.startsWith('http') && !imagePath.startsWith('data:'));
      
      if (!isAttachment) {
        console.log(`  Not an attachment, keeping original HTML img tag`);
        return match; // Not an attachment, keep as is
      }
      
      // Extract filename from path
      const imageFileName = imagePath.split('/').pop().split('\\').pop();
      
      // Clean any URL encoding in the filename
      const cleanFileName = decodeURIComponent(imageFileName);
      
      // Extract alt text from the original tag if it exists
      const altMatch = match.match(/alt=["']([^"']*)["']/);
      const altText = altMatch ? altMatch[1] : cleanFileName;
      
      // Create the path with URL encoding for spaces and special characters
      const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
      
      console.log(`  Converted HTML img path: ${newImagePath}`);
      
      // Preserve any width/height attributes from the original tag
      const widthMatch = match.match(/width=["']([^"']*)["']/);
      const heightMatch = match.match(/height=["']([^"']*)["']/);
      const widthAttr = widthMatch ? ` width="${widthMatch[1]}"` : '';
      const heightAttr = heightMatch ? ` height="${heightMatch[1]}"` : '';
      
      return `<img src="${newImagePath}" alt="${altText}"${widthAttr}${heightAttr} style="max-width: 100%;" />`;
    }
  );
}

/**
 * Process wiki page links
 * @param {string} markdown - Markdown content
 * @param {number} pathDepth - Depth of the current path
 * @returns {string} - Processed markdown with updated page links
 */
function processWikiPageLinks(markdown, pathDepth) {
  return markdown.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, function(match, text, href) {
    if (!href.includes('.attachment') && !href.includes('/attachments/')) {
      const pageName = path.basename(href);
      // URL encode the page name for the link, but keep original text
      const encodedPageName = encodeURIComponent(pageName).replace(/%20/g, ' '); // Keep spaces readable
      
      // Calculate proper path using normalized path - one level up for each path segment
      const relPathToPage = '../'.repeat(pathDepth);
      return `[${text}](${relPathToPage}${encodedPageName}/index.html)`;
    }
    return match; // Leave attachment links for the previous replacement
  });
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

    // Process all types of images
    processedMarkdown = processMarkdownImages(processedMarkdown, pathToAttachments);
    processedMarkdown = processWikiStyleImages(processedMarkdown, pathToAttachments);
    processedMarkdown = processHtmlImageTags(processedMarkdown, pathToAttachments);
    
    // Process wiki page links
    processedMarkdown = processWikiPageLinks(processedMarkdown, pathDepth);

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
 * Get the CSS styles for HTML pages
 * @returns {string} - CSS styles for HTML pages
 */
function getPageStyles() {
  return `
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
  `;
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
  
  // Decode any URL-encoded characters in the title for display
  const decodedTitle = decodeURIComponent(title);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${decodedTitle} - Azure Wiki Preview</title>
  <style>${getPageStyles()}</style>
</head>
<body>
  <header>
    <h1>${decodedTitle}</h1>
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
 * Generate HTML for breadcrumbs
 * @param {string} path - Path string
 * @returns {string} - HTML for breadcrumbs
 */
function generateBreadcrumbs(path) {
  if (!path) return '';
  
  // Split the path and filter out empty parts
  const parts = path.split('/').filter(Boolean);
  let breadcrumbHtml = '';
  let currentPath = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    
    // Build up the relative path
    if (currentPath) {
      currentPath += '/' + part;
    } else {
      currentPath = part;
    }
    
    // Calculate the relative path to the page
    // We need to go up one level for each remaining segment after this one
    const remainingSegments = parts.length - i;
    const relativePath = '../'.repeat(remainingSegments);
    
    // URL-encode the path for the link, but display the original text with all special characters
    // First decode any already encoded characters in the part
    const decodedPart = decodeURIComponent(part);
    // Replace dashes with spaces for display, but only if they were used for space replacement
    const displayText = decodedPart.replace(/(?<=[a-zA-Z0-9])-(?=[a-zA-Z0-9])/g, ' ');
    // Ensure path is properly encoded for the URL
    const encodedPath = encodeURIComponent(part);
    
    if (isLast) {
      // Last breadcrumb doesn't need a link
      breadcrumbHtml += `<li>${displayText}</li>`;
    } else {
      breadcrumbHtml += `<li><a href="${relativePath}${encodedPath}/index.html">${displayText}</a></li>`;
    }
  }
  
  return breadcrumbHtml;
}

module.exports = {
  runLocalTest
};