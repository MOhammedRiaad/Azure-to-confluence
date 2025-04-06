const path = require('path');
const fs = require('fs-extra');
const ConfluenceClient = require('./utils/Confluence-API');

const { runLocalTest } = require('./localTester');
const { getConfig } = require('./confluence/config');
const { startConfluenceProcess } = require('./confluence');

const config = getConfig();

// Initialize Confluence client
const confluenceClient = new ConfluenceClient({
  baseUrl: config.confluence.baseUrl,
  username: config.confluence.username,
  apiToken: config.confluence.password
});

// Add authentication test function
async function testAuthentication() {
  try {
    // Test authentication by attempting to get space information
    await confluenceClient.getSpaceByKey(config.confluence.spaceKey);
    console.log('Authentication successful');
    return true;
  } catch (error) {
    console.error('Authentication failed:', error.message);
    if (error.response?.status === 401) {
      console.error('Invalid credentials. Please check your username and API token.');
    } else if (error.response?.status === 404) {
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
    const authSuccessful = await testAuthentication();
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
      await startConfluenceProcess(confluenceClient);
    }
  } catch (error) {
    handleApiError(error);
    process.exit(1);
  }
}

// Run the main function
main();
