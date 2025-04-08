/**
 * Page generator for creating content pages in the local preview
 */

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../../utils');
const { convertMarkdownToHtml } = require('./pageRenderer');
const { generateNavMenu, generateBreadcrumbs, decodeTitle } = require('../utils/navUtils');
const { calculatePathToRoot, createDynamicRootPathScript, createNavigationScript, sanitizePathSegment } = require('../utils/pathUtils');

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
  
  // Calculate path to root - we need to go back depth + 1 levels
  // (+ 1 for the 'pages' directory)
  const pathToRoot = calculatePathToRoot(depth);
  
  console.log(`Creating page at depth ${depth} with pathToRoot=${pathToRoot} for path=${relativePath}`);
  
  // Generate navigation menu with a clean base path (don't pass relativePath)
  const navMenu = wikiStructure && wikiStructure.pages ? 
    generateNavMenu(wikiStructure.pages) : 
    '<div class="no-navigation">Navigation not available</div>';
  
  // Generate breadcrumb navigation
  const breadcrumbs = generateBreadcrumbs(relativePath);
  
  // Decode the title for display
  const displayTitle = decodeTitle(title);
  
  // Create an improved HTML page with better styling
  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${displayTitle} - Wiki Preview</title>
  
  <script>
  ${createDynamicRootPathScript()}
  </script>
  
  <!-- Fallback stylesheet link (the dynamic loader above will take precedence) -->
  <link rel="stylesheet" href="${pathToRoot}styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
  <script>
  ${createNavigationScript()}
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
          <button id="expand-page" class="action-button" title="Expand view">
            <i class="fas fa-expand"></i>
          </button>
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
              <h1>${displayTitle}</h1>
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
            const toggleIcon = document.querySelector('[data-target="' + parent.id + '"]');
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
          resultsDiv.innerHTML = '<p>No results found for "' + searchTerm + '"</p>';
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
  logger.info(`Created HTML page: ${path.join(outputPath, 'index.html')}`);
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
      
      // Use the sanitized version of the title for creating folder paths
      // This ensures consistency in path generation
      const titleToSanitize = page.originalTitle || page.title;
      const sanitizedTitle = sanitizePathSegment(titleToSanitize);
      
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
        // Use the original title for file paths if available
        const titleToSanitize = page.originalTitle || page.title;
        const pageDirName = sanitizePathSegment(titleToSanitize);
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

module.exports = {
  createHtmlPage,
  createLocalPages
}; 