const fs = require('fs-extra');
const path = require('path');
const { parseWiki } = require('./utils/wikiParser');
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
 * @param {string} parentId - Parent ID for CSS targeting
 * @returns {string} - HTML for the navigation menu
 */
function generateNavMenu(pages, parentId = '') {
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return '';
  }
  
  // Process pages to merge directories and content pages with the same name
  const processedPages = [];
  const nameMap = {};
  
  // First group pages by sanitized title to avoid duplicates
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
      nameMap[sanitizedTitle].dirPage = page;
    } else {
      nameMap[sanitizedTitle].filePage = page;
    }
  }
  
  // Create merged pages to eliminate duplicates
  for (const sanitizedTitle in nameMap) {
    const { dirPage, filePage } = nameMap[sanitizedTitle];
    
    if (dirPage && filePage) {
      // If both directory and file exist, merge them
      processedPages.push({
        ...dirPage,
        hasFileContent: true,
        title: dirPage.title, // Use only one title
        path: filePage.path
      });
    } else if (dirPage) {
      processedPages.push(dirPage);
    } else if (filePage) {
      processedPages.push(filePage);
    }
  }
  
  // Sort pages
  processedPages.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    return a.title.localeCompare(b.title);
  });
  
  let menu = '<ul class="nav-menu">';
  
  // Track paths to avoid duplicates
  const pathTracker = new Set();
  
  for (let i = 0; i < processedPages.length; i++) {
    const page = processedPages[i];
    const itemId = parentId ? `${parentId}-${i}` : `item-${i}`;
    const childrenId = `children-${itemId}`;
    const sanitizedTitle = sanitizePathSegment(page.title);
    
    menu += '<li class="nav-item">';
    
    if (page.isDirectory) {
      // Directory
      menu += `<div class="nav-item-header">`;
      
      if (page.children && page.children.length > 0) {
        menu += `<span class="toggle-icon" data-target="${childrenId}">▶</span>`;
      } else {
        menu += `<span class="toggle-placeholder">📁</span>`;
      }
      
      // Store the page path in data attribute
      menu += `<a href="javascript:void(0);" class="nav-link" data-page-path="${sanitizedTitle}" onclick="navigateToPage(this)">${page.title}</a>`;
      menu += `</div>`;
      
      if (page.children && page.children.length > 0) {
        // Generate submenu with this page as the parent path
        const childrenMenu = generateNavMenuChildren(page.children, itemId, sanitizedTitle);
        menu += `<div id="${childrenId}" class="nav-children collapsed">${childrenMenu}</div>`;
      }
    } else {
      // Regular page - just use the sanitized title as the path
      menu += `<div class="nav-item-header">
        <span class="toggle-placeholder">📄</span>
        <a href="javascript:void(0);" class="nav-link" data-page-path="${sanitizedTitle}" onclick="navigateToPage(this)">${page.title}</a>
      </div>`;
    }
    
    menu += '</li>';
  }
  
  menu += '</ul>';
  
  // Add navigation script to the first call (root menu only)
  if (!parentId) {
    menu += `
    <script>
      // Improved navigation function that works with relative paths
      function navigateToPage(linkElement) {
        const pagePath = linkElement.getAttribute('data-page-path');
        if (pagePath) {
          // Get the root path (path to the site root)
          let rootPath = '';
          
          // Determine the root path based on current URL
          const currentPath = window.location.pathname;
          console.log('Current path:', currentPath);
          
          // Find path up to local-output directory
          if (currentPath.includes('local-output')) {
            const pathParts = currentPath.split('local-output');
            rootPath = pathParts[0] + 'local-output/';
          } else {
            // Fallback - use current directory
            rootPath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            // Navigate up to find the root
            rootPath = rootPath.substring(0, rootPath.lastIndexOf('pages/')) || rootPath;
          }
          
          console.log('Root path:', rootPath);
          console.log('Page path:', pagePath);
          
          // Always construct the URL from the root path to avoid path concatenation issues
          const pageUrl = rootPath + 'pages/' + pagePath + '/index.html';
          console.log('Navigating to:', pageUrl);
          window.location.href = pageUrl;
        }
      }
    </script>`;
  }
  
  return menu;
}

/**
 * Helper function to generate submenu items for child pages
 * @param {Array} pages - Child pages
 * @param {string} parentId - Parent ID for CSS targeting
 * @param {string} parentPath - Path of the parent page 
 * @returns {string} - HTML for the submenu
 */
