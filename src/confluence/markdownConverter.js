const { logger } = require("../utils");
const { getBlobUrl } = require("./attachmentOperations");
const marked = require("marked");

/**
 * Creates a standardized Confluence image macro with proper blob URL support
 * @param {string} attachmentName - Name of the attachment file
 * @param {string} [altText] - Alternative text for the image
 * @param {Object} [options] - Additional options
 * @param {string} [options.pageId] - Page ID for blob URL retrieval
 * @param {Object} [options.confluenceClient] - Confluence client for API calls
 * @param {boolean} [options.preferBlobUrl=true] - Whether to prefer blob URLs over attachment references
 * @returns {Promise<string>} - Confluence image macro markup
 */
async function createConfluenceImageMacro(
  attachmentName,
  altText = "",
  options = {}
) {
  const { pageId, confluenceClient, preferBlobUrl = true } = options;

  // Check if the attachment name has a size parameter
  const hasWidthParameter =
    attachmentName.includes("=") && attachmentName.split("=")[1].includes("x");
  let width = "";

  // Extract attachment name without size parameter if present
  let cleanAttachmentName = attachmentName;
  if (hasWidthParameter) {
    const parts = attachmentName.split("=");
    cleanAttachmentName = parts[0].trim();
    // Extract width number from format like "750x"
    const sizeStr = parts[1].trim();
    if (sizeStr.includes("x")) {
      width = sizeStr.split("x")[0];
    }
  }

  if (preferBlobUrl && pageId && confluenceClient) {
    try {
      const blobUrl = await getBlobUrl(
        confluenceClient,
        pageId,
        cleanAttachmentName
      );
      if (blobUrl) {
        // Include width parameter if present
        if (width) {
          return `<ac:image${
            altText ? ` ac:alt="${altText}"` : ""
          }><ri:url ri:value="${blobUrl}" /><ac:parameter ac:name="width">${width}</ac:parameter></ac:image>`;
        } else {
          return `<ac:image${
            altText ? ` ac:alt="${altText}"` : ""
          }><ri:url ri:value="${blobUrl}" /></ac:image>`;
        }
      }
    } catch (error) {
      logger.warn(`Error getting blob URL for ${cleanAttachmentName}:`, error);
    }
  }

  // Fallback to standard attachment reference with width if specified
  if (width) {
    return `<ac:image${
      altText ? ` ac:alt="${altText}"` : ""
    }><ri:attachment ri:filename="${cleanAttachmentName}" /><ac:parameter ac:name="width">${width}</ac:parameter></ac:image>`;
  } else {
    return `<ac:image${
      altText ? ` ac:alt="${altText}"` : ""
    }><ri:attachment ri:filename="${cleanAttachmentName}" /></ac:image>`;
  }
}

/**
 * Creates a standardized Confluence image macro (synchronous version)
 * @param {string} attachmentName - Name of the attachment file
 * @param {string} [altText] - Alternative text for the image
 * @returns {string} - Confluence image macro markup
 */
function createConfluenceImageMacroSync(attachmentName, altText = "") {
  // Check if the attachment name has a size parameter
  const hasWidthParameter =
    attachmentName.includes("=") && attachmentName.split("=")[1].includes("x");
  let width = "";

  // Extract attachment name without size parameter if present
  let cleanAttachmentName = attachmentName;
  if (hasWidthParameter) {
    const parts = attachmentName.split("=");
    cleanAttachmentName = parts[0].trim();
    // Extract width number from format like "750x"
    const sizeStr = parts[1].trim();
    if (sizeStr.includes("x")) {
      width = sizeStr.split("x")[0];
    }
  }

  // Add width parameter to the image macro if present in the original reference
  if (width) {
    return `<ac:image${
      altText ? ` ac:alt="${altText}"` : ""
    }><ri:attachment ri:filename="${cleanAttachmentName}" /><ac:parameter ac:name="width">${width}</ac:parameter></ac:image>`;
  } else {
    // Standard attachment reference without width
    return `<ac:image${
      altText ? ` ac:alt="${altText}"` : ""
    }><ri:attachment ri:filename="${cleanAttachmentName}" /></ac:image>`;
  }
}

/**
 * Converts Markdown images and documents to Confluence HTML.
 */
