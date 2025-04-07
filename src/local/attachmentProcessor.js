/**
 * Module for handling attachments in local preview
 */

const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils');

/**
 * Process attachments for local preview
 * @param {string} wikiRootPath - Path to the Azure DevOps wiki root
 * @param {string} outputPath - Path to save the output
 * @param {string} wikiRootFolder - Wiki root folder (for attachments)
 * @returns {Promise<number>} - Number of attachments processed
 */
async function processAttachmentsLocally(wikiRootPath, outputPath, wikiRootFolder) {
  // Find the .attachments directory in the wiki root folder
  const attachmentsSourcePath = path.join(wikiRootFolder, '.attachments');
  const attachmentsOutputPath = path.join(outputPath, 'attachments');
  
  // Check if attachments directory exists
  if (!(await fs.pathExists(attachmentsSourcePath))) {
    logger.warn(`No .attachments directory found at ${attachmentsSourcePath}`);
    return 0;
  }
  
  logger.info(`Found attachments directory at ${attachmentsSourcePath}`);
  await fs.ensureDir(attachmentsOutputPath);
  
  try {
    // Get all files in the attachments directory (recursive)
    const files = await getAllFiles(attachmentsSourcePath);
    logger.info(`Found ${files.length} attachment files`);
    
    // Copy each file to the output directory
    let processedCount = 0;
    for (const filePath of files) {
      try {
        // Get relative path from attachmentsSourcePath
        const relativePath = path.relative(attachmentsSourcePath, filePath);
        const outputFilePath = path.join(attachmentsOutputPath, relativePath);
        
        // Create directory if it doesn't exist
        await fs.ensureDir(path.dirname(outputFilePath));
        
        // Copy file
        await fs.copy(filePath, outputFilePath);
        processedCount++;
        
        logger.debug(`Copied attachment: ${relativePath}`);
      } catch (error) {
        logger.error(`Error copying attachment ${filePath}: ${error.message}`);
      }
    }
    
    logger.info(`Processed ${processedCount} attachment files`);
    return processedCount;
  } catch (error) {
    logger.error(`Error processing attachments: ${error.message}`);
    return 0;
  }
}

/**
 * Get all files in a directory recursively
 * @param {string} dirPath - Directory path
 * @param {Array<string>} [arrayOfFiles=[]] - Array of files (for recursion)
 * @returns {Promise<Array<string>>} - Array of file paths
 */
async function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        // Recursively get files from subdirectories
        await getAllFiles(filePath, arrayOfFiles);
      } else {
        arrayOfFiles.push(filePath);
      }
    }
    
    return arrayOfFiles;
  } catch (error) {
    logger.error(`Error reading directory ${dirPath}: ${error.message}`);
    return arrayOfFiles;
  }
}

module.exports = {
  processAttachmentsLocally
}; 