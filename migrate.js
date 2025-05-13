#!/usr/bin/env node
const { execSync } = require("child_process");
const readline = require("readline");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const { logger } = require("./src/utils");
const { clearValidationState } = require("./src/confluence/pageValidator");

// Load environment variables
dotenv.config();

// Setup readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
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
    execSync(command, { stdio: "inherit", ...options });
    return true;
  } catch (error) {
    logger.error(`Command failed with error: ${error.message}`);
    return false;
  }
}

// Function to display duplicate pages from validation state
async function displayDuplicatePages() {
  const validationFile = path.join(process.cwd(), ".validation-state.json");

  if (!fs.existsSync(validationFile)) {
    console.log(
      "\nNo validation state file found. Run the migration first to detect duplicates."
    );
    return;
  }

  try {
    const validationState = await fs.readJson(validationFile);
    if (validationState.length === 0) {
      console.log("\nNo duplicate pages found in validation state.");
      return;
    }

    console.log("\nDuplicate pages found:");
    console.log("=====================");

    validationState.forEach((duplicate, index) => {
      console.log(`\n${index + 1}. "${duplicate.title}"`);
      console.log(`   Reason: ${duplicate.reason}`);
      if (duplicate.confluenceId) {
        console.log(`   Confluence Page ID: ${duplicate.confluenceId}`);
      }
      if (duplicate.path) {
        console.log(`   Confluence Page Path: ${duplicate.path}`);
      }
    });

    console.log("\nValidation state file location:", validationFile);
    return validationState;
  } catch (error) {
    console.error("Error reading validation state:", error);
    return null;
  }
}

// Function to handle auto-fixing page names
async function autoFixPageNames() {
  console.log("\nAuto-fixing page names...\n");

  const duplicates = await displayDuplicatePages();
  if (!duplicates) {
    return;
  }

  const proceed = await prompt(
    "\nDo you want to proceed with auto-fixing these page names? (y/n): "
  );
  if (proceed.toLowerCase() !== "y") {
    console.log("Auto-fix cancelled.");
    return;
  }

  try {
    // Run the auto-fix command
    runCommand("node src/index.js fix-names");
    console.log("\nAuto-fix completed. Please:");
    console.log("1. Review the changes in .page-name-fixes.json");
    console.log("2. Run the migration again to validate the changes");
  } catch (error) {
    console.error("Error during auto-fix:", error);
  }
}

// Main menu function
async function showMainMenu() {
  console.clear();
  console.log("=======================================================");
  console.log("        Azure Wiki to Confluence Migration Tool        ");
  console.log("=======================================================");
  console.log("");
  console.log("Please select an option:");
  console.log("");
  console.log("1. Setup configuration");
  console.log("2. Run full migration");
  console.log("3. Test migration locally (no Confluence connection)");
  console.log("4. Migrate a single page");
  console.log("5. Debug mode (verbose logging)");
  console.log("6. Update an existing page in Confluence");
  console.log("7. Display duplicate pages");
  console.log("8. Auto-fix duplicate page names");
  console.log("9. Clear validation state");
  console.log("10. Exit");
  console.log("");

  const choice = await prompt("Enter your choice (1-10): ");

  switch (choice) {
    case "1":
      await runSetup();
      break;
    case "2":
      await runFullMigration();
      break;
    case "3":
      await runLocalTest();
      break;
    case "4":
      await migrateSinglePage();
      break;
    case "5":
      await runDebugMode();
      break;
    case "6":
      await updateExistingPage();
      break;
    case "7":
      await displayDuplicatePages();
      break;
    case "8":
      await autoFixPageNames();
      break;
    case "9":
      const validationFile = path.join(process.cwd(), ".validation-state.json");
      if (fs.existsSync(validationFile)) {
        await fs.remove(validationFile);
        console.log("Validation state cleared successfully.");
      } else {
        console.log("No validation state file exists.");
      }
      break;
    case "10":
      console.log("Exiting. Goodbye!");
      console.log("OPM Team :)");
      rl.close();
      return;
    default:
      console.log("Invalid choice. Please try again.");
      await prompt("Press Enter to continue...");
      await showMainMenu();
      return;
  }

  // Return to main menu after action completes
  await prompt("\nPress Enter to return to main menu...");
  await showMainMenu();
}

// Setup configuration
async function runSetup() {
  console.log("\nRunning setup wizard...\n");
  runCommand("node setup.js");
}

// Run full migration
async function runFullMigration() {
  console.log("\nStarting full migration...\n");

  // Check if .env file exists
  if (!fs.existsSync(path.join(__dirname, ".env"))) {
    console.log("Configuration not found. Please run setup first.");
    return;
  }

  runCommand("node src/index.js migrate");
}

// Run local test
async function runLocalTest() {
  console.log("\nRunning migration in local test mode...\n");

  const outputPath = await prompt(
    "Enter output directory (default: ./local-output): "
  );
  const command = outputPath
    ? `node src/index.js local -o ${outputPath}`
    : "node src/index.js local";

  runCommand(command);
}

// Migrate single page
async function migrateSinglePage() {
  console.log("\nMigrating a single page...\n");

  const pageName = await prompt("Enter the page name to migrate: ");
  if (!pageName) {
    console.log("Page name is required.");
    return;
  }

  runCommand(`node src/index.js migrate -s "${pageName}"`);
}

// Run in debug mode
async function runDebugMode() {
  console.log("\nRunning migration in debug mode...\n");

  const isSinglePage = await prompt(
    "Do you want to migrate a single page? (y/n): "
  );

  if (isSinglePage.toLowerCase() === "y") {
    const pageName = await prompt("Enter the page name to migrate: ");
    if (!pageName) {
      console.log("Page name is required.");
      return;
    }

    runCommand(`node src/index.js migrate -d -s "${pageName}"`);
  } else {
    runCommand("node src/index.js migrate -d");
  }
}

// Update existing page
async function updateExistingPage() {
  console.log("\nUpdating an existing page in Confluence...\n");

  const pageId = await prompt("Enter the Confluence page ID to update: ");
  if (!pageId || isNaN(pageId)) {
    console.log("A valid page ID is required.");
    return;
  }

  // For now, we'll use the parent page ID option to update a specific page
  runCommand(`node src/index.js migrate -d -p ${pageId}`);
}

// Start the main menu
showMainMenu().catch((error) => {
  logger.error("An error occurred:", error);
  rl.close();
});
