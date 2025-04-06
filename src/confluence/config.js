const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs-extra');
const { validateConfig } = require('../utils/configValidator');

dotenv.config();

// Helper to resolve paths relative to the project root
function resolvePath(configPath) {
  if (!configPath) return null;
  
  // If it's already an absolute path, return it
  if (path.isAbsolute(configPath)) {
    return configPath;
  }
  
  // Otherwise, resolve relative to the current working directory
  return path.resolve(process.cwd(), configPath);
}

// Function to detect wiki root directory
function getWikiRootDir() {
  // First check if explicitly set in env
  if (process.env.WIKI_ROOT_DIR) {
    return resolvePath(process.env.WIKI_ROOT_DIR);
  }

  // Try to detect based on project name
  const projectName = process.env.PROJECT_NAME;
  if (projectName) {
    // Check common patterns
    const possibilities = [
      `../${projectName}.wiki`,        // Adjacent wiki folder
      `../${projectName}`,             // Adjacent project folder
      `../../${projectName}.wiki`,     // Up one level
      `${projectName}.wiki`            // In current directory
    ];

    for (const possibility of possibilities) {
      const fullPath = resolvePath(possibility);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          console.log(`Detected wiki root directory: ${fullPath}`);
          return fullPath;
        }
      } catch (error) {
        // Ignore errors checking paths
      }
    }
  }

  // Fall back to default
  return resolvePath(process.env.AZURE_WIKI_PATH || '..');
}

// Function to find .attachments directory
function getAttachmentsDir() {
  // First check if explicitly set in env
  if (process.env.ATTACHMENTS_PATH) {
    return resolvePath(process.env.ATTACHMENTS_PATH);
  }

  // Try to find in wiki root
  const wikiRoot = getWikiRootDir();
  const attachmentsInWikiRoot = path.join(wikiRoot, '.attachments');
  
  try {
    if (fs.existsSync(attachmentsInWikiRoot) && fs.statSync(attachmentsInWikiRoot).isDirectory()) {
      return attachmentsInWikiRoot;
    }
  } catch (error) {
    // Ignore errors checking path
  }

  // Look in parent directory
  const attachmentsInParent = path.join(path.dirname(wikiRoot), '.attachments');
  try {
    if (fs.existsSync(attachmentsInParent) && fs.statSync(attachmentsInParent).isDirectory()) {
      return attachmentsInParent;
    }
  } catch (error) {
    // Ignore errors checking path
  }

  // Fall back to empty string if not found
  return '';
}

const config = {
  confluence: {
    username: process.env.CONFLUENCE_USERNAME,
    password: process.env.CONFLUENCE_API_TOKEN,
    baseUrl: process.env.CONFLUENCE_BASE_URL,
    spaceKey: process.env.CONFLUENCE_SPACE_KEY,
    parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID
  },
  paths: {
    wikiRoot: getWikiRootDir(),
    wikiPath: process.env.AZURE_WIKI_PATH || '..',
    outputPath: resolvePath(process.env.OUTPUT_PATH || './output'),
    attachmentsDir: getAttachmentsDir()
  },
  project: {
    name: process.env.PROJECT_NAME || 'Unknown'
  }
};

function getConfig() {
  console.log('Configuration loaded:');
  console.log(`- Wiki root: ${config.paths.wikiRoot}`);
  console.log(`- Project name: ${config.project.name}`);
  console.log(`- Attachments directory: ${config.paths.attachmentsDir}`);
  
  validateConfig(config);
  return config;
}

module.exports = { getConfig };