# Azure Wiki to Confluence Migration Tool

This tool allows you to migrate content from an Azure DevOps Wiki to Confluence.

## Features

- Migrates all wiki pages while preserving the hierarchical structure
- Uploads and maintains attachments (images, documents, etc.)
- Converts markdown to Confluence-compatible format
- Supports image sizing parameters
- Handles wiki links and converts them to Confluence links
- Preserves formatting, tables, code blocks, etc.
- Auto-detects project structure and .attachments folder

## Prerequisites

- Node.js (v14+)
- Access to both the Azure DevOps Wiki (local clone) and Confluence
- Confluence API token with appropriate permissions

## Setup

### Step 1: Clone this repository

```bash
git clone <repository-url>
cd azure-to-confluence
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Run the setup script

```bash
npm run setup
# or
node setup.js
```

The setup script will:
- Auto-detect your project name based on the directory structure
- Create a `.env` file with your configuration
- Guide you through setting up the Confluence connection
- Help locate the wiki content and attachments folders

## Interactive Migration Helper

For an easier experience, you can use the interactive migration helper:

```bash
npm run migrate
# or
node migrate.js
```

This interactive tool provides a menu-driven interface to:
1. Setup configuration
2. Run full migration
3. Test migration locally
4. Migrate a single page
5. Run with debug mode
6. Update an existing page
7. Exit

## Configuration

The tool is configured through environment variables, which can be set in a `.env` file. The setup script will help you create this file, but you can also create or edit it manually using the `.env.example` as a template:

```bash
# Copy the example config file
cp .env.example .env
# Edit with your favorite editor
nano .env
```

Configuration options include:

```
# Confluence API Configuration
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_USERNAME=your.email@example.com
CONFLUENCE_API_TOKEN=your-api-token

# Confluence Space Configuration
CONFLUENCE_SPACE_KEY=SPACE
CONFLUENCE_PARENT_PAGE_ID=12345678

# Project Configuration
PROJECT_NAME=Your-Project-Name

# Paths Configuration
AZURE_WIKI_PATH=../Your-Project
WIKI_ROOT_DIR=../Your-Project.wiki
ATTACHMENTS_PATH=../Your-Project.wiki/.attachments
OUTPUT_PATH=./output
```

### Obtaining a Confluence API Token

1. Log in to your Atlassian account at https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give the token a name (e.g., "Wiki Migration") and click "Create"
4. Copy the token and use it for the `CONFLUENCE_API_TOKEN` value

### Finding the Confluence Parent Page ID

1. Navigate to the Confluence page that should be the parent for your wiki
2. Look at the URL, which will contain something like `/pages/viewpage.action?pageId=12345678`
3. The number after `pageId=` is your parent page ID

## Usage

### Running the Migration

To run the migration with default settings:

```bash
npm start
# or
node src/index.js
```

This will migrate all pages from your Azure DevOps Wiki to Confluence.

### Command Line Options

- `--local` or `-l`: Run in local test mode (doesn't upload to Confluence)
- `--debug` or `-d`: Enable debug mode with more detailed logging
- `--output` or `-o`: Specify an output directory for local test mode
- `--singlePage "PageName"`: Process only a single page (useful for testing)
- `--page 123456`: Process a specific Confluence page by ID (useful for updates)

### Examples

Test migration locally:
```bash
npm run test:local
# or
node src/index.js --local
```

Migrate a single page:
```bash
npm run migrate:single Getting-Started
# or
node src/index.js --singlePage "Getting-Started"
```

Migrate with debug information:
```bash
npm run debug
# or
node src/index.js --debug
```

## Different Wiki Folder Structures

The tool is designed to work with different wiki folder structures:

### Standard Azure DevOps Wiki Structure

```
- Your-Project.wiki/
  - .attachments/
  - .order
  - Home.md
  - Getting-Started.md
```

### Project with Wiki as a Subdirectory

```
- Your-Project/
  - src/
  - docs/
  - wiki/
    - .attachments/
    - Home.md
```

### Wiki with Attachments in a Different Location

```
- Your-Project.wiki/
  - Home.md
- .attachments/
```

The tool will attempt to detect these structures automatically. If it can't find your attachments, you can specify the path using the `ATTACHMENTS_PATH` environment variable.

## Troubleshooting

### Image Attachments Not Working

If images aren't showing correctly in Confluence:

1. Check that the `.attachments` folder is correctly detected
2. Verify that the image files exist in the attachments folder
3. Check the logs for any upload errors
4. Run with `--debug` for more detailed logging

### Authentication Errors

If you encounter authentication errors:

1. Verify your API token is correct and has not expired
2. Check that you have the right permissions in Confluence
3. Make sure the space key is correct

### Converting Specific Pages

If you need to test or fix a specific page:

```bash
node src/index.js --singlePage "Problematic-Page" --debug
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.