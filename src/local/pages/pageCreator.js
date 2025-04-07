const { marked } = require('marked');
const path = require('path');
const { uploadPageAttachments } = require('../attachments/attachmentUploader');

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
async function createConfluencePages(wikiStructure, confluenceClient, spaceKey, parentPageId, attachmentMappings, confluenceConfig) {
  try {
    console.log('Creating Confluence pages...');
    console.log(`Space key: ${spaceKey}`);
    console.log(`Parent page ID: ${parentPageId}`);
    console.log(`Total pages to create: ${countPages(wikiStructure.pages)}`);
    
    // Process pages in hierarchical order
    await processPages(wikiStructure.pages, confluenceClient, confluenceConfig,spaceKey, parentPageId, attachmentMappings);
    
    console.log('All pages created successfully!');
  } catch (error) {
    console.error('Error creating Confluence pages:', error);
    throw error;
  }
}

/**
 * Process a list of pages
 * @param {Array} pages - List of pages to process
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} parentPageId - Parent page ID
 * @param {string} spaceKey - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
 * @returns {Promise<void>}
 */
async function processPages(pages, confluenceClient, confluenceConfig, spaceKey,parentPageId, attachmentMappings) {
  // Process pages in sequence to maintain order
  for (const page of pages) {
    try {
      // Create the page
      const pageId = await createOrUpdatePage(
        page,
        confluenceClient,
        confluenceConfig,
        spaceKey,
        parentPageId,
        attachmentMappings
      );
      
      // Process child pages if any
      if (page.children && page.children.length > 0) {
        await processPages(
          page.children,
          confluenceClient,
          confluenceConfig,
          pageId,
          attachmentMappings
        );
      }
    } catch (error) {
      console.error(`Error processing page ${page.title}:`, error);
    }
  }
}

/**
 * Create or update a Confluence page
 * @param {Object} page - Page object with content
 * @param {Object} confluenceClient - Confluence API client
 * @param {Object} confluenceConfig - Confluence configuration
 * @param {string} parentPageId - Parent page ID
 * @param {Object} attachmentMappings - Mapping of attachments
 * @returns {Promise<string>} Created page ID
 */
async function createOrUpdatePage(page, confluenceClient, confluenceConfig, spaceKey,parentPageId, attachmentMappings) {
  try {
    console.log(`Creating/updating page: ${page.title}`);
    
    // Check if page already exists
    let existingPage;
    let pageId;
    
 
    console.log(`spaceKey: ${spaceKey}`);
    console.log(`parentPageId: ${parentPageId}`);  
    // Check if page exists by title
    console.log(`Checking if page ${page.title} exists...`);
    try {
      existingPage = await getPageByTitle(
        confluenceClient,
        spaceKey,
        page.title
      );
    } catch (e) {
      console.error(`Error checking page ${page.title}:`, e);
    }
    
    console.log(`Existing page: ${existingPage ? 'Yes' : 'No'}`);
    if (existingPage) {
      // Use existing page ID
      pageId = existingPage.id;
      
      // Upload attachments for this page first
      await uploadPageAttachments(
        pageId, 
        path.basename(page.path, '.md'), 
        attachmentMappings,
        {
          baseUrl: confluenceConfig.baseUrl,
          username: confluenceConfig.username,
          password: confluenceConfig.password
        }
      );
      
      // Convert markdown to HTML with updated attachment references
      const htmlContent = convertMarkdownToConfluenceHtml(page.content, attachmentMappings, page.path);
      
      // Update the page
      await updatePage(
        confluenceClient,
        pageId,
        page.title,
        htmlContent,
        confluenceConfig.spaceKey
      );
    } else {
      // Create new page
      console.log(`Page ${page.title} does not exist. Creating new page...`);
      try {
      pageId = await createPage(
        confluenceClient,
        parentPageId,
        page.title,
        // Initially create with basic content
        '<p>Initializing page...</p>',
        confluenceConfig.spaceKey
      );
      } catch (e) {
        console.error(`Error creating page ${page.title}:`, e);
      }
      // Upload attachments for this page
      await uploadPageAttachments(
        pageId, 
        path.basename(page.path, '.md'), 
        attachmentMappings,
        {
          baseUrl: confluenceConfig.baseUrl,
          username: confluenceConfig.username,
          password: confluenceConfig.password
        }
      );
      
      // Convert markdown to HTML with attachment references
      const htmlContent = convertMarkdownToConfluenceHtml(page.content, attachmentMappings, page.path);
      
      // Update the page with full content including attachment references
      await updatePage(
        confluenceClient,
        pageId,
        page.title,
        htmlContent,
        confluenceConfig.spaceKey
      );
    }
    
    return pageId;
  } catch (error) {
    console.error(`Error creating/updating page ${page.title}:`, error);
    throw error;
  }
}

/**
 * Convert markdown content to Confluence HTML
 * @param {string} markdown - Markdown content
 * @param {Object} attachmentMappings - Mapping of attachments
 * @param {string} pagePath - Path to the current page
 * @returns {string} Confluence HTML
 */
