require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { getMimeType } = require('./utils');
const { getConfig } = require('./config');


/**
 * Gets the blob URL for an attachment from Confluence
 * @param {Object} confluenceClient - Confluence API client
 * @param {string} pageId - Page ID
 * @param {string} attachmentName - Name of the attachment
 * @returns {Promise<string>} - Blob URL
 */
async function getBlobUrl(confluenceClient, pageId, attachmentName) {
    if (!confluenceClient || !pageId || !attachmentName) {
        console.error(`Missing required parameters for getBlobUrl. confluenceClient: ${!!confluenceClient}, pageId: ${pageId}, attachmentName: ${attachmentName}`);
        return null;
    }

    try {
        console.log(`Fetching blob URL for attachment: ${attachmentName} on page ${pageId}`);
        
        // Get attachments for the page
        const response = await confluenceClient.getAttachments(pageId);
        
        if (!response || !response.results || !Array.isArray(response.results)) {
            console.warn(`No attachments found for page ${pageId}`);
            return null;
        }
        
        // Find the attachment by filename
        const attachment = response.results.find(att => att.title === attachmentName);
        
        if (!attachment) {
            console.warn(`Attachment '${attachmentName}' not found on page ${pageId}`);
            return null;
        }
        
        // Check if download link exists
        if (!attachment._links || !attachment._links.download) {
            console.warn(`No download link found for attachment: ${attachmentName}`);
            return null;
        }
        
        // Get the base URL from the Confluence client
        const baseUrl = confluenceClient.getBaseUrl();
        if (!baseUrl) {
            console.error('Failed to get base URL from Confluence client');
            return null;
        }
        
        // Construct the full URL
        const downloadPath = attachment._links.download;
        const blobUrl = baseUrl + downloadPath;
        
        console.log(`Successfully retrieved blob URL for ${attachmentName}: ${blobUrl}`);
        return blobUrl;
    } catch (error) {
        console.error(`Error getting blob URL for attachment ${attachmentName} on page ${pageId}: ${error.message}`);
        // Return null instead of throwing to allow fallback to attachment reference
        return null;
    }
}

/**
 * Upload attachments for a page
 */
async function uploadAttachments(confluenceClient, pageId, pagePath, attachmentMappings) {
    try {
        console.log(`Processing attachments for page: ${pagePath}`);
        const content = await fs.readFile(pagePath, 'utf8');
        
        // Track processed files to avoid duplicates
        const processedFiles = new Set();
        
        // Get the root .attachments folder path from config
        const config = getConfig();
        let rootAttachmentsDir = config.paths.attachmentsDir;
        
        // If not explicitly configured, try to detect based on the wiki structure
        if (!rootAttachmentsDir) {
            const currentDir = process.cwd();
            // Determine if we're in a project wiki folder structure
            const projectName = config.project.name;
            const wikiPattern = projectName ? `${projectName}.wiki` : '.wiki';
            
            if (currentDir.includes(wikiPattern)) {
                // Find the wiki root
                const wikiRootIndex = currentDir.indexOf(wikiPattern);
                const wikiRootDir = currentDir.substring(0, wikiRootIndex + wikiPattern.length);
                rootAttachmentsDir = path.join(wikiRootDir, '.attachments');
            } else {
                // Fallback to looking near the page path
                const wikiRootDir = path.dirname(path.dirname(pagePath));
                rootAttachmentsDir = path.join(wikiRootDir, '.attachments');
            }
        }
        
        console.log(`Looking for attachments in root folder: ${rootAttachmentsDir}`);
        
        // Process each type of image reference
        await processStandardImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
        await processWikiStyleImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
        await processHtmlImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
        
        console.log(`Completed processing ${processedFiles.size} attachments for page: ${pagePath}`);
    } catch (error) {
        console.error(`Error processing attachments for page ${pagePath}:`, error);
    }
}

/**
 * Process standard Markdown image references: ![alt](path/to/image.png)
 */
