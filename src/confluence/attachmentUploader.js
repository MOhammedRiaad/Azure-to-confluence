const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const axios = require('axios');
const FormData = require('form-data');

/**
 * Upload all attachments to Confluence
 * @param {string} wikiRootPath - Path to the wiki root
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} spaceKey - Confluence space key
 * @returns {Promise<Object>} Mapping of original file paths to Confluence URLs
 */
async function uploadAttachments(wikiRootPath, confluenceClient, spaceKey) {
  try {
      console.log('Processing attachments...');
      console.log(`Wiki path: ${wikiRootPath}`);
      
      // The exact path where the .attachments folder is located
      const attachmentsPath = path.join(process.cwd(), '..', '.attachments');
      console.log(`Checking for .attachments folder at: ${attachmentsPath}`);
      
    console.log('Scanning for attachments...');
    
    // Find all attachment directories
    const attachmentDirPattern = path.join(wikiRootPath, '.attachments');
    const attachmentDirs = await glob(attachmentsPath, { dot: true });
    
    console.log(`Found ${attachmentDirs.length} attachment directories`);
    
    // Track mappings between original paths and Confluence URLs
    const attachmentMappings = {};
    
    // Map to track which pages need which attachments
    const pageAttachments = {};
    
    // Process each attachment directory
    for (const attachmentDir of attachmentDirs) {
      // Determine parent directory (which contains the pages that reference these attachments)
      const parentDir = path.dirname(attachmentDir);
      const parentDirName = path.basename(parentDir);
      
      console.log(`Processing attachments in ${parentDir}`);
      
      // Get all files in the attachment directory
      const files = await fs.readdir(attachmentDir);
      
      // Scan markdown files in the parent directory to find attachment references
      const mdFiles = await findMarkdownFiles(parentDir);
      const references = await scanFilesForAttachmentReferences(mdFiles);
      
      for (const file of files) {
        const filePath = path.join(attachmentDir, file);
        
        // Skip directories if any exist in the attachments folder
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) continue;
        
        try {
          // Find which pages reference this attachment
          const referencingPages = findReferencingPages(references, file);
          
          if (referencingPages.length > 0) {
            // Add to the page attachments mapping
            referencingPages.forEach(page => {
              if (!pageAttachments[page]) {
                pageAttachments[page] = [];
              }
              pageAttachments[page].push({
                filePath,
                fileName: file
              });
            });
          } else {
            // If no specific page references this attachment, associate it with parent directory
            const tempPageTitle = `${parentDirName}`;
            if (!pageAttachments[tempPageTitle]) {
              pageAttachments[tempPageTitle] = [];
            }
            pageAttachments[tempPageTitle].push({
              filePath,
              fileName: file
            });
          }
          
          // Store the file in our attachment mappings
          attachmentMappings[filePath] = {
            originalPath: filePath,
            fileName: file,
            uploaded: false,
            confluenceId: null,
            confluenceUrl: null
          };
          
          console.log(`Mapped attachment: ${file}`);
        } catch (error) {
          console.error(`Error processing attachment ${file}:`, error);
        }
      }
    }
    
    // Store the page to attachments mapping for later use
    attachmentMappings._pageAttachments = pageAttachments;
    
    return attachmentMappings;
  } catch (error) {
    console.error('Error processing attachments:', error);
    throw error;
  }
}

/**
 * Find markdown files in a directory
 * @param {string} dirPath - Directory to search
 * @returns {Promise<Array>} List of markdown file paths
 */
async function findMarkdownFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    const mdFiles = [];
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile() && file.endsWith('.md')) {
        mdFiles.push(filePath);
      }
    }
    
    return mdFiles;
  } catch (error) {
    console.error(`Error finding markdown files in ${dirPath}:`, error);
    return [];
  }
}

/**
 * Scan markdown files for attachment references
 * @param {Array} filePaths - List of markdown file paths
 * @returns {Promise<Object>} Map of attachments to referencing files
 */
