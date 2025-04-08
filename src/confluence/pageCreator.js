const { marked } = require('marked');
const path = require('path');
const fs = require('fs-extra');
const { countPages } = require('../utils');
const { sanitizeTitle } = require('./wikiParser');
const { createOrUpdatePage, deletePagesUnderParent } = require('./pageOperations');



/**
 * Create Confluence pages from wiki structure
 * @param {Object} wikiStructure - Wiki structure
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} spaceKey - Confluence space key
 * @param {string} parentPageId - Parent page ID
 * @param {Object} attachmentMappings - Attachment mappings
 * @param {Object} confluenceConfig - Confluence API client
 * @returns {Promise<void>}
 */
async function createConfluencePages(wikiStructure, confluenceClient, spaceKey, parentPageId, attachmentMappings, confluenceConfig) {
  try {
    console.log('Creating Confluence pages...');
    console.log(`Space key: ${spaceKey}`);
    console.log(`Parent page ID: ${parentPageId}`);
    console.log(`Total pages to create: ${countPages(wikiStructure.pages)}`);
    try {
      console.log(`Starting deletion of all pages under parent page ID: ${parentPageId}`);
      //await deletePagesUnderParent(confluenceClient, parentPageId);
      console.log('All pages deleted successfully!');
    } catch (error) {
      console.error('Error deleting pages:', error);
    }

    // Process pages in hierarchical order
    await processPages(wikiStructure.pages, confluenceClient, confluenceConfig, spaceKey, parentPageId, attachmentMappings);
    
    console.log('All pages created successfully!');
  } catch (error) {
    console.error('Error creating Confluence pages:', error);
    throw error;
  }
}

/**
 * Process a list of pages using the custom ConfluenceClient
 * @param {Array} pages - List of pages to process
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} parentPageId - Parent page ID
 * @param {string} spaceKey - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
 * @returns {Promise<void>}
 */
async function processPages(pages, confluenceClient, confluenceConfig, spaceKey, parentPageId, attachmentMappings) {
  for (const page of pages) {
    try {
      console.log(`Processing page: ${page.title}`);
      
      // Create or update the page
      const pageId = await createOrUpdatePage(
        page,
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings
      );

      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          spaceKey,
          pageId,
          attachmentMappings
        );
      }
    } catch (error) {
      console.error(`Error processing page ${page.title}:`, error);
    }
  }
}








module.exports = {
  createConfluencePages
};