function convertMarkdownToConfluenceHtml(markdown, attachmentMappings, pagePath) {
  // Create a custom renderer
  const renderer = {
    image(href, title, text) {
      // Check if this is an attachment reference
      if (href.startsWith('/.attachments/')) {
        const attachmentName = path.basename(href);
        
        // Try to find the attachment in our mappings
        let attachmentEntry = null;
        const pageDir = path.dirname(pagePath);
        const potentialAttachmentPath = path.join(pageDir, '.attachments', attachmentName);
        
        // Look for the attachment in our mappings
        if (attachmentMappings[potentialAttachmentPath] && attachmentMappings[potentialAttachmentPath].uploaded) {
          attachmentEntry = attachmentMappings[potentialAttachmentPath];
          
          // Use the Confluence attachment macro with the uploaded file
          return `<ac:image><ri:attachment ri:filename="${attachmentName}" /></ac:image>`;
        }
        
        // Fallback: use the attachment macro with just the name
        return `<ac:image><ri:attachment ri:filename="${attachmentName}" /></ac:image>`;
      }
      
      // External images
      return `<ac:image><ri:url ri:value="${href}" /></ac:image>`;
    },
    
    link(href, title, text) {
      // If link is to another wiki page
      if (href.startsWith('/') && !href.startsWith('/.attachments/')) {
        // Extract page name from link
        const pageName = path.basename(href);
        
        // Create Confluence page link
        return `<ac:link><ri:page ri:content-title="${pageName}" /></ac:link>`;
      }
      
      // If link is to an attachment
      if (href.startsWith('/.attachments/')) {
        const attachmentName = path.basename(href);
        
        // Try to find the attachment in our mappings
        let attachmentEntry = null;
        const pageDir = path.dirname(pagePath);
        const potentialAttachmentPath = path.join(pageDir, '.attachments', attachmentName);
        
        // Look for the attachment in our mappings
        if (attachmentMappings[potentialAttachmentPath] && attachmentMappings[potentialAttachmentPath].uploaded) {
          attachmentEntry = attachmentMappings[potentialAttachmentPath];
          
          // Use the Confluence attachment link macro
          return `<ac:link><ri:attachment ri:filename="${attachmentName}" /></ac:link>`;
        }
        
        // Fallback: simple attachment link
        return `<ac:link><ri:attachment ri:filename="${attachmentName}" /></ac:link>`;
      }
      
      // External links
      return `<a href="${href}">${text}</a>`;
    }
  };
  
  // Handle special Azure wiki syntax
  
  // Replace [[_TOC_]] with Confluence TOC macro
  markdown = markdown.replace(/\[\[_TOC_\]\]/g, 
    '<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="1"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>');
  
  // Convert tables to have proper formatting
  markdown = markdown.replace(/\|([^\n]+)\|/g, function(match) {
    return match.replace(/\s*\|\s*/g, '|');
  });
  
  // Set marked options
  const options = {
    renderer,
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert line breaks to <br>
    pedantic: false,
    smartLists: true,
    smartypants: true
  };
  
  // Convert markdown to HTML
  let html = marked(markdown, options);
  
  // Wrap in Confluence storage format
  return `<ac:structured-macro ac:name="html" ac:schema-version="1">
  <ac:plain-text-body><![CDATA[${html}]]></ac:plain-text-body>
</ac:structured-macro>`;
}

/**
 * Get a page by title
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} spaceKey - Space key
 * @param {string} title - Page title
 * @returns {Promise<Object>} Page object or null
 */
async function getPageByTitle(confluenceClient, spaceKey, title) {
  return await new Promise((resolve, reject) => {
    confluenceClient.getContentByPageTitle(spaceKey,title, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      if (data && data.results && data.results.length > 0) {
        resolve(data.results[0]);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Create a new page
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} parentPageId - Parent page ID
 * @param {string} title - Page title
 * @param {string} content - Page content (HTML)
 * @param {string} spaceKey - Space key
 * @returns {Promise<string>} Created page ID
 */
async function createPage(confluenceClient, parentPageId, title, content, spaceKey) {
  return new Promise((resolve, reject) => {
    const pageData = {
      type: 'page',
      title: title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: content,
          representation: 'storage'
        }
      },
      ancestors: parentPageId ? [{ id: parentPageId }] : []
    };
     console.log(`Creating page "${title}" with parent ID ${parentPageId}`);
      confluenceClient.createContent(pageData, (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(data.id);
      });
  });
}

/**
 * Update an existing page
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} pageId - Page ID
 * @param {string} title - Page title
 * @param {string} content - Page content (HTML)
 * @param {string} spaceKey - Space key
 * @returns {Promise<string>} Updated page ID
 */
async function updatePage(confluenceClient, pageId, title, content, spaceKey) {
  // First, get the current version
  return new Promise((resolve, reject) => {
    confluenceClient.getContentById(pageId, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      
      const version = parseInt(data.version.number, 10) + 1;
      
      const pageData = {
        id: pageId,
        type: 'page',
        title: title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: content,
            representation: 'storage'
          }
        },
        version: { number: version }
      };
      
      confluenceClient.putContent(pageData, pageId, (err, updateData) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log(`Updated page "${title}" with ID ${updateData.id}`);
        resolve(updateData.id);
      });
    });
  });
  
}
/**
 * Count the total number of pages in the wiki structure
 * @param {Array} pages - List of pages
 * @returns {number} - Total number of pages
 */
function countPages(pages) {
  if (!pages || !Array.isArray(pages)) return 0;
  
  let count = pages.length;
  
  // Count children recursively
  for (const page of pages) {
    if (page.children && Array.isArray(page.children)) {
      count += countPages(page.children);
    }
  }
  
  return count;
}
module.exports = {
  createConfluencePages
}; 