#!/usr/bin/env node
const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const { logger } = require('./src/utils');

// Load environment variables
dotenv.config();

// Setup readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt for input
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Helper function to run a command
function runCommand(command, options = {}) {
  logger.info(`Executing: ${command}`);
  try {
    execSync(command, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    logger.error(`Command failed with error: ${error.message}`);
    return false;
  }
}

// Main menu function
async function showMainMenu() {
  console.clear();
  console.log('=======================================================');
  console.log('        Azure Wiki to Confluence Migration Tool        ');
  console.log('=======================================================');
  console.log('');
  console.log('Please select an option:');
  console.log('');
  console.log('1. Setup configuration');
  console.log('2. Run full migration');
  console.log('3. Test migration locally (no Confluence connection)');
  console.log('4. Migrate a single page');
  console.log('5. Debug mode (verbose logging)');
  console.log('6. Update an existing page in Confluence');
  console.log('7. Exit');
  console.log('');

  const choice = await prompt('Enter your choice (1-7): ');
  
  switch (choice) {
    case '1':
      await runSetup();
      break;
    case '2':
      await runFullMigration();
      break;
    case '3':
      await runLocalTest();
      break;
    case '4':
      await migrateSinglePage();
      break;
    case '5':
      await runDebugMode();
      break;
    case '6':
      await updateExistingPage();
      break;
    case '7':
      console.log('Exiting. Goodbye!');
      rl.close();
      return;
    default:
      console.log('Invalid choice. Please try again.');
      await prompt('Press Enter to continue...');
      await showMainMenu();
      return;
  }
  
  // Return to main menu after action completes
  await prompt('\nPress Enter to return to main menu...');
  await showMainMenu();
}

// Setup configuration
async function runSetup() {
  console.log('\nRunning setup wizard...\n');
  runCommand('node setup.js');
}

// Run full migration
async function runFullMigration() {
  console.log('\nStarting full migration...\n');
  
  // Check if .env file exists
  if (!fs.existsSync(path.join(__dirname, '.env'))) {
    console.log('Configuration not found. Please run setup first.');
    return;
  }
  
  runCommand('node src/index.js migrate');
}

// Run local test
async function runLocalTest() {
  console.log('\nRunning migration in local test mode...\n');
  
  const outputPath = await prompt('Enter output directory (default: ./local-output): ');
  const command = outputPath 
    ? `node src/index.js local -o ${outputPath}` 
    : 'node src/index.js local';
    
  runCommand(command);
}

// Migrate single page
async function migrateSinglePage() {
  console.log('\nMigrating a single page...\n');
  
  const pageName = await prompt('Enter the page name to migrate: ');
  if (!pageName) {
    console.log('Page name is required.');
    return;
  }
  
  runCommand(`node src/index.js migrate -s "${pageName}"`);
}

// Run in debug mode
async function runDebugMode() {
  console.log('\nRunning migration in debug mode...\n');
  
  const isSinglePage = await prompt('Do you want to migrate a single page? (y/n): ');
  
  if (isSinglePage.toLowerCase() === 'y') {
    const pageName = await prompt('Enter the page name to migrate: ');
    if (!pageName) {
      console.log('Page name is required.');
      return;
    }
    
    runCommand(`node src/index.js migrate -d -s "${pageName}"`);
  } else {
    runCommand('node src/index.js migrate -d');
  }
}

// Update existing page
async function updateExistingPage() {
  console.log('\nUpdating an existing page in Confluence...\n');
  
  const pageId = await prompt('Enter the Confluence page ID to update: ');
  if (!pageId || isNaN(pageId)) {
    console.log('A valid page ID is required.');
    return;
  }
  
  // For now, we'll use the parent page ID option to update a specific page
  runCommand(`node src/index.js migrate -d -p ${pageId}`);
}

// Start the main menu
showMainMenu().catch(error => {
  logger.error('An error occurred:', error);
  rl.close();
}); 