const { convertMarkdownToConfluenceHtml } = require("./markdownConverter");
const { uploadAttachments } = require("./attachmentOperations");
const { logger } = require("../utils");
const { sanitizeTitle } = require("./wikiParser");

/**
 * Create or update a Confluence page
 * @param {Object} page - Page object with content
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} spaceKey - Space key
 * @param {string} parentPageId - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
 * @param {Object} pagesIdMap - Map of page titles to their IDs
 * @param {boolean} InitializingallPages - Whether this is an initial page creation
 * @param {Object} pageFixes - Map of original titles to fixed titles
 * @returns {Promise<string>} Created page ID
 */
async function createOrUpdatePage(
  page,
  confluenceClient,
  confluenceConfig,
  spaceKey,
  parentPageId,
  attachmentMappings,
  pagesIdMap,
  InitializingallPages,
  pageFixes = {}
) {
  try {
    // Ensure we have a readable title - decode it if necessary for display
    let originalTitle = page.title;
    try {
      // Try to decode the title to ensure it's user-friendly
      originalTitle = decodeURIComponent(originalTitle);
    } catch (e) {
      console.warn(`Unable to decode page title "${page.title}": ${e.message}`);
    }

    // Use the fixed title if available
    const pageTitle = pageFixes[originalTitle] || originalTitle;
    console.log(
      `Creating/updating page: ${pageTitle} (Original: ${originalTitle})`
    );

    // Validate page object and content
    if (!page || typeof page !== "object") {
      throw new Error("Invalid page object provided");
    }

    // Ensure page.content exists and is a string
    let pageContent = page.content;
    if (!pageContent) {
      console.warn(
        `No content found for page ${pageTitle}, using empty content`
      );
      pageContent = "";
    }

    // If content is a promise, resolve it
    if (pageContent instanceof Promise) {
      try {
        pageContent = await pageContent;
      } catch (error) {
        console.error(
          `Error resolving content promise for page ${pageTitle}:`,
          error
        );
        pageContent = "";
      }
    }

    // Check if page already exists
    let existingPage;
    let pageId;

    console.log(`spaceKey: ${spaceKey}`);
    console.log(`parentPageId: ${parentPageId}`);

    // Check if page exists by its current title (possibly fixed)
    console.log(`Checking if page "${pageTitle}" exists...`);
    try {
      existingPage = await getPageByTitle(
        confluenceClient,
        spaceKey,
        pageTitle
      );

      // If not found by fixed title, try original title
      if (!existingPage && pageTitle !== originalTitle) {
        existingPage = await getPageByTitle(
          confluenceClient,
          spaceKey,
          originalTitle
        );
      }
    } catch (e) {
      console.error(`Error checking page "${pageTitle}":`, e);
    }

    console.log(`Existing page: ${existingPage ? "Yes" : "No"}`);
    if (existingPage) {
      pageId = existingPage.id;
      if (InitializingallPages && pageId) {
        logger.warn(
          `Skipping page "${pageTitle}" as it's in the already processed pages list.`
        );
        return pageId;
      }
      // First upload attachments using the new function
      if (attachmentMappings && Object.keys(attachmentMappings).length > 0) {
        try {
          await uploadAttachments(
            confluenceClient,
            pageId,
            page.path,
            attachmentMappings
          );
        } catch (uploadError) {
          console.error("Error uploading attachments:", uploadError);
        }
      }

      // Then convert content with updated attachment references
      const htmlContent = await convertMarkdownToConfluenceHtml(
        pageContent,
        attachmentMappings,
        page.path,
        confluenceClient,
        pageId,
        pagesIdMap,
        pageFixes
      );

      // Update page with processed content and current title
      await updatePage(
        confluenceClient,
        pageId,
        pageTitle,
        htmlContent,
        spaceKey
      );
    } else {
      // Create new page with temporary content
      pageId = await createPage(
        confluenceClient,
        parentPageId,
        pageTitle,
        "<p>Initializing page...</p>",
        spaceKey
      );

      // Upload attachments using the new function
      if (attachmentMappings && Object.keys(attachmentMappings).length > 0) {
        try {
          await uploadAttachments(
            confluenceClient,
            pageId,
            page.path,
            attachmentMappings
          );
        } catch (uploadError) {
          console.error("Error uploading attachments:", uploadError);
        }
      }

      // Update with full content including attachment references
      const htmlContent = await convertMarkdownToConfluenceHtml(
        pageContent,
        attachmentMappings,
        page.path,
        confluenceClient,
        pageId,
        pagesIdMap,
        pageFixes
      );

      await updatePage(
        confluenceClient,
        pageId,
        pageTitle,
        htmlContent,
        spaceKey
      );
    }

    return pageId;
  } catch (error) {
    console.error(`Error creating/updating page "${page.title}":`, error);
    throw error;
  }
}

