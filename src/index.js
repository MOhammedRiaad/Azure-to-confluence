const path = require('path');
const fs = require('fs-extra');
const { parseWiki } = require('./wikiParser');
const { createConfluencePages } = require('./pageCreator');
const { runLocalTest } = require('./localTester');
const { getConfig } = require('./config');
const ConfluenceClient = require('./utils/Confluence-API');
const { getMimeType, logger } = require('./utils');

const config = getConfig();

// Add utility for API retry logic
const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

// Initialize Confluence client
const confluenceClient = new ConfluenceClient({
  baseUrl: config.confluence.baseUrl,
  username: config.confluence.username,
  apiToken: config.confluence.password // Using the API token from config
});

// Add authentication test function
async function testAuthentication(client) {
  try {
    // Test authentication by attempting to get space information
    await client.getSpaceByKey(config.confluence.spaceKey);
    console.log('Authentication successful');
    return true;
  } catch (error) {
    console.error('Authentication failed:', error.message);
    if (error.status === 401) {
      console.error('Invalid credentials. Please check your username and API token.');
    } else if (error.status === 404) {
      console.error('Space not found. Please check your space key.');
    }
    return false;
  }
}

// Add error handling utility
const handleApiError = (error) => {
  if (error.response) {
    console.error(`Confluence API error: ${error.response.status} - ${error.response.data?.message}`);
    switch (error.response.status) {
      case 400:
        console.error('Bad Request: Check the request payload.');
        break;
      case 401:
        console.error('Authentication failed. Please check your API token.');
        break;
      case 403:
        console.error('Forbidden: Check API token permissions.');
        break;
      case 404:
        console.error('Not Found: Verify the existence of the resource.');
        break;
      default:
        console.error('Unexpected error.');
    }
  }
  throw error;
};

// Helper function to get argument value
function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
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
    const excludedDirs = ['azure-to-confluence', 'node_modules', 'src', 'local-output', 'test-output', '.git'];
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
 * Process attachments for the wiki
 * @param {Object} wikiStructure - Wiki structure
 * @param {string} wikiPath - Path to the wiki root
 * @returns {Promise<Array>} - List of attachments
 */
async function processAttachments(wikiStructure, wikiPath) {
  console.log('Processing attachments...');
  
  // The exact path where the .attachments folder is located
  const attachmentsPath = path.join(path.dirname(wikiPath), '.attachments');
  console.log(`Checking for .attachments folder at: ${attachmentsPath}`);
  
  try {
    const attachmentsExists = await fs.stat(attachmentsPath).then(() => true).catch(() => false);
    
    if (attachmentsExists) {
      console.log(`Found .attachments folder at ${attachmentsPath}`);
      
      const attachmentFiles = await fs.readdir(attachmentsPath);
      console.log(`Found ${attachmentFiles.length} attachment files`);
      
      // Create a list of attachment objects
      const attachments = [];
      for (const file of attachmentFiles) {
        const filePath = path.join(attachmentsPath, file);
        const stats = await fs.stat(filePath);
        
        attachments.push({
          name: file,
          path: filePath,
          size: stats.size
        });
      }
      
      return attachments;
    } else {
      console.log('No .attachments folder found at the expected location');
      return [];
    }
  } catch (error) {
    console.error(`Error processing attachments: ${error.message}`);
    return [];
  }
}

/**
 * Find attachment directories in the wiki structure
 * @param {Array} pages - List of pages
 * @param {string} wikiPath - Path to the wiki root
 * @returns {Promise<Array>} - Updated list of pages
 */
async function findAttachmentDirectories(pages, wikiPath) {
  if (!pages) return [];
  
  // Process each page
  const processedPages = await Promise.all(pages.map(async (page) => {
    // Check if this is an attachment directory
    if (page.title === '.attachments') {
      page.isAttachmentDir = true;
      return page;
    }
    
    // Recursively process children
    if (page.children && page.children.length > 0) {
      page.children = await findAttachmentDirectories(page.children, wikiPath);
    }
    
    return page;
  }));
  
  return processedPages;
}

