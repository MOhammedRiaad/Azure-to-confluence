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
 * @param {Object} confluenceConfig - Confluence API client
 * @returns {Promise<void>}
 */
async function createConfluencePages(
  wikiStructure,
  confluenceClient,
  spaceKey,
  parentPageId,
  attachmentMappings,
  confluenceConfig
) {
  try {
    logger.info("Creating Confluence pages...");
    logger.info(`Space key: ${spaceKey}`);
    logger.info(`Parent page ID: ${parentPageId}`);
    logger.info(`Total pages to create: ${countPages(wikiStructure.pages)}`);
    try {
      logger.info(
        `Starting deletion of all pages under parent page ID: ${parentPageId}`
      );
      //await deletePagesUnderParent(confluenceClient, parentPageId);
      logger.info("All pages deleted successfully!");
    } catch (error) {
      console.error("Error deleting pages:", error);
    }
    const pagesIdMap = {};
    logger.info("Start all pages with initial data !");

    Promise.all(
      await processALLPages(
        wikiStructure.pages,
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings,
        pagesIdMap
      )
    )
      .then(() => {
        logger.info("All pages created successfully!");
      })
      .catch((error) => {
        logger.error("Error creating pages:", error);
      });
    logger.info("complete all pages with initial data !");

    logger.info("Start all pages with its data !");
    // Process pages in hierarchical order
    await processPages(
      wikiStructure.pages,
      confluenceClient,
      confluenceConfig,
      spaceKey,
      parentPageId,
      attachmentMappings,
      pagesIdMap
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
 * @returns {Promise<void>}
 */
async function processPages(
  pages,
  confluenceClient,
  confluenceConfig,
  spaceKey,
  parentPageId,
  attachmentMappings,
  pagesIdMap
) {
  for (const page of pages) {
    try {
      logger.info(`Processing page: ${page.title}`);

      // Create or update the page
      const pageId = await createOrUpdatePage(
        page,
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings,
        pagesIdMap,
        false
      );

      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          spaceKey,
          pageId,
          attachmentMappings,
          pagesIdMap
        );
      }
    } catch (error) {
      console.error(`Error processing page ${page.title}:`, error);
    }
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
async function processALLPages(
  pages,
  confluenceClient,
  confluenceConfig,
  spaceKey,
  parentPageId,
  attachmentMappings,
  pageIdMap
) {
  for (const page of pages) {
    try {
      const placeholderHtml = `<p>This page is being migrated from Azure DevOps Wiki.</p>`;
      logger.info(`Processing page: ${page.title}`);
      // Create or update the page
      const pageId = await createOrUpdatePage(
        {
          title: page.title,
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
        true
      );

      if (pageId) {
        pageIdMap[page.title] = pageId; // Map title to ID
      }
      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processALLPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          spaceKey,
          pageId,
          attachmentMappings,
          pageIdMap
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
