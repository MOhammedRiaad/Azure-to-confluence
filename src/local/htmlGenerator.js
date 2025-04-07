/**
 * HTML Generator for creating index page and other HTML files
 */

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils');
const { generateNavMenu, generateTopPages, decodeTitle } = require('./utils/navUtils');
const { createDynamicRootPathScript, createNavigationScript } = require('./utils/pathUtils');

/**
 * Create the index file for the output directory
 * @param {string} outputPath - Path to save the output
 * @param {Object} wikiStructure - Wiki structure object
 * @returns {Promise<void>}
 */
async function createIndexFile(outputPath, wikiStructure) {
  logger.info(`Creating index file at ${outputPath}`);
  
  // For the index file, pathToRoot is always './'
  const pathToRoot = './';
  
  // Generate navigation menu
  const navMenu = generateNavMenu(wikiStructure.pages || []);
  
  // Generate top pages list (most important pages)
  const topPages = generateTopPages(wikiStructure.pages || [], 5);
  
  // Get statistics
  const { pageCount, folderCount, attachmentCount } = wikiStructure.stats || { 
    pageCount: 0, 
    folderCount: 0, 
    attachmentCount: 0 
  };
  
  // Create a modern index page with better styling
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wiki Preview</title>
  
  <script>
  ${createDynamicRootPathScript()}
  </script>
  
  <!-- Fallback stylesheet link (the dynamic loader above will take precedence) -->
  <link rel="stylesheet" href="${pathToRoot}styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
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
          <div class="index-hero">
            <h1>Welcome to the Wiki Preview</h1>
            <p>This is a local preview of the Azure DevOps wiki content.</p>
          </div>
          
          <div class="dashboard">
            <div class="dashboard-card">
              <div class="card-icon"><i class="fas fa-file-alt"></i></div>
              <div class="card-content">
                <h3>Pages</h3>
                <p class="count">${pageCount}</p>
              </div>
            </div>
            
            <div class="dashboard-card">
              <div class="card-icon"><i class="fas fa-folder"></i></div>
              <div class="card-content">
                <h3>Folders</h3>
                <p class="count">${folderCount}</p>
              </div>
            </div>
            
            <div class="dashboard-card">
              <div class="card-icon"><i class="fas fa-paperclip"></i></div>
              <div class="card-content">
                <h3>Attachments</h3>
                <p class="count">${attachmentCount}</p>
              </div>
            </div>
          </div>
          
          <div class="top-pages">
            <h2>Top Pages</h2>
            <div class="page-grid">
              ${topPages}
            </div>
          </div>
          
          <div class="index-info">
            <h2>About This Preview</h2>
            <p>This preview was generated from your Azure DevOps wiki. It allows you to browse the content locally.</p>
            <p>Use the navigation menu on the left to explore all pages, or search for specific content.</p>
          </div>
        </div>
      </main>
    </div>
  </div>
  
  <script>
    // Toggle sidebar on mobile
    document.getElementById('menu-toggle').addEventListener('click', function() {
      document.getElementById('sidebar').classList.toggle('active');
    });
    
    // Toggle dark/light theme
    document.getElementById('theme-toggle').addEventListener('click', function() {
      document.body.classList.toggle('dark-theme');
      
      // Update icon
      const icon = this.querySelector('i');
      if (icon.classList.contains('fa-moon')) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
      }
      
      // Save preference
      localStorage.setItem('dark-theme', document.body.classList.contains('dark-theme'));
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
        const icon = document.querySelector('.theme-toggle i');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
      }
    });
  </script>
</body>
</html>`;

  // Write the index file
  await fs.writeFile(path.join(outputPath, 'index.html'), indexHtml);
  logger.info(`Created index file at ${path.join(outputPath, 'index.html')}`);
  
  // Create the CSS file
  await createCssFile(outputPath);
  
  return true;
}

/**
 * Create the CSS file for styling
 * @param {string} outputPath - Path to save the output
 * @returns {Promise<void>}
 */
async function createCssFile(outputPath) {
  const css = `/* Base styles */
:root {
  --primary-color: #0078d4;
  --secondary-color: #2b88d8;
  --background-color: #ffffff;
  --text-color: #333333;
  --sidebar-bg: #f5f5f5;
  --header-bg: #0078d4;
  --header-text: #ffffff;
  --card-bg: #ffffff;
  --border-color: #e0e0e0;
  --hover-color: #f0f0f0;
  --code-bg: #f6f8fa;
  --link-color: #0078d4;
  --link-hover-color: #106ebe;
  --shadow-color: rgba(0, 0, 0, 0.1);
}