async function scanFilesForAttachmentReferences(filePaths) {
  const references = {};
  
  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const fileName = path.basename(filePath);
      
      // Find all attachment references with regex
      // This looks for markdown image syntax ![alt](/.attachments/filename) or direct links
      const attachmentRegex = /\[\!\[.*?\]\((\/\.attachments\/[^)]+)\)|!\[.*?\]\((\/\.attachments\/[^)]+)\)|\]\((\/\.attachments\/[^)]+)\)/g;
      let match;
      
      while ((match = attachmentRegex.exec(content)) !== null) {
        // Extract the attachment path from the match
        const attachmentPath = match[1] || match[2] || match[3];
        const attachmentFile = path.basename(attachmentPath);
        
        if (!references[attachmentFile]) {
          references[attachmentFile] = [];
        }
        
        if (!references[attachmentFile].includes(fileName)) {
          references[attachmentFile].push(fileName);
        }
      }
    } catch (error) {
      console.error(`Error scanning file ${filePath} for attachment references:`, error);
    }
  }
  
  return references;
}

/**
 * Find pages that reference a specific attachment
 * @param {Object} references - Map of attachments to referencing files
 * @param {string} attachmentFile - Attachment filename
 * @returns {Array} List of page filenames
 */
function findReferencingPages(references, attachmentFile) {
  return references[attachmentFile] || [];
}

/**
 * Upload an attachment to a Confluence page
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} pageId - Confluence page ID
 * @param {Object} attachment - Attachment object with file info
 * @param {Object} config - Configuration with auth details
 * @returns {Promise<Object>} Upload result with ID and URL
 */
async function uploadAttachmentToPage(pageId, attachment, config) {
  try {
    const { filePath, fileName } = attachment;
    
    // Create form data for the file upload
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    const baseUrl = config.baseUrl;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    
    // Upload the attachment using Axios
    const response = await axios.post(
      `${baseUrl}/rest/api/content/${pageId}/child/attachment`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    console.log(`Successfully uploaded attachment ${fileName} to page ${pageId}`);
    
    // Return the attachment details
    return {
      id: response.data.results[0].id,
      fileName: fileName,
      url: `${baseUrl}/download/attachments/${pageId}/${fileName}`
    };
  } catch (error) {
    console.error(`Error uploading attachment ${attachment.fileName}:`, error.message);
    throw error;
  }
}

/**
 * Upload all attachments for a page
 * @param {string} pageId - Confluence page ID
 * @param {string} pageTitle - Page title
 * @param {Object} attachmentMappings - Mappings of attachments
 * @param {Object} config - Configuration with auth details
 * @returns {Promise<Object>} Updated mappings with uploaded attachment info
 */
async function uploadPageAttachments(pageId, pageTitle, attachmentMappings, config) {
  try {
    const pageAttachments = attachmentMappings._pageAttachments || {};
    const attachmentsForPage = pageAttachments[pageTitle] || [];
    
    if (attachmentsForPage.length === 0) {
      return attachmentMappings;
    }
    
    console.log(`Uploading ${attachmentsForPage.length} attachments for page "${pageTitle}"`);
    
    for (const attachment of attachmentsForPage) {
      try {
        const { filePath, fileName } = attachment;
        
        // Skip if already uploaded
        if (attachmentMappings[filePath] && attachmentMappings[filePath].uploaded) {
          continue;
        }
        
        // Upload the attachment
        const result = await uploadAttachmentToPage(pageId, attachment, config);
        
        // Update the mapping
        attachmentMappings[filePath] = {
          ...attachmentMappings[filePath],
          uploaded: true,
          confluenceId: result.id,
          confluenceUrl: result.url,
          pageId
        };
      } catch (error) {
        console.error(`Error uploading attachment ${attachment.fileName} for page ${pageTitle}:`, error.message);
      }
    }
    
    return attachmentMappings;
  } catch (error) {
    console.error(`Error uploading page attachments for ${pageTitle}:`, error.message);
    return attachmentMappings;
  }
}

module.exports = {
  uploadAttachments,
  uploadPageAttachments
}; 