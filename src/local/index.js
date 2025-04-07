/**
 * Main entry point for local testing of the wiki conversion
 */

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils');
const { parseWiki } = require('./wikiParser');
const { createIndexFile } = require('./htmlGenerator');
const { createLocalPages } = require('./pageGenerator');
const { processAttachmentsLocally } = require('./attachmentProcessor');

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

module.exports = {
  runLocalTest
}; 