/* Dark theme */
.dark-theme {
  --background-color: #1e1e1e;
  --text-color: #e0e0e0;
  --sidebar-bg: #252525;
  --header-bg: #0078d4;
  --header-text: #ffffff;
  --card-bg: #2d2d2d;
  --border-color: #444444;
  --hover-color: #333333;
  --code-bg: #2a2a2a;
  --link-color: #6ab7ff;
  --link-hover-color: #8dc2ff;
  --shadow-color: rgba(0, 0, 0, 0.3);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
  color: var(--text-color);
  background-color: var(--background-color);
  transition: background-color 0.3s ease, color 0.3s ease;
}

a {
  color: var(--link-color);
  text-decoration: none;
  transition: color 0.3s ease;
}

a:hover {
  color: var(--link-hover-color);
}

.wiki-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header styles */
header {
  background-color: var(--header-bg);
  color: var(--header-text);
  padding: 1rem;
  box-shadow: 0 2px 5px var(--shadow-color);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.logo {
  display: flex;
  align-items: center;
}

.logo a {
  display: flex;
  align-items: center;
  color: var(--header-text);
}

.logo i {
  font-size: 1.5rem;
  margin-right: 0.5rem;
}

.logo h1 {
  font-size: 1.5rem;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 1rem;
}

.theme-toggle, .menu-toggle {
  background: transparent;
  border: none;
  color: var(--header-text);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s ease;
}

.theme-toggle:hover, .menu-toggle:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

/* Main container styles */
.main-container {
  display: flex;
  flex: 1;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

/* Sidebar styles */
.sidebar {
  width: 280px;
  background-color: var(--sidebar-bg);
  border-right: 1px solid var(--border-color);
  padding: 1rem;
  overflow-y: auto;
  height: calc(100vh - 64px);
  position: sticky;
  top: 64px;
  transition: transform 0.3s ease;
}

.sidebar-header {
  margin-bottom: 1rem;
}

.sidebar-header h2 {
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
}

.search-container {
  display: flex;
  margin-bottom: 1rem;
}

#search-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-right: none;
  border-radius: 4px 0 0 4px;
  background-color: var(--card-bg);
  color: var(--text-color);
}

#search-button {
  padding: 0.5rem 0.75rem;
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
}

.search-results {
  padding: 0.5rem;
  background-color: var(--card-bg);
  border-radius: 4px;
  margin-bottom: 1rem;
  border: 1px solid var(--border-color);
}

.navigation ul {
  list-style: none;
}

.nav-item {
  margin-bottom: 0.25rem;
}

.nav-item a {
  display: block;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.3s ease;
}

.nav-item a:hover {
  background-color: var(--hover-color);
}

.nav-header {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.toggle-icon {
  margin-right: 0.5rem;
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
}

.nav-children {
  margin-left: 1rem;
  overflow: hidden;
  max-height: 1000px;
  transition: max-height 0.3s ease-in-out;
}

.nav-children.collapsed {
  max-height: 0;
}

/* Content styles */
.content {
  flex: 1;
  padding: 1rem;
  overflow-x: hidden;
}

.page-container {
  background-color: var(--card-bg);
  border-radius: 8px;
  box-shadow: 0 2px 8px var(--shadow-color);
  padding: 2rem;
  margin-bottom: 2rem;
}

.index-hero {
  text-align: center;
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
}

.index-hero h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: var(--primary-color);
}

