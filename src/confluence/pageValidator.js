const { logger } = require("../utils");
const fs = require("fs-extra");
const path = require("path");

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

  async function checkPage(page) {
    if (processed.has(page.title)) {
      duplicates.push({
        title: page.title,
        path: page.path,
        reason: "Duplicate title within wiki",
      });
      return;
    }

    processed.add(page.title);

    try {
      const existingPage = await confluenceClient.getPageByTitle(
        spaceKey,
        page.title
      );
      if (existingPage) {
        duplicates.push({
          title: page.title,
          confluenceId: existingPage.id,
          path: page.path,
          reason: "Page already exists in Confluence",
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
