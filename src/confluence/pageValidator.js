const { logger } = require("../utils");
const fs = require("fs-extra");
const path = require("path");
const { loadFixes } = require("./pageNameFixer");
const { sanitizeTitle } = require("./wikiParser");
const VALIDATION_FILE = path.join(process.cwd(), ".validation-state.json");

/**
 * Validates pages against Confluence to check for duplicates
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} spaceKey - Confluence space key
 * @param {Array} pages - List of wiki pages to check
 * @returns {Promise<Array>} - List of duplicate page titles
 */
async function validatePages(confluenceClient, spaceKey, pages) {
  const duplicates = [];
  const processed = new Set();

  // Load existing fixes
  const pageFixes = await loadFixes();

  async function checkPage(page) {
    // Skip pages that have already been fixed
    let sanitizedTitle = sanitizeTitle(page.title);
    const fixedTitle = pageFixes[sanitizedTitle];
    if (fixedTitle) {
      logger.info(
        `Skipping validation for fixed page "${page.title}" → "${fixedTitle}"`
      );
      return;
    }

    if (processed.has(sanitizedTitle)) {
      logger.info(`Skipping duplicate title "${sanitizedTitle}"`);
      // duplicates.push({
      //   title: sanitizedTitle,
      //   reason: "Duplicate title within wiki",
      //   path: page.path,
      // });
      return;
    }

    processed.add(sanitizedTitle);

    try {
      // Check if the page exists in Confluence, accounting for fixes
      const existingPage = await confluenceClient.getPageByTitle(
        spaceKey,
        sanitizedTitle
      );
      if (existingPage && !pageFixes[sanitizedTitle]) {
        duplicates.push({
          title: sanitizedTitle,
          confluenceId: existingPage.id,
          reason: "Page already exists in Confluence",
          path: page.path,
        });
      }
    } catch (error) {
      if (error.status !== 404) {
        logger.warn(`Error checking page "${page.title}": ${error.message}`);
      }
    }

    // Recursively check child pages
    if (page.children && page.children.length > 0) {
      for (const childPage of page.children) {
        await checkPage(childPage);
      }
    }
  }

  // Check all pages
  for (const page of pages) {
    await checkPage(page);
  }

  return duplicates;
}

/**
 * Save validation state to file
 * @param {Array} duplicates - List of duplicate pages
 */
async function saveValidationState(duplicates) {
  try {
    await fs.writeJson(VALIDATION_FILE, duplicates, { spaces: 2 });
    logger.info(`Validation state saved to ${VALIDATION_FILE}`);
  } catch (error) {
    logger.error("Error saving validation state:", error);
  }
}

/**
 * Get validation state from file
 * @returns {Promise<Array>} - List of duplicate pages
 */
async function getValidationState() {
  try {
    if (await fs.pathExists(VALIDATION_FILE)) {
      return await fs.readJson(VALIDATION_FILE);
    }
    return [];
  } catch (error) {
    logger.error("Error reading validation state:", error);
    return [];
  }
}

/**
 * Clear validation state
 */
async function clearValidationState() {
  try {
    if (await fs.pathExists(VALIDATION_FILE)) {
      await fs.remove(VALIDATION_FILE);
      logger.info("Validation state cleared");
    }
  } catch (error) {
    logger.error("Error clearing validation state:", error);
  }
}

module.exports = {
  validatePages,
  saveValidationState,
  getValidationState,
  clearValidationState,
};