async function convertImages(
  content,
  attachmentMappings,
  confluenceClient,
  pageId
) {
  // We need to process each image replacement sequentially due to async operations
  let processedContent = content;

  // Handle simple image references like !image.png (without the square brackets)
  processedContent = processedContent.replace(
    /!([\w.-]+\.(png|jpg|jpeg|gif|svg))/gi,
    (match, filename) => {
      logger.info(`Processing simple image reference: ${match}`);
      return `![${filename}](/.attachments/${filename})`;
    }
  );

  // Helper function to process a single image match
  async function processImageMatch(match, alt, src) {
    logger.info(`Processing standard Markdown image: ${match}`);

    // Preserve original source path for sizing information
    const originalSrc = src;

    // Extract sizing information if present (e.g., =750x)
    let sizeInfo = "";
    if (originalSrc.includes(" =")) {
      // Format: path/to/image.png =750x
      const parts = originalSrc.split(" =");
      src = parts[0];
      sizeInfo = parts[1].trim();
    } else if (originalSrc.includes("=")) {
      // Format: path/to/image.png=750x
      const parts = originalSrc.split("=");
      src = parts[0];
      sizeInfo = parts[1].trim();
    }

    if (
      src.startsWith("/.attachments/") ||
      src.startsWith("../") ||
      src.includes("/attachments/")
    ) {
      const attachmentName = decodeURIComponent(src.split("/").pop());
      logger.info(`Extracted attachment name: ${attachmentName}`);

      // Add the size info if present
      const attachmentNameWithSize = sizeInfo
        ? `${attachmentName}=${sizeInfo}`
        : attachmentName;

      const attachmentKey = Object.keys(attachmentMappings).find((key) =>
        key.endsWith(attachmentName)
      );

      if (attachmentKey && attachmentMappings[attachmentKey]) {
        const attachment = attachmentMappings[attachmentKey];
        const mimeType = attachment.mimeType;

        // Use Confluence's native image/attachment handling for all types
        if (
          mimeType === "application/pdf" ||
          mimeType === "application/msword" ||
          mimeType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          // For PDF and Word documents, create a proper Confluence attachment macro
          return `<ac:structured-macro ac:name="view-file" ac:schema-version="1">
                        <ac:parameter ac:name="name">${attachmentName}</ac:parameter>
                        <ac:parameter ac:name="height">250</ac:parameter>
                    </ac:structured-macro>`;
        } else if (mimeType.startsWith("image/")) {
          // For images, use the utility function with size info
          return await createConfluenceImageMacro(
            attachmentNameWithSize,
            alt || attachmentName,
            { confluenceClient, pageId }
          );
        } else {
          // For other file types, use a download link macro
          return `<ac:link><ri:attachment ri:filename="${attachmentName}" /><ac:plain-text-link-body><![CDATA[${
            alt || attachmentName
          }]]></ac:plain-text-link-body></ac:link>`;
        }
      } else {
        // If attachmentKey is not found, try to get a blob URL with size info
        return await createConfluenceImageMacro(
          attachmentNameWithSize,
          alt || attachmentName,
          { confluenceClient, pageId }
        );
      }
    } else if (src.startsWith("http://") || src.startsWith("https://")) {
      // For external URLs, use the Confluence URL image macro
      return `<ac:image><ri:url ri:value="${src}" /></ac:image>`;
    } else {
      // For any other relative path, assume it's an attachment
      const attachmentName = decodeURIComponent(src.split("/").pop());

      // Add the size info if present
      const attachmentNameWithSize = sizeInfo
        ? `${attachmentName}=${sizeInfo}`
        : attachmentName;

      logger.info(
        `Converting relative attachment path: ${src} -> ${attachmentNameWithSize}`
      );
      return await createConfluenceImageMacro(
        attachmentNameWithSize,
        alt || attachmentName,
        { confluenceClient, pageId }
      );
    }
  }

  // Find all markdown image references
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const [fullMatch, alt, src] = match;
    const replacement = await processImageMatch(fullMatch, alt, src);
    processedContent = processedContent.replace(fullMatch, replacement);
  }

  // Handle wiki-style image links: ![[image.png]]
  const wikiImageRegex = /!\[\[([^|\]]+)(?:\|[^\]]*)?]]/g;
  let wikiMatch;
  while ((wikiMatch = wikiImageRegex.exec(processedContent)) !== null) {
    const [fullMatch, imagePath] = wikiMatch;
    logger.info(`Processing wiki-style image reference: ${fullMatch}`);

    if (!imagePath) continue;

    // Extract filename from path
    const attachmentName = decodeURIComponent(imagePath.split("/").pop());
    logger.info(`Extracted wiki-style attachment name: ${attachmentName}`);

    // Use the utility function
    const replacement = await createConfluenceImageMacro(
      attachmentName,
      attachmentName,
      { confluenceClient, pageId }
    );
    processedContent = processedContent.replace(fullMatch, replacement);
  }

  // Handle HTML img tags
  const htmlImgRegex = /<img[^>]*src=["']([^"']*)["'][^>]*>/g;
  let htmlMatch;
  while ((htmlMatch = htmlImgRegex.exec(processedContent)) !== null) {
    const [fullMatch, src] = htmlMatch;
    logger.info(`Processing HTML img tag: ${fullMatch.substring(0, 50)}...`);

    if (src.startsWith("http://") || src.startsWith("https://")) {
      // For external URLs, use Confluence URL image macro
      processedContent = processedContent.replace(
        fullMatch,
        `<ac:image><ri:url ri:value="${src}" /></ac:image>`
      );
    } else if (
      src.includes(".attachments/") ||
      src.includes("/attachments/") ||
      src.startsWith("../")
    ) {
      // Handle relative paths to attachments
      const attachmentName = decodeURIComponent(src.split("/").pop());
      logger.info(
        `Converting HTML img src to attachment: ${src} -> ${attachmentName}`
      );

      // Extract alt text if present
      const altMatch = fullMatch.match(/alt=["']([^"']*)["']/);
      const altText = altMatch ? altMatch[1] : attachmentName;

      // Use the utility function
      const replacement = await createConfluenceImageMacro(
        attachmentName,
        altText,
        { confluenceClient, pageId }
      );
      processedContent = processedContent.replace(fullMatch, replacement);
    }
  }

  return processedContent;
}