/**
 * Delete all pages under a given parent page in Confluence
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} parentPageId - Parent page ID
 * @returns {Promise<void>}
 */
async function deletePagesUnderParent(confluenceClient, parentPageId) {
  try {
    logger.info(`Deleting all pages under parent page ID: ${parentPageId}`);
    const children = await confluenceClient.getChildren(parentPageId);

    for (const child of children) {
      await confluenceClient.deletePage(child.id);
      logger.info(`Deleted page ${child.title} (${child.id})`);
    }

    logger.info("All child pages deleted successfully");
  } catch (error) {
    logger.error("Error deleting pages:", error);
    throw error;
  }
}

/**
 * Get a page by title using the custom ConfluenceClient
 * @param {Object} confluenceClient - Custom Confluence API client
 * @param {string} spaceKey - Space key
 * @param {string} title - Page title
 * @returns {Promise<Object|null>} Page object or null if not found
 */
async function getPageByTitle(confluenceClient, spaceKey, title) {
  try {
    return await confluenceClient.getPageByTitle(spaceKey, title);
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create a new page using the custom ConfluenceClient
 * @param {Object} confluenceClient - Custom Confluence API client
 * @param {string} parentPageId - Parent page ID
 * @param {string} title - Page title
 * @param {string} content - Page content (HTML)
 * @param {string} spaceKey - Space key
 * @returns {Promise<string>} Created page ID
 */
async function createPage(
  confluenceClient,
  parentPageId,
  title,
  content,
  spaceKey
) {
  try {
    const pageData = {
      type: "page",
      title: title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
      ancestors: [{ id: parentPageId }],
    };

    const response = await confluenceClient.createPage(pageData);
    console.log(`Created page "${title}" with ID ${response.id}`);
    return response.id;
  } catch (error) {
    console.error(`Error creating page ${title}:`, error);
    throw error;
  }
}

/**
 * Update an existing page using the custom ConfluenceClient
 * @param {Object} confluenceClient - Custom Confluence API client
 * @param {string} pageId - Page ID
 * @param {string} title - Page title
 * @param {string} content - Page content (HTML)
 * @param {string} spaceKey - Space key
 * @returns {Promise<string>} Updated page ID
 */
async function updatePage(confluenceClient, pageId, title, content, spaceKey) {
  try {
    // Get current page version
    const currentPage = await confluenceClient.getPageById(pageId, {
      expand: "version",
    });
    const version = parseInt(currentPage.version.number, 10) + 1;

    const pageData = {
      id: pageId,
      type: "page",
      title: title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: content,
          representation: "storage",
        },
      },
      version: { number: version },
    };

    const response = await confluenceClient.updatePage(pageId, pageData);
    console.log(`Updated page "${title}" with ID ${response.id}`);
    return response.id;
  } catch (error) {
    console.error(`Error updating page ${pageId}:`, error);
    throw error;
  }
}

module.exports = {
  createOrUpdatePage,
  deletePagesUnderParent,
};
