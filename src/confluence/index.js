const { parseWiki } = require("./wikiParser");
const { createConfluencePages } = require("./pageCreator");
const { getMimeType, logger } = require("../utils");
const { getConfig } = require("./config");
const {
  validatePages,
  saveValidationState,
  getValidationState,
  clearValidationState,
} = require("./pageValidator");
const path = require("path");
const fs = require("fs-extra");

// Initialize config
const config = getConfig();

/**
 * The starting point for migration to confluence
 */
async function startConfluenceProcess(confluenceClient) {
  if (!confluenceClient) {
    throw new Error("Confluence client is required");
  }

  const wikiStructure = await retryWithBackoff(() =>
    parseAndProcessWiki(config.paths.wikiRoot)
  );

  logger.info("Wiki structure parsed successfully.");

  // Filter out project directories
  wikiStructure.pages = filterOutProjectDir(wikiStructure.pages);
  logger.info(
    `Filtered wiki structure now has ${wikiStructure.pages.length} root pages`
  );

  // Check for existing validation state
  const existingValidation = await getValidationState();
  if (existingValidation.length > 0) {
    logger.info(
      "Found existing validation state with previously detected duplicate pages."
    );
    logger.info("Re-validating to check if issues have been resolved...");

    // Re-validate only the previously problematic pages
    const stillDuplicate = [];
    for (const duplicate of existingValidation) {
      // Check if page still exists in wiki structure
      const pageExists = findPageInStructure(
        wikiStructure.pages,
        duplicate.title
      );
      if (!pageExists) {
        logger.info(
          `Page "${duplicate.title}" no longer exists in wiki - cleared`
        );
        continue;
      }

      // For pages that existed in Confluence, check if they're still there
      if (duplicate.reason === "Page already exists in Confluence") {
        try {
          const existingPage = await confluenceClient.getPageByTitle(
            config.confluence.spaceKey,
            duplicate.title
          );
          if (existingPage) {
            stillDuplicate.push(duplicate);
            logger.warn(`Page "${duplicate.title}" still exists in Confluence`);
          } else {
            logger.info(
              `Page "${duplicate.title}" no longer exists in Confluence - cleared`
            );
          }
        } catch (error) {
          if (error.status !== 404) {
            logger.warn(
              `Error checking page "${duplicate.title}": ${error.message}`
            );
          }
        }
      } else {
        // For internal wiki duplicates, check if they're still duplicate
        const duplicateCount = countPagesWithTitle(
          wikiStructure.pages,
          duplicate.title
        );
        if (duplicateCount > 1) {
          stillDuplicate.push(duplicate);
          logger.warn(
            `Page "${duplicate.title}" still has ${duplicateCount} instances in wiki`
          );
        } else {
          logger.info(
            `Page "${duplicate.title}" is no longer duplicate in wiki - cleared`
          );
        }
      }
    }

    // If no more duplicates exist, clear the validation state
    if (stillDuplicate.length === 0) {
      logger.info("All previously detected issues have been resolved!");
      await clearValidationState();
    } else {
      // Update validation state with remaining issues
      await saveValidationState(stillDuplicate);
      logger.error("Some duplicate pages still need to be resolved:");
      stillDuplicate.forEach((duplicate) => {
        logger.error(`- "${duplicate.title}" (${duplicate.reason})`);
      });
      logger.error(
        "Please resolve remaining duplicate page names before proceeding with migration."
      );
      process.exit(1);
    }
  }

  // Validate all pages for new duplicates
  const newDuplicates = await validatePages(
    confluenceClient,
    config.confluence.spaceKey,
    wikiStructure.pages
  );

  if (newDuplicates.length > 0) {
    // Save validation state
    await saveValidationState(newDuplicates);

    logger.error("Found new duplicate pages that need to be resolved:");
    newDuplicates.forEach((duplicate) => {
      logger.error(`- "${duplicate.title}" (${duplicate.reason})`);
    });

    logger.error(
      "Please resolve duplicate page names and try again. Current validation state has been saved."
    );
    process.exit(1);
  }

  // Create a mappings object for attachments
  const attachmentMappings = {};

  // Log attachment info
  if (wikiStructure.attachments && wikiStructure.attachments.length > 0) {
    logger.info(
      `Found ${wikiStructure.attachments.length} attachments in wiki structure`
    );

    // Initialize attachment mappings
    wikiStructure.attachments.forEach((attachment) => {
      const attachmentKey = attachment.path;
      attachmentMappings[attachmentKey] = {
        path: attachment.path,
        name: attachment.name,
        size: attachment.size,
        mimeType: getMimeType(attachment.path),
        processed: false,
      };
    });
  } else {
    logger.info("No attachments found in wiki structure");
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

  console.log("Wiki conversion completed successfully!");
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
    wikiStructure.pages = await findAttachmentDirectories(
      wikiStructure.pages,
      wikiPath
    );

    console.log(`Processing attachments...`);
    // Process attachments
    wikiStructure.attachments = await processAttachments(
      wikiStructure,
      wikiPath
    );

    return wikiStructure;
  } catch (error) {
    console.error("Error parsing and processing wiki:", error);
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
  pages.forEach((page) => {
    if (!page.content && page.path.endsWith(".md")) {
      console.warn(`No content found for page: ${page.path}`);
    }
    if (page.children && page.children.length > 0) {
      validatePageContent(page.children);
    }
  });
}
const retryWithBackoff = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};
/**
 * Filter out project directory and irrelevant items from pages
 * @param {Array} pages - List of pages
 * @returns {Array} Filtered list of pages
 */