/**
 * Converts Markdown links to Confluence HTML.
 * @param {string} content - The Markdown content.
 * @returns {string} - The converted content.
 */
function convertLinks(content) {
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    return `<a href="${url}" target="_blank">${text}</a>`;
  });
}

/**
 * Converts Markdown code blocks to Confluence HTML.
 * @param {string} content - The Markdown content.
 * @param {Map<string, {language: string, code: string}>} codeBlocks - The map of code blocks.
 * @returns {string} - The converted content.
 */
function restoreCodeBlocks(content, codeBlocks) {
  // Input validation
  if (typeof content !== "string") {
    logger.warn(
      `restoreCodeBlocks received non-string content: ${typeof content}`
    );
    try {
      content = String(content || "");
    } catch (error) {
      console.error(
        "Failed to convert content to string in restoreCodeBlocks:",
        error
      );
      return "";
    }
  }

  // Validate codeBlocks is a Map
  if (!codeBlocks || typeof codeBlocks.forEach !== "function") {
    logger.warn(
      `restoreCodeBlocks received invalid codeBlocks: ${typeof codeBlocks}`
    );
    return content; // Return original content if codeBlocks is invalid
  }

  try {
    let restoredContent = content;
    codeBlocks.forEach((block, id) => {
      if (!block || typeof block !== "object") {
        logger.warn(`Invalid code block found for ID ${id}`);
        return; // Skip this block
      }

      // Extract with safe defaults
      const code = block.code || "";
      const language = block.language || "none";

      try {
        const escapedCode = code
          .replace(/&/g, "&amp;") // Escape special characters
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        restoredContent = restoredContent.replace(
          id,
          `
                  <ac:structured-macro ac:name="code" ac:schema-version="1">
                    <ac:parameter ac:name="theme">DarkStyle</ac:parameter>
                    <ac:parameter ac:name="linenumbers">true</ac:parameter>
                    <ac:parameter ac:name="language">${language}</ac:parameter>
                    <ac:plain-text-body><![CDATA[${escapedCode}]]></ac:plain-text-body>
                  </ac:structured-macro>
                `
        );
      } catch (blockError) {
        console.error(`Error processing code block ${id}:`, blockError);
        // Replace with an error message in the code block to help with debugging
        restoredContent = restoredContent.replace(
          id,
          `
                  <ac:structured-macro ac:name="code" ac:schema-version="1">
                    <ac:parameter ac:name="theme">DarkStyle</ac:parameter>
                    <ac:parameter ac:name="linenumbers">true</ac:parameter>
                    <ac:parameter ac:name="language">none</ac:parameter>
                    <ac:plain-text-body><![CDATA[Error processing code block: ${blockError.message}]]></ac:plain-text-body>
                  </ac:structured-macro>
                `
        );
      }
    });
    return restoredContent;
  } catch (error) {
    console.error("Error in restoreCodeBlocks:", error);
    // Return the original content if we hit an error
    return content;
  }
}

