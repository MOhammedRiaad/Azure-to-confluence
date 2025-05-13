const { countPages, logger } = require("../utils");
const {
  createOrUpdatePage,
  deletePagesUnderParent,
} = require("./pageOperations");

/**
 * Create Confluence pages from wiki structure
 * @param {Object} wikiStructure - Wiki structure
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} spaceKey - Confluence space key
 * @param {string} parentPageId - Parent page ID
 * @param {Object} attachmentMappings - Attachment mappings
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {Object} pageFixes - Map of original titles to fixed titles
 * @returns {Promise<void>}
 */
async function createConfluencePages(
  wikiStructure,
  confluenceClient,
  spaceKey,
  parentPageId,
  attachmentMappings,
  confluenceConfig,
  pageFixes = {}
) {
  try {
    logger.info("Creating Confluence pages...");
    logger.info(`Space key: ${spaceKey}`);
    logger.info(`Parent page ID: ${parentPageId}`);
    logger.info(`Total pages to create: ${countPages(wikiStructure.pages)}`);

    const pageIdMap = {};
    logger.info("Starting page creation process...");

    // Create initial pages
    await processAllPages(
      wikiStructure.pages,
      confluenceClient,
      confluenceConfig,
      spaceKey,
      parentPageId,
      attachmentMappings,
      pageIdMap,
      pageFixes
    );

    // Process pages with full content in hierarchical order
    await processPages(
      wikiStructure.pages,
      confluenceClient,
      confluenceConfig,
      spaceKey,
      parentPageId,
      attachmentMappings,
      pageIdMap,
      pageFixes
    );

    logger.info("All pages created successfully!");
  } catch (error) {
    console.error("Error creating Confluence pages:", error);
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
 * @param {Object} pageIdMap - Map of page titles to their IDs
 * @param {Object} pageFixes - Map of original titles to fixed titles
 * @returns {Promise<void>}
 */
async function processPages(
  pages,
  confluenceClient,
  confluenceConfig,
  spaceKey,
  parentPageId,
  attachmentMappings,
  pageIdMap,
  pageFixes
) {
  for (const page of pages) {
    try {
      const pageTitle = pageFixes[page.title] || page.title;
      logger.info(`Processing page: ${pageTitle}`);

      // Create or update the page
      const pageId = await createOrUpdatePage(
        page,
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings,
        pageIdMap,
        false,
        pageFixes
      );

      if (pageId) {
        pageIdMap[pageTitle] = pageId;
      }

      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          spaceKey,
          pageId,
          attachmentMappings,
          pageIdMap,
          pageFixes
        );
      }
    } catch (error) {
      console.error(`Error processing page ${page.title}:`, error);
    }
  }
}

/**
 * Process all pages initially to create page stubs
 * @param {Array} pages - List of pages to process
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} parentPageId - Parent page ID
 * @param {string} spaceKey - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
 * @param {Object} pageIdMap - Map of page titles to their IDs
 * @param {Object} pageFixes - Map of original titles to fixed titles
 * @returns {Promise<void>}
 */
async function processAllPages(
  pages,
  confluenceClient,
  confluenceConfig,
  spaceKey,
  parentPageId,
  attachmentMappings,
  pageIdMap,
  pageFixes
) {
  for (const page of pages) {
    try {
      const pageTitle = pageFixes[page.title] || page.title;
      const placeholderHtml = `<p>This page is being migrated from Azure DevOps Wiki.</p>`;

      logger.info(`Creating initial page: ${pageTitle}`);

      // Create or update the page with placeholder content
      const pageId = await createOrUpdatePage(
        {
          title: pageTitle,
          content: placeholderHtml,
          parentId: parentPageId,
          path: page.path,
        },
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings,
        pageIdMap,
        true,
        pageFixes
      );

      if (pageId) {
        pageIdMap[pageTitle] = pageId;
      }

      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processAllPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          spaceKey,
          pageId,
          attachmentMappings,
          pageIdMap,
          pageFixes
        );
      }
    } catch (error) {
      console.error(`Error processing page ${page.title}:`, error);
    }
  }
}

module.exports = {
  createConfluencePages,
};