function filterOutProjectDir(pages) {
  if (!pages) return [];

  return pages
    .filter((page) => {
      // Exclude the project directory itself and node_modules
      const excludedDirs = [
        "azure-to-confluence",
        "node_modules",
        "src",
        "local-output",
        "test-output",
        ".git",
      ];
      return !excludedDirs.includes(page.title);
    })
    .map((page) => {
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
  console.log("Processing attachments...");

  // The exact path where the .attachments folder is located
  const attachmentsPath =
    config.paths.attachmentsDir ||
    path.join(path.dirname(wikiPath), ".attachments");
  console.log(`Checking for .attachments folder at: ${attachmentsPath}`);

  try {
    const attachmentsExists = await fs
      .stat(attachmentsPath)
      .then(() => true)
      .catch(() => false);

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
          size: stats.size,
        });
      }

      return attachments;
    } else {
      console.log("No .attachments folder found at the expected location");
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
  const processedPages = await Promise.all(
    pages.map(async (page) => {
      // Check if this is an attachment directory
      if (page.title === ".attachments") {
        page.isAttachmentDir = true;
        return page;
      }

      // Recursively process children
      if (page.children && page.children.length > 0) {
        page.children = await findAttachmentDirectories(
          page.children,
          wikiPath
        );
      }

      return page;
    })
  );

  return processedPages;
}

/**
 * Find a page with given title in the wiki structure
 * @param {Array} pages - List of pages
 * @param {string} title - Page title to find
 * @returns {boolean} - True if page exists
 */
function findPageInStructure(pages, title) {
  for (const page of pages) {
    if (page.title === title) {
      return true;
    }
    if (page.children && page.children.length > 0) {
      if (findPageInStructure(page.children, title)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count number of pages with given title in the wiki structure
 * @param {Array} pages - List of pages
 * @param {string} title - Page title to count
 * @returns {number} - Number of pages with title
 */
function countPagesWithTitle(pages, title) {
  let count = 0;
  for (const page of pages) {
    if (page.title === title) {
      count++;
    }
    if (page.children && page.children.length > 0) {
      count += countPagesWithTitle(page.children, title);
    }
  }
  return count;
}

module.exports = {
  startConfluenceProcess,
};