async function processStandardImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings) {
    console.log(`Processing standard Markdown image references`);
    
    // Enhanced regex to capture standard Markdown image references
    // This regex handles additional parameters like =750x after the image path
    const imageRegex = /!\[([^\]]*)\]\(([^) ]+)(?: [^)]*)?\)/g;
    const matches = [...content.matchAll(imageRegex)];
    
    console.log(`Found ${matches.length} standard image references`);
    
    for (const match of matches) {
        const [, alt, src] = match;
        
        // Normalize the source path to handle various formats
        const normalizedSrc = src.replace(/^\s+|\s+$/g, ''); // Trim whitespace
        
        // Extract filename regardless of path format
        let attachmentName;
        if (normalizedSrc.includes('/')) {
            attachmentName = decodeURIComponent(normalizedSrc.split('/').pop());
        } else {
            attachmentName = decodeURIComponent(normalizedSrc);
        }
        
        await uploadAttachmentFile(attachmentName, normalizedSrc, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
    }
}

/**
 * Process wiki-style image references: ![[image.png]]
 */
async function processWikiStyleImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings) {
    console.log(`Processing wiki-style image references`);
    
    // Improved regex to capture wiki-style image references with possible parameters
    const wikiImageRegex = /!\[\[([^|\]]+?)(?:\s*[=|][^\]]*)?]]/g;
    const matches = [...content.matchAll(wikiImageRegex)];
    
    console.log(`Found ${matches.length} wiki-style image references`);
    
    for (const match of matches) {
        const [, imagePath] = match;
        
        // Normalize the path and remove any parameters
        const normalizedPath = imagePath.replace(/^\s+|\s+$/g, ''); // Trim whitespace
        
        // Extract filename from path, handling any parameters
        let attachmentName;
        if (normalizedPath.includes('/')) {
            // Get the last part of the path
            const pathPart = normalizedPath.split('/').pop();
            
            // Remove any sizing or other parameters
            let cleanPathPart = pathPart;
            if (cleanPathPart.includes('=')) {
                cleanPathPart = cleanPathPart.split('=')[0].trim();
            }
            
            attachmentName = decodeURIComponent(cleanPathPart);
        } else {
            // Handle direct filename with possible parameters
            let cleanName = normalizedPath;
            if (cleanName.includes('=')) {
                cleanName = cleanName.split('=')[0].trim();
            }
            
            attachmentName = decodeURIComponent(cleanName);
        }
        
        await uploadAttachmentFile(attachmentName, normalizedPath, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
    }
}

/**
 * Process HTML img tag references: <img src="path/to/image.png" alt="alt text" />
 */
async function processHtmlImageReferences(content, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings) {
    console.log(`Processing HTML img tag references`);
    
    // Improved regex to better capture HTML img tags with various attributes
    const htmlImgRegex = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>/g;
    const matches = [...content.matchAll(htmlImgRegex)];
    
    console.log(`Found ${matches.length} HTML img tag references`);
    
    for (const match of matches) {
        const [, src] = match;
        
        // Skip external URLs
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
            console.log(`Skipping external URL: ${src}`);
            continue;
        }
        
        // Normalize the path
        const normalizedPath = src.replace(/^\s+|\s+$/g, ''); // Trim whitespace
        
        // Extract filename from path, handling cases with parameters
        let attachmentName;
        if (normalizedPath.includes('/')) {
            // Get the last part of the path
            const pathPart = normalizedPath.split('/').pop();
            
            // Handle any parameters in the filename
            attachmentName = decodeURIComponent(pathPart);
        } else {
            attachmentName = decodeURIComponent(normalizedPath);
        }
        
        await uploadAttachmentFile(attachmentName, normalizedPath, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings);
    }
}

/**
 * Helper function to upload a single attachment file
 */
