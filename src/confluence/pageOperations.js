// const { sanitizePageTitle } = require('./sanitize');
const { convertMarkdownToConfluenceHtml } = require("./markdownConverter");
const { uploadAttachments } = require("./attachmentOperations");
const { logger } = require("../utils");

/**
 * Create or update a Confluence page
 * @param {Object} page - Page object with content
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} spaceKey - Space key
 * @param {string} parentPageId - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
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
  InitializingallPages
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

    console.log(`Creating/updating page: ${originalTitle}`);

    // Validate page object and content
    if (!page || typeof page !== "object") {
      throw new Error("Invalid page object provided");
    }

    // Ensure page.content exists and is a string
    let pageContent = page.content;
    if (!pageContent) {
      console.warn(
        `No content found for page ${originalTitle}, using empty content`
      );
      pageContent = "";
    }

    // If content is a promise, resolve it
    if (pageContent instanceof Promise) {
      try {
        pageContent = await pageContent;
      } catch (error) {
        console.error(
          `Error resolving content promise for page ${originalTitle}:`,
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
    // Check if page exists by its original title
    console.log(`Checking if page "${originalTitle}" exists...`);
    try {
      existingPage = await getPageByTitle(
        confluenceClient,
        spaceKey,
        originalTitle
      );
    } catch (e) {
      console.error(`Error checking page "${originalTitle}":`, e);
    }

    console.log(`Existing page: ${existingPage ? "Yes" : "No"}`);
    if (existingPage) {
      pageId = existingPage.id;
      if (InitializingallPages && pageId) {
        logger.warn(
          `Skipping page "${originalTitle}" as it's in the already processed pages list.`
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
        pagesIdMap
      );

      // Update page with processed content and original title
      await updatePage(
        confluenceClient,
        pageId,
        originalTitle,
        htmlContent,
        spaceKey
      );
    } else {
      // Create new page with temporary content
      pageId = await createPage(
        confluenceClient,
        parentPageId,
        originalTitle,
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
        pageId
      );

      await updatePage(
        confluenceClient,
        pageId,
        originalTitle,
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
    console.log(`Fetching child pages for parent page ID: ${parentPageId}`);

    // Fetch child pages of the parent page
    const childPages = await confluenceClient.getChildPages(parentPageId);

    if (childPages && childPages.length > 0) {
      console.log(
        `Found ${childPages.length} child pages under parent page ID: ${parentPageId}`
      );

      // Recursively delete child pages
      for (const childPage of childPages) {
        console.log(
          `Deleting child page: ${childPage.title} (ID: ${childPage.id})`
        );
        await deletePagesUnderParent(confluenceClient, childPage.id);
      }
    }

    // Delete the parent page after all child pages are deleted
    console.log(`Deleting parent page ID: ${parentPageId}`);
    await confluenceClient.deletePage(parentPageId);
    console.log(`Successfully deleted page ID: ${parentPageId}`);
  } catch (error) {
    console.error(
      `Error deleting pages under parent page ID ${parentPageId}:`,
      error
    );
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
    console.log(`Getting page by title: ${title} in space: ${spaceKey}`);
    const page = await confluenceClient.getPageByTitle(spaceKey, title, {
      expand: "version",
    });

    if (page) {
      console.log(`Found page with ID: ${page.id}`);
    } else {
      console.log(`No page found with title: ${title}`);
    }

    return page;
  } catch (error) {
    console.error(`Error getting page by title ${title}:`, error);
    return null;
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
    ancestors: parentPageId ? [{ id: parentPageId }] : [],
  };

  try {
    const response = await confluenceClient.createPage(pageData);
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