function generateNavMenuChildren(pages, parentId, parentPath) {
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return '';
  }
  
  let menu = '<ul class="nav-menu">';
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.isAttachmentDir) continue;
    
    const itemId = `${parentId}-${i}`;
    const childrenId = `children-${itemId}`;
    const sanitizedTitle = sanitizePathSegment(page.title);
    
    // Create the path with the parent path included
    const pagePath = `${parentPath}/${sanitizedTitle}`;
    
    menu += '<li class="nav-item">';
    
    if (page.isDirectory) {
      // Directory
      menu += `<div class="nav-item-header">`;
      
      if (page.children && page.children.length > 0) {
        menu += `<span class="toggle-icon" data-target="${childrenId}">▶</span>`;
      } else {
        menu += `<span class="toggle-placeholder">📁</span>`;
      }
      
      // Store the full path in data attribute
      menu += `<a href="javascript:void(0);" class="nav-link" data-page-path="${pagePath}" onclick="navigateToPage(this)">${page.title}</a>`;
      menu += `</div>`;
      
      if (page.children && page.children.length > 0) {
        // Recursively process children
        const childrenMenu = generateNavMenuChildren(page.children, itemId, pagePath);
        menu += `<div id="${childrenId}" class="nav-children collapsed">${childrenMenu}</div>`;
      }
    } else {
      // Regular page
      menu += `<div class="nav-item-header">
        <span class="toggle-placeholder">📄</span>
        <a href="javascript:void(0);" class="nav-link" data-page-path="${pagePath}" onclick="navigateToPage(this)">${page.title}</a>
      </div>`;
    }
    
    menu += '</li>';
  }
  
  menu += '</ul>';
  return menu;
}

/**
 * Create an index file for the output directory
 * @param {string} outputPath - Path to the output directory
 * @param {Object} wikiStructure - Wiki structure
 * @returns {Promise<void>}
 */