async function uploadAttachmentFile(attachmentName, sourcePath, processedFiles, rootAttachmentsDir, confluenceClient, pageId, attachmentMappings) {
    try {
        console.log(`Processing image reference: ${attachmentName} (from ${sourcePath})`);
        
        if (processedFiles.has(attachmentName)) {
            console.log(`Skipping duplicate attachment: ${attachmentName}`);
            return;
        }
        
        // Clean up attachment name by removing query parameters or size specifications
        let cleanAttachmentName = attachmentName;
        
        // Remove any sizing parameters (e.g., "=750x")
        if (cleanAttachmentName.includes('=')) {
            cleanAttachmentName = cleanAttachmentName.split('=')[0].trim();
            console.log(`Removed sizing parameter from attachment name: ${attachmentName} -> ${cleanAttachmentName}`);
        }
        
        // Remove any query parameters (e.g., "?style=for-the-badge")
        if (cleanAttachmentName.includes('?')) {
            cleanAttachmentName = cleanAttachmentName.split('?')[0].trim();
            console.log(`Removed query parameter from attachment name: ${attachmentName} -> ${cleanAttachmentName}`);
        }
        
        // Try to find the attachment in the root .attachments folder
        const attachmentPath = path.join(rootAttachmentsDir, cleanAttachmentName);
        
        // Check if file exists
        try {
            await fs.access(attachmentPath, fs.constants.F_OK);
            // File exists, proceed with upload
            
            // Get file metadata
            const stats = await fs.stat(attachmentPath);
            const mimeType = getMimeType(attachmentPath);
            
            console.log(`Uploading ${cleanAttachmentName} from ${attachmentPath} (${mimeType}, ${stats.size} bytes)`);
            
            try {
                // Upload with metadata
                const result = await confluenceClient.uploadAttachment(pageId, attachmentPath, {
                    fileName: cleanAttachmentName,
                    mimeType: mimeType,
                    comment: `Updated: ${new Date().toISOString()}`,
                    minorEdit: true
                });
                
                console.log(`Successfully uploaded: ${cleanAttachmentName} (ID: ${result.results?.[0]?.id || 'unknown'})`);
                processedFiles.add(attachmentName); // Use original name to avoid reprocessing
                
                // Update attachmentMappings with the new reference
                if (attachmentMappings) {
                    const attachmentKey = sourcePath;
                    attachmentMappings[attachmentKey] = {
                        id: result.results?.[0]?.id,
                        title: cleanAttachmentName,
                        mimeType: mimeType
                    };
                }
                
                return result;
            } catch (uploadError) {
                // If the API returns a 400 but includes a result, it might be because the file already exists
                if (uploadError.results && uploadError.results.length > 0) {
                    console.log(`Attachment ${cleanAttachmentName} already exists on page ${pageId}`);
                    processedFiles.add(attachmentName); // Use original name to avoid reprocessing
                    
                    // Still update attachmentMappings with the reference info
                    if (attachmentMappings) {
                        const attachmentKey = sourcePath;
                        attachmentMappings[attachmentKey] = {
                            id: uploadError.results[0].id || 'unknown',
                            title: cleanAttachmentName,
                            mimeType: mimeType
                        };
                    }
                    
                    return uploadError; // Return the result object with existing attachment info
                }
                
                // Otherwise, rethrow the error to be caught by the outer catch block
                throw uploadError;
            }
        } catch (error) {
            console.error(`Could not find or upload attachment file: ${cleanAttachmentName}`);
            console.error(`Looked in: ${rootAttachmentsDir}`);
            console.error(`Full path attempted: ${attachmentPath}`);
            console.error(`Original reference: ${sourcePath}`);
            console.error(`Error details:`, error);
            
            // Even if the file upload failed, we should still add an entry to attachmentMappings
            // This allows the link conversion to still work with the attachment name
            if (attachmentMappings) {
                const attachmentKey = sourcePath;
                attachmentMappings[attachmentKey] = {
                    id: null,
                    title: cleanAttachmentName,
                    mimeType: getMimeType(attachmentPath)
                };
            }
        }
    } catch (error) {
        console.error(`Error processing attachment ${attachmentName}:`, error);
    }
}

module.exports = {
    uploadAttachments,
    getBlobUrl
};