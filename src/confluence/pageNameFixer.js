const fs = require("fs-extra");
const path = require("path");
const { logger } = require("../utils");
const { getConfig } = require("./config");
const { sanitizeTitle } = require("./wikiParser");

/**
 * Generate a fixed page name by adding project prefix
 * @param {string} originalTitle - Original page title
 * @param {string} projectName - Project name to use as prefix
 * @returns {string} - Fixed page title
 */
function generateFixedPageName(originalTitle, projectName) {
  // Don't add prefix if it already starts with the project name
  originalTitle = sanitizeTitle(originalTitle);
  if (originalTitle.startsWith(`${projectName} - `)) {
    return originalTitle;
  }
  return `${projectName} - ${originalTitle}`;
}

/**
 * Apply name fixes to a wiki structure
 * @param {Object} wikiStructure - Wiki structure object
 * @param {Array} duplicates - List of duplicate pages
 * @param {string} projectName - Project name to use as prefix
 * @returns {Object} - Updated wiki structure and fixes applied
 */
async function applyNameFixes(wikiStructure, duplicates, projectName) {
  const fixes = new Map();
  const processed = new Set();

  function fixPageNames(pages) {
    return pages.map((page) => {
      const newPage = { ...page };

      // Only fix pages that are in the duplicates list
      if (
        duplicates.some((d) => d.title === page.title) &&
        !processed.has(page.title)
      ) {
        const fixedTitle = generateFixedPageName(page.title, projectName);
        fixes.set(page.title, fixedTitle);
        processed.add(page.title);
        newPage.title = fixedTitle;
        newPage.originalTitle = page.title; // Keep track of original title
      }

      // Recursively process children
      if (page.children && page.children.length > 0) {
        newPage.children = fixPageNames(page.children);
      }

      return newPage;
    });
  }

  // Apply fixes to the wiki structure
  const updatedStructure = {
    ...wikiStructure,
    pages: fixPageNames(wikiStructure.pages),
  };

  return {
    wikiStructure: updatedStructure,
    fixes: Object.fromEntries(fixes),
  };
}

/**
 * Save applied fixes to a file for reference
 * @param {Object} fixes - Map of original titles to fixed titles
 */
async function saveFixes(fixes) {
  const fixesFile = path.join(process.cwd(), ".page-name-fixes.json");
  await fs.writeJson(fixesFile, fixes, { spaces: 2 });
  logger.info(`Page name fixes saved to ${fixesFile}`);
}

/**
 * Load previously applied fixes
 * @returns {Promise<Object>} - Map of original titles to fixed titles
 */
async function loadFixes() {
  const fixesFile = path.join(process.cwd(), ".page-name-fixes.json");
  try {
    if (await fs.pathExists(fixesFile)) {
      return await fs.readJson(fixesFile);
    }
  } catch (error) {
    logger.warn(`Error loading page name fixes: ${error.message}`);
  }
  return {};
}

module.exports = {
  generateFixedPageName,
  applyNameFixes,
  saveFixes,
  loadFixes,
};