async function createIndexFile(outputPath, wikiStructure) {
  // For the index file, pathToRoot is the current directory
  const pathToRoot = './';
  
  // Generate navigation menu
  const navMenu = generateNavMenu(wikiStructure.pages);
  
  // Get actual attachment count
  let attachmentCount = countAttachments(wikiStructure);
  
  // Double check with the file system
  const attachmentsPath = path.join(outputPath, 'attachments');
  try {
    if (await fs.pathExists(attachmentsPath)) {
      const files = await fs.readdir(attachmentsPath);
      // If file system count is available, use it instead
      if (files && files.length > 0) {
        attachmentCount = files.length;
      }
    }
  } catch (error) {
    console.error('Error counting attachments from file system:', error);
    // Fall back to the structure-based count
  }
  
  // Create index.html with a modern, responsive design
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wiki Preview</title>
  
  <!-- Dynamic CSS loading script -->
  <script>
    // Function to dynamically load the stylesheet with the correct path
    function loadStylesheet() {
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
      
      // Also load other required stylesheets
      const fontAwesome = document.createElement('link');
      fontAwesome.rel = 'stylesheet';
      fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
      document.head.appendChild(fontAwesome);
      
      const highlightCSS = document.createElement('link');
      highlightCSS.rel = 'stylesheet';
      highlightCSS.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css';
      document.head.appendChild(highlightCSS);
    }
    
    // Load the stylesheet immediately
    loadStylesheet();
  </script>
  
  <!-- Fallback stylesheet link (the dynamic loader above will take precedence) -->
  <link rel="stylesheet" href="${pathToRoot}styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
  <script>
  // Improved navigation function that works with relative paths
  function navigateToPage(linkElement) {
    const pagePath = linkElement.getAttribute('data-page-path');
    if (pagePath) {
      // Get the root path (path to the site root)
      let rootPath = '';
      
      // Determine the root path based on current URL
      const currentPath = window.location.pathname;
      console.log('Current path:', currentPath);
      
      // Find path up to local-output directory
      if (currentPath.includes('local-output')) {
        const pathParts = currentPath.split('local-output');
        rootPath = pathParts[0] + 'local-output/';
      } else {
        // Fallback - use current directory
        rootPath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        // Navigate up to find the root
        rootPath = rootPath.substring(0, rootPath.lastIndexOf('pages/')) || rootPath;
      }
      
      console.log('Root path:', rootPath);
      console.log('Page path:', pagePath);
      
      // Always construct the URL from the root path to avoid path concatenation issues
      const pageUrl = rootPath + 'pages/' + pagePath + '/index.html';
      console.log('Navigating to:', pageUrl);
      window.location.href = pageUrl;
    }
  }
  </script>
</head>
<body>
  <div class="wiki-container">
    <header>
      <div class="header-content">
        <div class="logo">
         <a href="${pathToRoot}index.html">
          <i class="fas fa-book"></i>
          <h1>Wiki Documentation</h1>
         </a>
        </div>
        <div class="header-actions">
          <button id="theme-toggle" class="theme-toggle">
            <i class="fas fa-moon"></i>
          </button>
          <button id="menu-toggle" class="menu-toggle">
            <i class="fas fa-bars"></i>
          </button>
        </div>
      </div>
    </header>

    <div class="main-container">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <h2>Navigation</h2>
          <div class="search-container">
            <input type="text" id="search-input" placeholder="Search pages...">
            <button id="search-button"><i class="fas fa-search"></i></button>
          </div>
        </div>
        <nav class="navigation">
          ${navMenu}
        </nav>
      </aside>

      <main class="content">
        <div class="welcome-container">
          <h2>Welcome to the Wiki Preview</h2>
          <p>This is a local preview of your wiki pages. Use the navigation menu to explore the content.</p>
          
          <div class="stats-panel">
            <div class="stat-item">
              <i class="fas fa-file-alt"></i>
              <div class="stat-info">
                <span class="stat-count">${countPages(wikiStructure.pages)}</span>
                <span class="stat-label">Pages</span>
              </div>
            </div>
            <div class="stat-item">
              <i class="fas fa-folder"></i>
              <div class="stat-info">
                <span class="stat-count">${countDirectories(wikiStructure.pages)}</span>
                <span class="stat-label">Directories</span>
              </div>
            </div>
            <div class="stat-item">
              <i class="fas fa-image"></i>
              <div class="stat-info">
                <span class="stat-count">${attachmentCount}</span>
                <span class="stat-label">Attachments</span>
              </div>
            </div>
          </div>
          
          <h3>Getting Started</h3>
          <p>Click on any page in the navigation menu to view its content. The pages are rendered with proper formatting, including:</p>
          <ul>
            <li>Markdown syntax</li>
            <li>Code blocks with syntax highlighting</li>
            <li>Images and other attachments</li>
            <li>Links to other pages</li>
          </ul>
          
          <div class="quick-links">
            <h3>Top Pages</h3>
            <div class="link-grid">
              ${generateTopPages(wikiStructure.pages)}
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
  
  <script>
    // Initialize syntax highlighting
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
      
      // Add copy buttons to code blocks
      document.querySelectorAll('pre').forEach((block) => {
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.innerHTML = '<i class="fas fa-copy"></i>';
        copyButton.title = 'Copy to clipboard';
        
        copyButton.addEventListener('click', function() {
          const code = block.querySelector('code').innerText;
          navigator.clipboard.writeText(code).then(function() {
            copyButton.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(function() {
              copyButton.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2000);
          });
        });
        
        block.classList.add('code-block-wrapper');
        block.prepend(copyButton);
      });
      
      // Add image zoom functionality
      document.querySelectorAll('.page-body img').forEach((img) => {
        img.addEventListener('click', function() {
          this.classList.toggle('zoomed');
        });
      });
    });
    
    // Toggle sidebar on mobile
    document.getElementById('menu-toggle').addEventListener('click', function() {
      document.getElementById('sidebar').classList.toggle('active');
    });
    
    // Toggle dark/light theme
    document.getElementById('theme-toggle').addEventListener('click', function() {
      document.body.classList.toggle('dark-theme');
      
      // Update highlight.js theme
      const hlTheme = document.querySelector('link[href*="highlight.js"]');
      if (document.body.classList.contains('dark-theme')) {
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css';
        this.querySelector('i').classList.remove('fa-moon');
        this.querySelector('i').classList.add('fa-sun');
      } else {
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css';
        this.querySelector('i').classList.remove('fa-sun');
        this.querySelector('i').classList.add('fa-moon');
      }
      
      // Save preference
      localStorage.setItem('dark-theme', document.body.classList.contains('dark-theme'));
    });
    
    // Toggle navigation items
    document.querySelectorAll('.toggle-icon').forEach(function(icon) {
      icon.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const target = document.getElementById(targetId);
        target.classList.toggle('collapsed');
        
        // Change toggle icon
        if (this.textContent === '▶') {
          this.textContent = '▼';
        } else {
          this.textContent = '▶';
        }
      });
    });
    
    // Expand page view (hide sidebar)
    document.getElementById('expand-page').addEventListener('click', function() {
      document.body.classList.toggle('expanded-view');
      
      const icon = this.querySelector('i');
      if (icon.classList.contains('fa-expand')) {
        icon.classList.remove('fa-expand');
        icon.classList.add('fa-compress');
      } else {
        icon.classList.remove('fa-compress');
        icon.classList.add('fa-expand');
      }
    });
    
    // Print page
    document.getElementById('print-page').addEventListener('click', function() {
      window.print();
    });
    
    // Search functionality
    document.getElementById('search-button').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keyup', function(e) {
      if (e.key === 'Enter') {
        performSearch();
      }
    });
    
    function performSearch() {
      const searchTerm = document.getElementById('search-input').value.toLowerCase();
      if (!searchTerm) return;
      
      // Hide all pages that don't match
      const navItems = document.querySelectorAll('.nav-item');
      let foundAny = false;
      
      navItems.forEach(item => {
        const link = item.querySelector('a');
        const text = link.textContent.toLowerCase();
        
        if (text.includes(searchTerm)) {
          item.style.display = 'block';
          foundAny = true;
          
          // Expand parent items
          let parent = item.closest('.nav-children');
          while (parent) {
            parent.classList.remove('collapsed');
            const toggleIcon = document.querySelector(\`[data-target="\${parent.id}"]\`);
            if (toggleIcon) toggleIcon.textContent = '▼';
            parent = parent.parentElement.closest('.nav-children');
          }
        } else {
          item.style.display = 'none';
        }
      });
      
      // Show a message if no results
      const searchResults = document.querySelector('.search-results');
      if (!foundAny) {
        if (!searchResults) {
          const resultsDiv = document.createElement('div');
          resultsDiv.className = 'search-results';
          resultsDiv.innerHTML = \`<p>No results found for "\${searchTerm}"</p>\`;
          document.querySelector('.navigation').prepend(resultsDiv);
        }
      } else if (searchResults) {
        searchResults.remove();
      }
    }
    
    // Load theme preference
    document.addEventListener('DOMContentLoaded', function() {
      const isDarkTheme = localStorage.getItem('dark-theme') === 'true';
      if (isDarkTheme) {
        document.body.classList.add('dark-theme');
        
        // Update highlight.js theme
        const hlTheme = document.querySelector('link[href*="highlight.js"]');
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css';
        
        const icon = document.querySelector('.theme-toggle i');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      }
    });
  </script>
</body>
</html>`;

  // Create CSS file
  const cssContent = `
/* Base styles */
:root {
  --primary-color: #2563eb;
  --primary-hover: #1d4ed8;
  --secondary-color: #f59e0b;
  --text-color: #1f2937;
  --text-light: #4b5563;
  --bg-color: #ffffff;
  --bg-light: #f9fafb;
  --bg-dark: #f3f4f6;
  --border-color: #e5e7eb;
  --code-bg: #f3f4f6;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  --font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  --header-height: 64px;
  --sidebar-width: 300px;
  --sidebar-mobile-width: 80vw;
  --content-max-width: 1200px;
  --transition-speed: 0.3s;
  --radius: 0.5rem;
}

/* Dark theme */
body.dark-theme {
  --primary-color: #3b82f6;
  --primary-hover: #60a5fa;
  --secondary-color: #f59e0b;
  --text-color: #f9fafb;
  --text-light: #d1d5db;
  --bg-color: #1f2937;
  --bg-light: #111827;
  --bg-dark: #0f172a;
  --border-color: #374151;
  --code-bg: #1e293b;
}

/* Reset */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

    body {
  font-family: var(--font-sans);
  color: var(--text-color);
  background-color: var(--bg-color);
      line-height: 1.6;
  transition: background-color var(--transition-speed), color var(--transition-speed);
}

ul {
  list-style: none;
}

a {
  color: var(--primary-color);
  text-decoration: none;
  transition: color var(--transition-speed);
}

a:hover {
  color: var(--primary-hover);
}

button {
  cursor: pointer;
  background: none;
  border: none;
  font-family: inherit;
}

/* Layout */
.wiki-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header-content {
  max-width: var(--content-max-width);
      margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  padding: 0 1.5rem;
}

.logo {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo i {
  font-size: 1.5rem;
  color: var(--primary-color);
}

.logo h1 {
  font-size: 1.2rem;
  font-weight: 600;
}

.logo a {
      display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--text-color);
  text-decoration: none;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.theme-toggle, .menu-toggle {
  font-size: 1.2rem;
  color: var(--text-light);
  padding: 0.5rem;
  border-radius: var(--radius);
  transition: color var(--transition-speed), background-color var(--transition-speed);
}

.theme-toggle:hover, .menu-toggle:hover {
  color: var(--primary-color);
  background-color: var(--bg-dark);
}

.main-container {
  display: flex;
      flex: 1;
  margin-top: var(--header-height);
}

.sidebar {
  width: var(--sidebar-width);
  background-color: var(--bg-light);
  border-right: 1px solid var(--border-color);
  position: fixed;
  top: var(--header-height);
  bottom: 0;
  left: 0;
      overflow-y: auto;
  transition: transform var(--transition-speed), background-color var(--transition-speed);
  z-index: 99;
    }

    .content {
  flex: 1;
  padding: 2rem;
  margin-left: var(--sidebar-width);
}

/* Sidebar */
.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-header h2 {
  font-size: 1.25rem;
  margin-bottom: 1rem;
}

.search-container {
  display: flex;
  margin-top: 1rem;
}

.search-container input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius) 0 0 var(--radius);
  font-family: inherit;
  background-color: var(--bg-color);
  color: var(--text-color);
  transition: border-color var(--transition-speed), background-color var(--transition-speed);
}

.search-container button {
  padding: 0.75rem 1rem;
  background-color: var(--primary-color);
  color: white;
  border: 1px solid var(--primary-color);
  border-radius: 0 var(--radius) var(--radius) 0;
  transition: background-color var(--transition-speed);
}

.search-container button:hover {
  background-color: var(--primary-hover);
}

.navigation {
  padding: 1rem 0;
}

.nav-menu {
  padding: 0;
}

    .nav-item {
  margin: 0.25rem 0;
    }

    .nav-item-header {
      display: flex;
      align-items: center;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius);
  transition: background-color var(--transition-speed);
    }

.nav-item-header:hover {
  background-color: var(--bg-dark);
}

    .toggle-icon, .toggle-placeholder {
  width: 20px;
  margin-right: 0.5rem;
      cursor: pointer;
  transition: transform var(--transition-speed);
    }

    .nav-children {
  margin-left: 1.5rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--border-color);
    }

    .nav-children.collapsed {
      display: none;
    }

/* Content */
.welcome-container {
  max-width: 800px;
  margin: 0 auto;
}

.welcome-container h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.welcome-container p {
  margin-bottom: 1.5rem;
}

.welcome-container h3 {
  font-size: 1.5rem;
  margin: 2rem 0 1rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
}

.welcome-container ul {
  list-style: disc;
  padding-left: 1.5rem;
  margin-bottom: 1.5rem;
}

/* Stats panel */
.stats-panel {
      display: flex;
      justify-content: space-between;
  gap: 1rem;
  margin: 2rem 0;
}

.stat-item {
  flex: 1;
  background-color: var(--bg-light);
  padding: 1.5rem;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  gap: 1rem;
  box-shadow: var(--shadow-md);
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 12px -2px rgba(0, 0, 0, 0.1);
}

.stat-item i {
  font-size: 2rem;
  color: var(--primary-color);
}

.stat-count {
  font-size: 1.5rem;
  font-weight: bold;
  display: block;
  line-height: 1.2;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-light);
}

/* Quick links */
.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.link-card {
  background-color: var(--bg-light);
  padding: 1rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-color);
  transition: transform 0.2s, box-shadow 0.2s;
}

.link-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.link-card a {
      display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.link-card i {
  color: var(--primary-color);
}

.link-card-title {
  font-weight: 600;
}

.link-card-path {
  font-size: 0.75rem;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Search results */
.search-results {
  padding: 1rem 1.5rem;
  background-color: var(--bg-dark);
  margin: 0.5rem 1rem;
  border-radius: var(--radius);
}

/* Mobile responsive */
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
    width: var(--sidebar-mobile-width);
  }
  
  .sidebar.active {
    transform: translateX(0);
  }
  
  .content {
    margin-left: 0;
  }
  
  .stats-panel {
    flex-direction: column;
  }
  
  .header-content {
    padding: 0 1rem;
  }
  
  .logo h1 {
    font-size: 1rem;
  }
  
  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
  
  .page-header h1 {
    font-size: 1.75rem;
  }
  
  .link-grid {
    grid-template-columns: 1fr;
  }
}

/* Error handling styles */
.error-message {
  background-color: #fee2e2;
  border-left: 4px solid #ef4444;
  padding: 1rem;
  margin: 1.5rem 0;
  border-radius: 0 var(--radius) var(--radius) 0;
}

.dark-theme .error-message {
  background-color: #7f1d1d;
  border-left: 4px solid #ef4444;
}

.error-message h3 {
  color: #b91c1c;
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.dark-theme .error-message h3 {
  color: #fca5a5;
}

.error-message details {
  margin-top: 1rem;
}

.error-message summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.error-message pre {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 0.5rem;
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.dark-theme .error-message pre {
  background-color: rgba(0, 0, 0, 0.2);
}

.no-navigation {
  padding: 1rem;
  text-align: center;
  color: var(--text-light);
  font-style: italic;
}

.breadcrumb-item:not(:last-child)::after {
  content: "/";
  margin: 0 0.5rem;
  color: var(--border-color);
}

.breadcrumb-item.current {
  color: var(--text-color);
  font-weight: 600;
}

.page-header {
}
  `;

  // Create the index.html file
  await fs.writeFile(path.join(outputPath, 'index.html'), indexHtml);
  
  // Create the CSS file
  await fs.writeFile(path.join(outputPath, 'styles.css'), cssContent);
  
  logger.info('Created index file:', path.join(outputPath, 'index.html'));
}

/**
 * Generates HTML for top pages to show on the welcome page
 * @param {Array} pages - List of pages
 * @param {number} limit - Maximum number of pages to show
 * @returns {string} HTML for top pages
 */
function generateTopPages(pages, limit = 6) {
  const flatPages = [];
  
  // Flatten the page hierarchy for top items
  const flattenPages = (pageList, depth = 0, path = []) => {
    if (!pageList || !Array.isArray(pageList)) return;
    
    for (const page of pageList) {
      if (page.isAttachmentDir) continue;
      
      const currentPath = [...path];
      if (page.title) {
        currentPath.push(page.title);
      }
      
      if (!page.isDirectory) {
        flatPages.push({
          title: page.title,
          path: page.path,
          breadcrumb: currentPath.join(' > '),
          depth: depth
        });
      }
      
      if (page.children && page.children.length > 0) {
        flattenPages(page.children, depth + 1, currentPath);
      }
    }
  };
  
  flattenPages(pages);
  
  // First sort by depth (show root pages first)
  flatPages.sort((a, b) => {
    // First priority: show home or index pages first
    const aIsHome = a.title.toLowerCase().includes('home') || a.title.toLowerCase().includes('index');
    const bIsHome = b.title.toLowerCase().includes('home') || b.title.toLowerCase().includes('index');
    
    if (aIsHome && !bIsHome) return -1;
    if (!aIsHome && bIsHome) return 1;
    
    // Second priority: depth
    return a.depth - b.depth;
  });
  
  // Generate HTML for top pages
  let html = '';
  const topPages = flatPages.slice(0, limit);
  
  for (const page of topPages) {
    const sanitizedTitle = sanitizePathSegment(page.title);
    const link = `./pages/${sanitizedTitle}/index.html`;
    
    // Choose icon based on page title or content
    let icon = 'fa-file-alt';
    const title = page.title.toLowerCase();
    
    if (title.includes('home') || title.includes('index')) {
      icon = 'fa-home';
    } else if (title.includes('setup') || title.includes('install')) {
      icon = 'fa-tools';
    } else if (title.includes('guide') || title.includes('tutorial')) {
      icon = 'fa-book-open';
    } else if (title.includes('api') || title.includes('reference')) {
      icon = 'fa-code';
    } else if (title.includes('changelog') || title.includes('release')) {
      icon = 'fa-history';
    }
    
    html += `
    <div class="link-card">
      <a href="${link}" title="${page.breadcrumb}">
        <i class="fas ${icon}"></i>
        <span class="link-card-title">${page.title}</span>
        <span class="link-card-path">${page.breadcrumb}</span>
      </a>
    </div>`;
  }
  
  return html;
}

/**
 * Count the total number of pages in the pages array
 * @param {Array} pages - List of pages
 * @returns {number} Number of pages
 */
function countPages(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let count = 0;
  
  for (const page of pages) {
    if (!page.isDirectory && !page.isAttachmentDir) {
      count++;
    }
    
    if (page.children && page.children.length > 0) {
      count += countPages(page.children);
    }
  }
  
  return count;
}

/**
 * Count the total number of directories in the pages array
 * @param {Array} pages - List of pages
 * @returns {number} Number of directories
 */
function countDirectories(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let count = 0;
  
  for (const page of pages) {
    if (page.isDirectory) {
      count++;
    }
    
    if (page.children && page.children.length > 0) {
      count += countDirectories(page.children);
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
 * Sanitizes a string to be used as a path segment
 * @param {string} segment - The string to sanitize
 * @returns {string} - The sanitized string
 */
function sanitizePathSegment(segment) {
  if (!segment) return 'unnamed';
  
  // Replace characters that are invalid in Windows filenames
  // Windows doesn't allow: < > : " / \ | ? *
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
  
  // Ensure we have a valid path segment
  if (result.length === 0) {
    return 'unnamed';
  }
  
  return result;
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
    
    // Second pass: create merged pages - avoid duplicating content pages
    for (const sanitizedTitle in nameMap) {
      const { dirPage, filePage } = nameMap[sanitizedTitle];
      
      if (dirPage && filePage) {
        // If both directory and file exist, prefer the directory but use the file's content
        const mergedPage = {
          ...dirPage,
          hasFileContent: true,
          filePath: filePage.path,
          isContentPage: true // Mark that this is both a directory and a content page
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
          
          // Create HTML file - await the async function
          await createHtmlPage(page.title, html, pageOutputDir, pagePath, wikiStructure);
          
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
            
            // Create HTML file - await the async function
            await createHtmlPage(page.title, html, pageOutputDir, pagePath, wikiStructure);
            
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
      logger.warn(`Warning: No markdown content for page at ${pagePath}`);
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
        // Extract filename from path
        const imageFileName = imagePath.split('/').pop().split('\\').pop();
        
        // Clean any URL encoding in the filename
        const cleanFileName = decodeURIComponent(imageFileName);
        
        // Create the path with URL encoding for spaces and special characters
        const newImagePath = `${pathToAttachments}${encodeURIComponent(cleanFileName)}`;
        
        const dimensionsAttr = dimensions ? ` =${dimensions}` : '';
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
        // Extract filename from path
        const imageFileName = imagePath.split('/').pop().split('\\').pop();
        
        // Clean any URL encoding in the filename
        const cleanFileName = decodeURIComponent(imageFileName);
        
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
        
          try {
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

/**
 * Create an HTML page for a markdown page
 * @param {string} title - Page title
 * @param {string} html - HTML content
 * @param {string} outputPath - Output path
 * @param {string} relativePath - Relative path to the output
 * @param {Object} wikiStructure - Wiki structure
 * @returns {Promise<void>}
 */
async function createHtmlPage(title, html, outputPath, relativePath, wikiStructure) {
  // Calculate the depth to determine the path back to root
  const depth = relativePath.split('/').filter(Boolean).length;
  
  // Fix: Correct pathToRoot calculation - we only need to go back depth + 1 levels
  // (+ 1 for the 'pages' directory)
  const pathToRoot = depth > 0 ? '../'.repeat(depth + 1) : './';
  
  console.log(`Creating page at depth ${depth} with pathToRoot=${pathToRoot} for path=${relativePath}`);
  
  // Generate navigation menu with a clean base path (don't pass relativePath)
  const navMenu = wikiStructure && wikiStructure.pages ? 
    generateNavMenu(wikiStructure.pages) : 
    '<div class="no-navigation">Navigation not available</div>';
  
  // Generate breadcrumb navigation
  const breadcrumbs = generateBreadcrumbs(relativePath);
  
  // Create an improved HTML page with better styling
  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Wiki Preview</title>
  
  <!-- Dynamic CSS loading script -->
  <script>
    // Function to dynamically load the stylesheet with the correct path
    function loadStylesheet() {
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
      
      // Also load other required stylesheets
      const fontAwesome = document.createElement('link');
      fontAwesome.rel = 'stylesheet';
      fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
      document.head.appendChild(fontAwesome);
      
      const highlightCSS = document.createElement('link');
      highlightCSS.rel = 'stylesheet';
      highlightCSS.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css';
      document.head.appendChild(highlightCSS);
    }
    
    // Load the stylesheet immediately
    loadStylesheet();
  </script>
  
  <!-- Fallback stylesheet link (the dynamic loader above will take precedence) -->
  <link rel="stylesheet" href="${pathToRoot}styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
  <script>
  // Improved navigation function that works with relative paths
  function navigateToPage(linkElement) {
    const pagePath = linkElement.getAttribute('data-page-path');
    if (pagePath) {
      // Get the root path (path to the site root)
      let rootPath = '';
      
      // Determine the root path based on current URL
      const currentPath = window.location.pathname;
      console.log('Current path:', currentPath);
      
      // Find path up to local-output directory
      if (currentPath.includes('local-output')) {
        const pathParts = currentPath.split('local-output');
        rootPath = pathParts[0] + 'local-output/';
      } else {
        // Fallback - use current directory
        rootPath = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        // Navigate up to find the root
        rootPath = rootPath.substring(0, rootPath.lastIndexOf('pages/')) || rootPath;
      }
      
      console.log('Root path:', rootPath);
      console.log('Page path:', pagePath);
      
      // Always construct the URL from the root path to avoid path concatenation issues
      const pageUrl = rootPath + 'pages/' + pagePath + '/index.html';
      console.log('Navigating to:', pageUrl);
      window.location.href = pageUrl;
    }
  }
  </script>
</head>
<body>
  <div class="wiki-container">
    <header>
      <div class="header-content">
        <div class="logo">
         <a href="${pathToRoot}index.html">
          <i class="fas fa-book"></i>
          <h1>Wiki Documentation</h1>
         </a>
        </div>
        <div class="header-actions">
          <button id="theme-toggle" class="theme-toggle">
            <i class="fas fa-moon"></i>
          </button>
          <button id="menu-toggle" class="menu-toggle">
            <i class="fas fa-bars"></i>
          </button>
        </div>
      </div>
    </header>

    <div class="main-container">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <h2>Navigation</h2>
          <div class="search-container">
            <input type="text" id="search-input" placeholder="Search pages...">
            <button id="search-button"><i class="fas fa-search"></i></button>
          </div>
        </div>
        <nav class="navigation">
          ${navMenu}
        </nav>
      </aside>

      <main class="content">
        <div class="page-container">
          <div class="breadcrumbs">
            ${breadcrumbs}
          </div>
          
          <article class="page-content">
            <div class="page-header">
              <h1>${title}</h1>
              <div class="page-actions">
                <button id="print-page" class="action-button" title="Print page">
                  <i class="fas fa-print"></i>
                </button>
                <button id="expand-page" class="action-button" title="Expand view">
                  <i class="fas fa-expand"></i>
                </button>
              </div>
            </div>
            
            <div class="page-body">
              ${html}
            </div>
            
            <div class="page-footer">
              <div class="page-meta">
                <span><i class="fas fa-clock"></i> Last updated: ${new Date().toLocaleDateString()}</span>
              </div>
            </div>
          </article>
          
          <div class="page-navigation">
            <a href="${pathToRoot}index.html" class="nav-link">
              <i class="fas fa-home"></i> Back to Index
            </a>
          </div>
        </div>
      </main>
    </div>
  </div>
  
  <script>
    // Initialize syntax highlighting
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
      });
      
      // Add copy buttons to code blocks
      document.querySelectorAll('pre').forEach((block) => {
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.innerHTML = '<i class="fas fa-copy"></i>';
        copyButton.title = 'Copy to clipboard';
        
        copyButton.addEventListener('click', function() {
          const code = block.querySelector('code').innerText;
          navigator.clipboard.writeText(code).then(function() {
            copyButton.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(function() {
              copyButton.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2000);
          });
        });
        
        block.classList.add('code-block-wrapper');
        block.prepend(copyButton);
      });
      
      // Add image zoom functionality
      document.querySelectorAll('.page-body img').forEach((img) => {
        img.addEventListener('click', function() {
          this.classList.toggle('zoomed');
        });
      });
    });
    
    // Toggle sidebar on mobile
    document.getElementById('menu-toggle').addEventListener('click', function() {
      document.getElementById('sidebar').classList.toggle('active');
    });
    
    // Toggle dark/light theme
    document.getElementById('theme-toggle').addEventListener('click', function() {
      document.body.classList.toggle('dark-theme');
      
      // Update highlight.js theme
      const hlTheme = document.querySelector('link[href*="highlight.js"]');
      if (document.body.classList.contains('dark-theme')) {
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css';
        this.querySelector('i').classList.remove('fa-moon');
        this.querySelector('i').classList.add('fa-sun');
      } else {
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css';
        this.querySelector('i').classList.remove('fa-sun');
        this.querySelector('i').classList.add('fa-moon');
      }
      
      // Save preference
      localStorage.setItem('dark-theme', document.body.classList.contains('dark-theme'));
    });
    
    // Toggle navigation items
    document.querySelectorAll('.toggle-icon').forEach(function(icon) {
      icon.addEventListener('click', function() {
        const targetId = this.getAttribute('data-target');
        const target = document.getElementById(targetId);
        target.classList.toggle('collapsed');
        
        // Change toggle icon
        if (this.textContent === '▶') {
          this.textContent = '▼';
        } else {
          this.textContent = '▶';
        }
      });
    });
    
    // Expand page view (hide sidebar)
    document.getElementById('expand-page').addEventListener('click', function() {
      document.body.classList.toggle('expanded-view');
      
      const icon = this.querySelector('i');
      if (icon.classList.contains('fa-expand')) {
        icon.classList.remove('fa-expand');
        icon.classList.add('fa-compress');
      } else {
        icon.classList.remove('fa-compress');
        icon.classList.add('fa-expand');
      }
    });
    
    // Print page
    document.getElementById('print-page').addEventListener('click', function() {
      window.print();
    });
    
    // Search functionality
    document.getElementById('search-button').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keyup', function(e) {
      if (e.key === 'Enter') {
        performSearch();
      }
    });
    
    function performSearch() {
      const searchTerm = document.getElementById('search-input').value.toLowerCase();
      if (!searchTerm) return;
      
      // Hide all pages that don't match
      const navItems = document.querySelectorAll('.nav-item');
      let foundAny = false;
      
      navItems.forEach(item => {
        const link = item.querySelector('a');
        const text = link.textContent.toLowerCase();
        
        if (text.includes(searchTerm)) {
          item.style.display = 'block';
          foundAny = true;
          
          // Expand parent items
          let parent = item.closest('.nav-children');
          while (parent) {
            parent.classList.remove('collapsed');
            const toggleIcon = document.querySelector(\`[data-target="\${parent.id}"]\`);
            if (toggleIcon) toggleIcon.textContent = '▼';
            parent = parent.parentElement.closest('.nav-children');
          }
        } else {
          item.style.display = 'none';
        }
      });
      
      // Show a message if no results
      const searchResults = document.querySelector('.search-results');
      if (!foundAny) {
        if (!searchResults) {
          const resultsDiv = document.createElement('div');
          resultsDiv.className = 'search-results';
          resultsDiv.innerHTML = \`<p>No results found for "\${searchTerm}"</p>\`;
          document.querySelector('.navigation').prepend(resultsDiv);
        }
      } else if (searchResults) {
        searchResults.remove();
      }
    }
    
    // Load theme preference
    document.addEventListener('DOMContentLoaded', function() {
      const isDarkTheme = localStorage.getItem('dark-theme') === 'true';
      if (isDarkTheme) {
        document.body.classList.add('dark-theme');
        
        // Update highlight.js theme
        const hlTheme = document.querySelector('link[href*="highlight.js"]');
        hlTheme.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css';
        
        const icon = document.querySelector('.theme-toggle i');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      }
    });
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(outputPath, 'index.html'), pageHtml);
  logger.info('Created HTML page:', path.join(outputPath, 'index.html'));
}

/**
 * Generate breadcrumb navigation
 * @param {string} relativePath - Relative path to the output directory
 * @returns {string} HTML breadcrumb navigation
 */
function generateBreadcrumbs(relativePath) {
  // Get path components from the relative path
  const pathParts = relativePath.split('/').filter(part => part !== '.' && part !== '' && part !== 'pages');
  
  if (pathParts.length === 0) {
    return `<a href="./index.html" class="breadcrumb-item"><i class="fas fa-home"></i> Home</a>`;
  }
  
  // Calculate depth to find path to root
  const depth = pathParts.length;
  // Fix: Correct pathToRoot calculation - we only need to go back depth + 1 levels
  const pathToRoot = '../'.repeat(depth + 1); // +1 for the 'pages' directory level
  
  // Start with home link
  let breadcrumbs = `<a href="${pathToRoot}index.html" class="breadcrumb-item"><i class="fas fa-home"></i> Home</a>`;
  
  // Build the full path for intermediate links
  let fullPath = '';
  for (let i = 0; i < pathParts.length; i++) {
    const isLast = i === pathParts.length - 1;
    const part = pathParts[i];
    
    // Adjust the path for each level
    fullPath += (i > 0 ? '/' : '') + part;
    
    if (isLast) {
      // Last item is current page (non-link)
      breadcrumbs += `<span class="breadcrumb-item current">${decodeURIComponent(part.replace(/-/g, ' '))}</span>`;
    } else {
      // Calculate the proper relative path to this breadcrumb level
      // We need to go up enough levels from current page
      const levelsUp = depth - i;
      const pathToPage = '../'.repeat(levelsUp) + fullPath + '/index.html';
      breadcrumbs += `<a href="${pathToPage}" class="breadcrumb-item">${decodeURIComponent(part.replace(/-/g, ' '))}</a>`;
    }
  }
  
  return breadcrumbs;
}

module.exports = {
  runLocalTest
}; 