.dashboard {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.dashboard-card {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  display: flex;
  align-items: center;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.dashboard-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 5px 15px var(--shadow-color);
}

.card-icon {
  font-size: 2rem;
  margin-right: 1rem;
  color: var(--primary-color);
}

.card-content h3 {
  font-size: 1.2rem;
  margin-bottom: 0.25rem;
}

.count {
  font-size: 1.8rem;
  font-weight: bold;
  color: var(--primary-color);
}

.top-pages {
  margin-bottom: 2rem;
}

.top-pages h2 {
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

.page-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.page-card {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.page-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 5px 15px var(--shadow-color);
}

.page-card h3 {
  margin-bottom: 0.5rem;
  font-size: 1.2rem;
}

.page-card p {
  color: var(--text-color);
  opacity: 0.8;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.page-card .card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-color);
  opacity: 0.7;
}

.index-info {
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.index-info h2 {
  margin-bottom: 1rem;
  font-size: 1.5rem;
}

.index-info p {
  margin-bottom: 1rem;
}

/* Page content styles */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.page-header h1 {
  font-size: 2rem;
  line-height: 1.2;
}

.page-actions {
  display: flex;
  gap: 0.5rem;
}

.action-button {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.5rem;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.action-button:hover {
  background-color: var(--hover-color);
}

.page-body {
  margin-bottom: 2rem;
}

.page-body h1, .page-body h2, .page-body h3, .page-body h4, .page-body h5, .page-body h6 {
  margin-top: 1.5rem;
  margin-bottom: 1rem;
}

.page-body p {
  margin-bottom: 1rem;
}

.page-body ul, .page-body ol {
  margin-bottom: 1rem;
  padding-left: 2rem;
}

.page-body code {
  font-family: 'Consolas', 'Monaco', monospace;
  background-color: var(--code-bg);
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-size: 0.9em;
}

.page-body pre {
  background-color: var(--code-bg);
  padding: 1rem;
  border-radius: 5px;
  overflow-x: auto;
  margin-bottom: 1rem;
  position: relative;
}

.page-body pre code {
  background-color: transparent;
  padding: 0;
  font-size: 0.9rem;
}

.code-block-wrapper {
  position: relative;
}

.copy-code-button {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background-color 0.3s ease;
  z-index: 1;
}

.copy-code-button:hover {
  background-color: var(--hover-color);
}

.page-body table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1.5rem;
  overflow-x: auto;
  display: block;
}

.page-body table th, .page-body table td {
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  text-align: left;
}

.page-body table th {
  background-color: var(--hover-color);
}

.page-body blockquote {
  padding: 0.5rem 1rem;
  border-left: 4px solid var(--primary-color);
  background-color: var(--hover-color);
  margin-bottom: 1rem;
}

.page-body img {
  max-width: 100%;
  height: auto;
  border-radius: 5px;
  margin: 1rem 0;
  cursor: pointer;
  transition: transform 0.3s ease;
}

.page-body img.zoomed {
  transform: scale(1.5);
  z-index: 10;
}

.page-footer {
  display: flex;
  justify-content: space-between;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.9rem;
  color: var(--text-color);
  opacity: 0.7;
}

.page-navigation {
  display: flex;
  justify-content: center;
  margin-top: 2rem;
}

.nav-link {
  padding: 0.5rem 1rem;
  background-color: var(--primary-color);
  color: white;
  border-radius: 4px;
  transition: background-color 0.3s ease;
}

.nav-link:hover {
  background-color: var(--secondary-color);
  color: white;
}

.breadcrumbs {
  margin-bottom: 1.5rem;
  padding: 0.5rem 0;
  font-size: 0.9rem;
}

.breadcrumbs a {
  color: var(--link-color);
}

.breadcrumbs a:hover {
  text-decoration: underline;
}

.breadcrumbs .separator {
  margin: 0 0.5rem;
  color: var(--text-color);
  opacity: 0.5;
}

/* Responsive styles */
@media (max-width: 900px) {
  .main-container {
    flex-direction: column;
  }
  
  .sidebar {
    width: 100%;
    height: auto;
    max-height: 0;
    overflow: hidden;
    position: static;
    padding: 0;
    transition: max-height 0.3s ease-in-out;
  }
  
  .sidebar.active {
    max-height: 500px;
    padding: 1rem;
    border-bottom: 1px solid var(--border-color);
  }
  
  .menu-toggle {
    display: block;
  }
  
  .page-container {
    padding: 1rem;
  }
  
  .dashboard {
    grid-template-columns: 1fr;
  }
  
  .page-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 901px) {
  .menu-toggle {
    display: none;
  }
  
  body.expanded-view .sidebar {
    display: none;
  }
  
  body.expanded-view .content {
    flex: 1;
  }
}

/* Print styles */
@media print {
  .header-actions, .sidebar, .page-actions, .page-navigation {
    display: none;
  }
  
  .main-container {
    display: block;
  }
  
 .content {
    width: 100%;
  }
  
  .page-container {
    box-shadow: none;
    padding: 0;
  }
  
  body {
    background-color: white;
    color: black;
  }
}`;

  await fs.writeFile(path.join(outputPath, 'styles.css'), css);
  logger.info(`Created CSS file at ${path.join(outputPath, 'styles.css')}`);
}

module.exports = {
  createIndexFile,
  createCssFile
}; 