/**
 * Processes and extracts code blocks from the content.
 * @param {string} content - The Markdown content.
 * @returns {{content: string, codeBlocks: Map<string, {language: string, code: string}>}} - The processed content and code blocks.
 */
function processCodeBlocks(content) {
  // Input validation
  if (typeof content !== "string") {
    logger.warn(
      `processCodeBlocks received non-string content: ${typeof content}`
    );
    // Attempt to convert to string or use empty string
    try {
      content = String(content || "");
    } catch (error) {
      console.error("Failed to convert content to string:", error);
      // Return a safe default that won't break downstream processing
      return {
        content: "",
        codeBlocks: new Map(),
      };
    }
  }

  try {
    const codeBlocks = new Map();
    let codeBlockId = 0;

    const processedContent = content.replace(
      /```([\w-]*)\n([\s\S]*?)```/gm,
      (match, lang, code) => {
        const id = `__CODE_BLOCK_${codeBlockId++}__`;
        codeBlocks.set(id, {
          language: lang.trim() || "none",
          code: code.trim(),
        });
        return id;
      }
    );

    return { content: processedContent, codeBlocks };
  } catch (error) {
    console.error("Error processing code blocks:", error);
    // Return a safe result that won't break downstream processing
    return {
      content: content || "",
      codeBlocks: new Map(),
    };
  }
}

/**
 * Cleans up nested lists and extra whitespace in the content.
 * @param {string} content - The Markdown content.
 * @returns {string} - The cleaned content.
 */
function cleanupContent(content) {
  // Ensure content is a string to prevent TypeError: content.replace is not a function
  if (typeof content !== "string") {
    logger.warn(
      `cleanupContent received non-string content: ${typeof content}`
    );
    // Return a safe default if content is not a string
    return typeof content === "undefined"
      ? "<p>No content</p>"
      : String(content);
  }

  try {
    return content
      .replace(/<\/ul>\n<ul>/g, "")
      .replace(/<\/ol>\n<ol>/g, "")
      .replace(/\n\n+/g, "\n")
      .trim();
  } catch (error) {
    console.error("Error in cleanupContent:", error);
    // Return original content if any error occurs during replacement
    return content;
  }
}

/**
 * Processes Confluence specific links in the markdown content.
 * @param {string} content - The markdown content.
 * @param {Object} attachmentMappings - Mappings of attachments.
 * @param {string} pageId - The Confluence page ID.
 * @param {Object} pageIdMap - Map of page titles to their Confluence IDs.
 * @returns {string} - The processed content with Confluence links.
 */
