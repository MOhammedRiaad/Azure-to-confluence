#!/usr/bin/env node
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

// Load existing .env if it exists
dotenv.config();

// Setup readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt for input with default values
function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    let fullQuestion = question;
    if (defaultValue) {
      fullQuestion += ` (default: ${defaultValue}): `;
    } else {
      fullQuestion += ': ';
    }

    rl.question(fullQuestion, (answer) => {
      resolve(answer || defaultValue);
    });
  });
}

// Function to detect the project name from the current directory structure
async function detectProjectName() {
  // Get the current working directory
  const cwd = process.cwd();
  console.log(`Current working directory: ${cwd}`);

  // Try to determine the project name by looking at the parent folder
  const parentDir = path.dirname(cwd);
  const parentDirName = path.basename(parentDir);
  
  let potentialProjectName = null;
  
  // Check if we're in a .wiki structure
  if (parentDirName.endsWith('.wiki')) {
    potentialProjectName = parentDirName.replace('.wiki', '');
    console.log(`Detected possible project name from parent directory: ${potentialProjectName}`);
  }

  // Try to find the project name by looking at sibling directories
  try {
    const siblingDirs = await fs.readdir(parentDir, { withFileTypes: true });
    const wikiDirs = siblingDirs
      .filter(dirent => dirent.isDirectory() && dirent.name.endsWith('.wiki'))
      .map(dirent => dirent.name.replace('.wiki', ''));
    
    if (wikiDirs.length > 0) {
      console.log(`Found potential wiki project(s): ${wikiDirs.join(', ')}`);
      if (!potentialProjectName && wikiDirs.length === 1) {
        potentialProjectName = wikiDirs[0];
      }
    }
  } catch (error) {
    console.warn(`Could not read parent directory: ${error.message}`);
  }

  return potentialProjectName;
}

// Function to save environment variables to .env file
async function saveEnvFile(config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(path.join(process.cwd(), '.env'), envContent, 'utf8');
  console.log('Environment configuration saved to .env file');
}

// Main function to run the setup
async function runSetup() {
  try {
    console.log('Welcome to the Azure Wiki to Confluence Migration Tool Setup');
    console.log('-----------------------------------------------------');
    console.log('This script will help you configure the environment for the migration tool.');
    console.log('Press Enter to accept default values (shown in parentheses) or provide your own.\n');

    // Detect project name
    const detectedProject = await detectProjectName();
    const projectName = await prompt('Enter the name of your project', detectedProject || 'Your-Project');
    
    // Create config object with defaults from existing env or new defaults
    const config = {
      // Confluence API Configuration
      CONFLUENCE_BASE_URL: await prompt('Confluence Base URL', process.env.CONFLUENCE_BASE_URL || 'https://your-domain.atlassian.net'),
      CONFLUENCE_USERNAME: await prompt('Confluence Username (email)', process.env.CONFLUENCE_USERNAME || 'your.email@example.com'),
      CONFLUENCE_API_TOKEN: await prompt('Confluence API Token', process.env.CONFLUENCE_API_TOKEN || ''),
      
      // Confluence Space Configuration
      CONFLUENCE_SPACE_KEY: await prompt('Confluence Space Key', process.env.CONFLUENCE_SPACE_KEY || 'SPACE'),
      CONFLUENCE_PARENT_PAGE_ID: await prompt('Confluence Parent Page ID', process.env.CONFLUENCE_PARENT_PAGE_ID || '12345'),
      
      // Paths Configuration
      AZURE_WIKI_PATH: await prompt('Azure Wiki Path', process.env.AZURE_WIKI_PATH || `../${projectName}`),
      PROJECT_NAME: projectName,
      
      // Detect the wiki structure
      WIKI_ROOT_DIR: await prompt('Wiki Root Directory', process.env.WIKI_ROOT_DIR || `../${projectName}.wiki`)
    };

    // Check if .attachments folder exists in wiki root
    const wikiRootDir = path.resolve(process.cwd(), config.WIKI_ROOT_DIR);
    const attachmentsPath = path.join(wikiRootDir, '.attachments');
    
    try {
      await fs.access(attachmentsPath, fs.constants.F_OK);
      console.log(`Found .attachments folder at: ${attachmentsPath}`);
      config.ATTACHMENTS_PATH = attachmentsPath;
    } catch (error) {
      console.log(`No .attachments folder found at: ${attachmentsPath}`);
      config.ATTACHMENTS_PATH = await prompt('Path to .attachments folder', process.env.ATTACHMENTS_PATH || '');
    }

    // Save the configuration
    await saveEnvFile(config);

    console.log('\nSetup complete! You can now run the migration tool.');
    console.log('To start the migration, run: node src/index.js');
    console.log('For local testing, run: node src/index.js --local');
    console.log('For debug mode, add: --debug');

  } catch (error) {
    console.error('Error during setup:', error);
  } finally {
    rl.close();
  }
}

// Run the setup
runSetup(); 