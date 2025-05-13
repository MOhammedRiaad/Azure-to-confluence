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
const { applyNameFixes, saveFixes, loadFixes } = require("./pageNameFixer");
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

  let wikiStructure = await retryWithBackoff(() =>
    parseAndProcessWiki(config.paths.wikiRoot)
  );

  logger.info("Wiki structure parsed successfully.");

  if (config.project.passValidation == 0) {
    logger.info("Validation passed. Proceeding with migration.");

    // Load any existing page fixes
    const pageFixes = await loadFixes();
    if (Object.keys(pageFixes).length > 0) {
      logger.info("Loaded existing page fixes:");
      Object.entries(pageFixes).forEach(([original, fixed]) => {
        logger.info(`- "${original}" → "${fixed}"`);
      });
    }

    // Check for existing validation state
    const existingValidation = await getValidationState();
    if (existingValidation.length > 0) {
      throw new Error(
        "Found existing duplicate page names. Please review and fix the duplicates before proceeding with migration."
      );
    }

    // Validate all pages for duplicates, considering existing fixes
    const duplicates = await validatePages(
      confluenceClient,
      config.confluence.spaceKey,
      wikiStructure.pages
    );

    if (duplicates.length > 0) {
      // Save validation state
      await saveValidationState(duplicates);
      throw new Error(
        "Found duplicate page names that need to be resolved. Use the menu to review and fix the duplicates."
      );
    }
  }
  // Filter out project directories
  wikiStructure.pages = filterOutProjectDir(wikiStructure.pages);
  logger.info(
    `Filtered wiki structure now has ${wikiStructure.pages.length} root pages`
  );

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

  // Create all pages with their attachments, passing the page fixes
  await retryWithBackoff(() =>
    createConfluencePages(
      wikiStructure,
      confluenceClient,
      config.confluence.spaceKey,
      config.confluence.parentPageId,
      attachmentMappings,
      config,
      (pageFixes = {})
    )
  );

  console.log("Wiki conversion completed successfully!");
}

/**
 * Auto-fix duplicate page names
 */
async function fixPageNames(confluenceClient, config) {
  if (!confluenceClient) {
    throw new Error("Confluence client is required");
  }

  // Load existing validation state
  const duplicates = await getValidationState();
  if (!duplicates || duplicates.length === 0) {
    throw new Error(
      "No duplicate pages found in validation state. Run migration first to detect duplicates."
    );
  }

  // Parse wiki structure
  let wikiStructure = await retryWithBackoff(() =>
    parseAndProcessWiki(config.paths.wikiRoot)
  );

  // Filter out project directories
  wikiStructure.pages = filterOutProjectDir(wikiStructure.pages);

  // Apply fixes using project name
  const projectName = config.project.name || "Project";
  const { wikiStructure: fixedStructure, fixes } = await applyNameFixes(
    wikiStructure,
    duplicates,
    projectName
  );

  // Save the applied fixes
  await saveFixes(fixes);

  // Log the changes
  logger.info("Applied the following page name fixes:");
  Object.entries(fixes).forEach(([original, fixed]) => {
    logger.info(`- "${original}" → "${fixed}"`);
  });

  // Clear validation state since we've applied fixes
  await clearValidationState();

  logger.info(
    "Page names fixed successfully. Please run the migration again to validate the changes."
  );
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
  fixPageNames,
};