function processConfluenceLinks(
  content,
  attachmentMappings,
  pageId,
  pageIdMap = {}
) {
  // Input validation
  if (typeof content !== "string") {
    logger.warn(
      `processConfluenceLinks received non-string content: ${typeof content}`
    );
    try {
      content = String(content || "");
    } catch (error) {
      console.error("Failed to convert content to string:", error);
      return "";
    }
  }

  try {
    // Get the Confluence space name from environment variables
    const confluenceSpace = process.env.CONFLUENCE_SPACE_KEY;
    const baseUrl = process.env.CONFLUENCE_BASE_URL;
    let processedContent = content;

    // Process wiki-style links with display text: [[Page Name|Display Text]]
    processedContent = processedContent.replace(
      /\[\[([^|\]]+)\|([^\]]+)\]\]/g,
      (match, pageName, displayText) => {
        logger.info(`Processing wiki-style link with display text: ${match}`);
        const confluenceTitle = mapWikiTitleToConfluence(pageName);
        const targetPageId = pageIdMap[confluenceTitle];

        if (targetPageId) {
          return `[${displayText}](${baseUrl}/wiki/spaces/${confluenceSpace}/pages/${targetPageId})`;
        } else {
          logger.warn(
            `No page ID found for "${confluenceTitle}". Link will be broken.`
          );
          return `[${displayText}](#${confluenceTitle})`;
        }
      }
    );

    // Process simple wiki-style links: [[Page Name]]
    processedContent = processedContent.replace(
      /\[\[([^\]|]+)\]\]/g,
      (match, pageName) => {
        logger.info(`Processing simple wiki-style link: ${match}`);
        const confluenceTitle = mapWikiTitleToConfluence(pageName);
        const targetPageId = pageIdMap[confluenceTitle];

        if (targetPageId) {
          return `[${pageName}](${baseUrl}/wiki/spaces/${confluenceSpace}/pages/${targetPageId})`;
        } else {
          logger.warn(
            `No page ID found for "${confluenceTitle}". Link will be broken.`
          );
          return `[${pageName}](#${confluenceTitle})`;
        }
      }
    );

    // Process standard markdown links targeting internal pages
    processedContent = processedContent.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (match, text, url) => {
        // Skip external URLs
        if (url.startsWith("http://") || url.startsWith("https://")) {
          // Special handling for Azure DevOps wiki links
          if (url.includes("_wiki")) {
            const pageName = url.split("/").pop();
            const confluenceTitle = mapWikiTitleToConfluence(pageName);
            const targetPageId = pageIdMap[confluenceTitle];

            if (targetPageId) {
              logger.info(`Converting Azure DevOps wiki link: ${pageName}`);
              return `[${text}](${baseUrl}/wiki/spaces/${confluenceSpace}/pages/${targetPageId})`;
            }
          }
          return match;
        }

        // Handle relative links to wiki pages
        if (url.startsWith("/") && !url.includes(".attachments")) {
          // Extract the page name from the URL
          const pageName = url.split("/").pop();
          const confluenceTitle = mapWikiTitleToConfluence(pageName);
          const targetPageId = pageIdMap[confluenceTitle];

          if (targetPageId) {
            return `[${text}](${baseUrl}/wiki/spaces/${confluenceSpace}/pages/${targetPageId})`;
          } else {
            logger.warn(
              `No page ID found for "${confluenceTitle}". Link will be broken.`
            );
            return `[${text}](#${confluenceTitle})`;
          }
        }

        return match;
      }
    );
    processedContent = convertLinks(processedContent);
    return processedContent;
  } catch (error) {
    console.error("Error processing Confluence links:", error);
    return content; // Return original content if there's an error
  }
}

/**
 * Converts Markdown to Confluence storage format HTML
 * @param {string} markdown - Markdown content
 * @param {Object} attachmentMappings - Attachment mappings
 * @param {string} pagePath - Path to the page
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} pageId - Page ID
 * @returns {Promise<string>} - Converted HTML
 */
async function convertMarkdownToConfluenceHtml(
  markdown,
  attachmentMappings,
  pagePath,
  confluenceClient,
  pageId,
  pagesIdMap
) {
  try {
    logger.info(
      `Starting conversion of markdown to HTML for page at ${pagePath}`
    );

    // Check if markdown is provided
    if (!markdown) {
      logger.warn(`No markdown content provided for page at ${pagePath}`);
      return "<p>No content available</p>";
    }

    // Make sure we have a string, not a Promise
    let markdownContent = markdown;
    if (markdown instanceof Promise) {
      try {
        logger.info(`Resolving promise for content of page at ${pagePath}`);
        markdownContent = await markdown;
      } catch (error) {
        console.error(
          `Error resolving content promise for page at ${pagePath}:`,
          error
        );
        return "<p>Error loading content</p>";
      }
    }

    // Ensure markdownContent is a string
    if (typeof markdownContent !== "string") {
      logger.warn(
        `Expected string content for page at ${pagePath}, got ${typeof markdownContent}`
      );
      // Try to convert to string if possible
      if (markdownContent !== null && markdownContent !== undefined) {
        markdownContent = String(markdownContent);
      } else {
        return "<p>No content available</p>";
      }
    }

    // Process the content with error handling
    try {
      // Extract code blocks from the content
      const { content, codeBlocks } = processCodeBlocks(markdownContent);

      // Process various types of links
      let processedContent = processConfluenceLinks(
        content,
        attachmentMappings,
        pageId,
        pagesIdMap
      );

      // Process images - this was missing!
      processedContent = await convertImages(
        processedContent,
        attachmentMappings,
        confluenceClient,
        pageId
      );

      // Convert the processed markdown to HTML
      let html = convertMarkdown(processedContent);

      // Restore code blocks
      html = restoreCodeBlocks(html, codeBlocks);

      // Clean up Confluence-specific issues like nested lists
      html = cleanupContent(html);

      // Additional step to convert any remaining attachment links to image macros
      html = convertAttachmentLinksToImageMacros(html);

      logger.info(
        `Successfully converted markdown to HTML for page at ${pagePath}`
      );
      return html;
    } catch (error) {
      console.error(
        `Error converting markdown to HTML for page at ${pagePath}:`,
        error
      );
      return `<p>Error converting content: ${error.message}</p>
                  <pre>${
                    markdownContent
                      ? markdownContent.substring(0, 1000) + "..."
                      : "No content"
                  }</pre>`;
    }
  } catch (error) {
    console.error(
      `Error in convertMarkdownToConfluenceHtml for page at ${pagePath}:`,
      error
    );
    return `<p>Error processing content: ${error.message}</p>`;
  }
}