// Main function
async function main() {
  try {
    const args = process.argv.slice(2);
    const isLocalTest = args.includes('--local') || args.includes('-l');
    const outputPath = getArgValue(args, '--output') || getArgValue(args, '-o') || './local-output';
    const debugMode = args.includes('--debug') || args.includes('-d');
    
    if (debugMode) {
      console.log('Running in debug mode - full logging enabled');
    }

    // Test authentication before proceeding
    const authSuccessful = await testAuthentication(confluenceClient);
    if (!authSuccessful) {
      console.error('Authentication failed. Exiting.');
      process.exit(1);
    }

    if (isLocalTest) {
      try {
        const wikiRootFolder = path.dirname(config.paths.wikiRoot);
        const adjustedWikiRoot = process.env.FOCUS_WIKI_PATH || 
                               path.join(config.paths.wikiRoot, 'Date-Code');
        
        console.log(`Wiki root folder: ${wikiRootFolder}`);
        console.log(`Adjusted wiki root: ${adjustedWikiRoot}`);
        
        await runLocalTest(adjustedWikiRoot, outputPath, { wikiRootFolder });
      } catch (error) {
        console.error('Error running local test:', error);
        process.exit(1);
      }
    } else {
      // Parse the wiki structure
      const wikiStructure = await retryWithBackoff(() => 
        parseAndProcessWiki(config.paths.wikiRoot)
      );
      
      console.log('Wiki structure parsed successfully.');
      
      // Filter out project directories
      wikiStructure.pages = filterOutProjectDir(wikiStructure.pages);
      console.log(`Filtered wiki structure now has ${wikiStructure.pages.length} root pages`);
      
      // Create a mappings object for attachments
      // This will be populated as we process pages
      const attachmentMappings = {};
      
      // Log attachment info
      if (wikiStructure.attachments && wikiStructure.attachments.length > 0) {
        console.log(`Found ${wikiStructure.attachments.length} attachments in wiki structure`);
        
        // Initialize attachment mappings
        wikiStructure.attachments.forEach(attachment => {
          const attachmentKey = attachment.path;
          attachmentMappings[attachmentKey] = {
            path: attachment.path,
            name: attachment.name,
            size: attachment.size,
            mimeType: getMimeType(attachment.path),
            processed: false
          };
        });
      } else {
        console.log('No attachments found in wiki structure');
      }
      
      // Create all pages with their attachments
      await retryWithBackoff(() =>
        createConfluencePages(
          wikiStructure,
          confluenceClient,
          config.confluence.spaceKey,
          config.confluence.parentPageId,
          attachmentMappings,
          config
        )
      );
      
      console.log('Wiki conversion completed successfully!');
    }
  } catch (error) {
    handleApiError(error);
    process.exit(1);
  }
}

/**
 * Parse and process wiki structure
 * @param {string} wikiPath - Path to the wiki root
 * @param {string} projectDir - Optional project directory
 * @returns {Promise<Object>} - Wiki structure
 */
async function parseAndProcessWiki(wikiPath, projectDir) {
  try {
    console.log(`Parsing wiki structure from ${wikiPath}...`);
    
    // Parse the wiki structure
    const wikiStructure = await parseWiki(wikiPath, projectDir);
    
    // Add debug logging
    console.log(`Found ${wikiStructure.pages.length} pages at root level`);
    const totalPages = countTotalPages(wikiStructure.pages);
    console.log(`Total pages found: ${totalPages}`);
    
    // Validate content
    validatePageContent(wikiStructure.pages);
    
    // Find and process all attachment directories
    wikiStructure.pages = await findAttachmentDirectories(wikiStructure.pages, wikiPath);
    
    console.log(`Processing attachments...`);
    // Process attachments
    wikiStructure.attachments = await processAttachments(wikiStructure, wikiPath);
    
    return wikiStructure;
  } catch (error) {
    console.error('Error parsing and processing wiki:', error);
    throw error;
  }
}

// Helper function to count total pages including nested ones
function countTotalPages(pages) {
  return pages.reduce((count, page) => {
    return count + 1 + (page.children ? countTotalPages(page.children) : 0);
  }, 0);
}

// Helper function to validate page content
function validatePageContent(pages) {
  pages.forEach(page => {
    if (!page.content && page.path.endsWith('.md')) {
      console.warn(`No content found for page: ${page.path}`);
    }
    if (page.children && page.children.length > 0) {
      validatePageContent(page.children);
    }
  });
}

// Run the main function
main();
