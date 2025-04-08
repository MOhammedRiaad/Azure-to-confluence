const path = require('path');
const fs = require('fs-extra');
const { Command } = require('commander');
const ConfluenceClient = require('./utils/Confluence-API');

//const { runLocalTest } = require('./local/localTester');
const {runLocalTest} = require('./local/index')
const { getConfig } = require('./confluence/config');
const { startConfluenceProcess } = require('./confluence');
const { logger } = require('./utils');

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
    logger.info('Authentication successful');
    return true;
  } catch (error) {
    logger.error('Authentication failed:', error.message);
    if (error.response?.status === 401) {
      logger.error('Invalid credentials. Please check your username and API token.');
    } else if (error.response?.status === 404) {
      logger.error('Space not found. Please check your space key.');
    }
    return false;
  }
}

// Add error handling utility
const handleApiError = (error) => {
  if (error.response) {
    logger.error(`Confluence API error: ${error.response.status} - ${error.response.data?.message}`);
    switch (error.response.status) {
      case 400:
        logger.error('Bad Request: Check the request payload.');
        break;
      case 401:
        logger.error('Authentication failed. Please check your API token.');
        break;
      case 403:
        logger.error('Forbidden: Check API token permissions.');
        break;
      case 404:
        logger.error('Not Found: Verify the existence of the resource.');
        break;
      default:
        logger.error('Unexpected error.');
    }
  }
  throw error;
};

// Main function
async function main() {
  const program = new Command();

  program
    .name('wiki-migrate')
    .description('CLI tool to migrate Azure DevOps wiki to Confluence')
    .version('1.1.0');

  // Global options
  program
    .option('-d, --debug', 'Enable debug mode')
    .option('-o, --output <path>', 'Output directory for local testing', './local-output');

  // Local test command
  program
    .command('local')
    .description('Run a local test of the wiki conversion')
    .option('-w, --wiki-path <path>', 'Path to the wiki folder')
    .action(async (options) => {
      try {
        const wikiRootFolder = path.dirname(config.paths.wikiRoot);
        const adjustedWikiRoot = options.wikiPath || 
                               path.join(config.paths.wikiRoot, 'Date-Code');
        
        logger.info(`Wiki root folder: ${wikiRootFolder}`);
        logger.info(`Adjusted wiki root: ${adjustedWikiRoot}`);
        
        await runLocalTest(adjustedWikiRoot, program.opts().output, { wikiRootFolder });
      } catch (error) {
        logger.error('Error running local test:', error);
        process.exit(1);
      }
    });

  // Migrate command
  program
    .command('migrate')
    .description('Migrate wiki pages to Confluence')
    .option('-s, --single <page>', 'Migrate a single page')
    .option('-p, --parent <id>', 'Confluence parent page ID')
    .action(async (options) => {
      try {
        // Enable debug mode if specified
        if (program.opts().debug) {
          logger.info('Running in debug mode - full logging enabled');
          process.env.DEBUG = 'true';
        }

        // Test authentication before proceeding
        const authSuccessful = await testAuthentication();
        if (!authSuccessful) {
          logger.error('Authentication failed. Exiting.');
          process.exit(1);
        }

        // Override parent page ID if provided
        if (options.parent) {
          config.confluence.parentPageId = options.parent;
          logger.debug(`Using custom parent page ID: ${options.parent}`);
        }

        // Handle single page migration
        if (options.single) {
          logger.info(`Migrating single page: ${options.single}`);
          process.env.SINGLE_PAGE = options.single;
        }

        // Start the migration process
        await startConfluenceProcess(confluenceClient);
        logger.info('Migration completed successfully');
      } catch (error) {
        handleApiError(error);
        process.exit(1);
      }
    });

  // Parse command line arguments
  program.parse();
}

// Run the main function
main();