/**
 * Converts markdown content to HTML using the marked library.
 * @param {string} content - The markdown content to convert.
 * @returns {string} - The converted HTML content.
 */
function convertMarkdown(content) {
  // Input validation
  if (typeof content !== "string") {
    logger.warn(
      `convertMarkdown received non-string content: ${typeof content}`
    );
    try {
      content = String(content || "");
    } catch (error) {
      console.error("Failed to convert content to string:", error);
      return "<p>No content available</p>";
    }
  }

  try {
    return marked.parse(content, {
      gfm: true,
      breaks: true,
      sanitize: false,
    });
  } catch (error) {
    console.error("Error converting markdown to HTML:", error);
    return `<p>Error rendering markdown: ${error.message}</p>
                <pre>${
                  content
                    ? content.replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    : "No content"
                }</pre>`;
  }
}

// Add a new function to convert attachment links to image macros after HTML processing
function convertAttachmentLinksToImageMacros(html) {
  if (typeof html !== "string") {
    logger.warn(
      `convertAttachmentLinksToImageMacros received non-string content: ${typeof html}`
    );
    return html || "";
  }

  try {
    // Convert links to attachments that look like images into proper image macros
    // Updated regex to also capture potential size specifications after the filename
    return html.replace(
      /<a[^>]*href=["'](\/\.attachments\/[^"']+\.(png|jpg|jpeg|gif|svg)[^"']*)["'][^>]*>(.*?)<\/a>/gi,
      (match, path, ext, text) => {
        logger.info(`Converting attachment link to image macro: ${path}`);

        // Get the filename without URL encoding
        const filename = decodeURIComponent(path.split("/").pop());

        // Look for size parameter in the text or URL
        let sizeParameter = "";

        // Check if there's a size parameter in the URL (e.g., image.png=750x)
        if (path.includes("=")) {
          sizeParameter = path.split("=")[1];
        }

        // Or check if the link text contains a size parameter
        if (!sizeParameter && text.includes("=")) {
          sizeParameter = text.split("=")[1].trim();
        }

        // If we found a size parameter, include it with the filename
        const filenameWithSize = sizeParameter
          ? `${filename}=${sizeParameter}`
          : filename;

        // Using the sync version with the potentially size-enhanced filename
        return createConfluenceImageMacroSync(filenameWithSize, text);
      }
    );
  } catch (error) {
    console.error("Error converting attachment links to image macros:", error);
    return html;
  }
}

/**
 * Maps wiki page titles to their Confluence equivalents
 * @param {string} wikiTitle - The wiki page title
 * @returns {string} - The Confluence page title
 */
function mapWikiTitleToConfluence(wikiTitle) {
  if (!wikiTitle) return "";

  // Remove any URL encoding
  let decodedTitle = wikiTitle;
  try {
    decodedTitle = decodeURIComponent(wikiTitle);
  } catch (e) {
    logger.warn(`Could not decode title "${wikiTitle}": ${e.message}`);
  }

  // Replace special characters and spaces
  return decodedTitle
    .replace(/[\\/]/g, "-") // Replace slashes with hyphens
    .replace(/[<>:"|?*]/g, "_") // Replace problematic characters with underscores
    .replace(/%/g, "-") // Replace percent signs with hyphens
    .replace(/&/g, "and") // Replace ampersands with 'and'
    .replace(/\+/g, " ") // Replace plus signs with spaces
    .trim();
}
module.exports = {
  convertMarkdownToConfluenceHtml,
  cleanupContent,
  processCodeBlocks,
  restoreCodeBlocks,
  convertMarkdown,
  processConfluenceLinks,
  convertAttachmentLinksToImageMacros,
  createConfluenceImageMacro,
  createConfluenceImageMacroSync,
};
