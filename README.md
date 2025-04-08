# Azure DevOps Wiki to Confluence Migration Tool

A Node.js tool to migrate Azure DevOps wiki pages to Confluence while preserving structure and attachments.

## Features

- Migrates wiki pages from Azure DevOps to Confluence
- Preserves page hierarchy and structure
- Handles attachments and images
- Supports markdown conversion
- Local testing mode
- Flexible configuration

## Prerequisites

- Node.js >= 14.0.0
- Access to Azure DevOps Wiki
- Confluence API token

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the setup script:
   ```bash
   npm run setup
   ```
   This will guide you through configuring:
   - Confluence credentials
   - Space key
   - Parent page ID
   - Project name
   - Wiki paths

## Configuration

The tool uses environment variables for configuration. Create a `.env` file with:

```env
# Confluence API Configuration
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_USERNAME=your.email@example.com
CONFLUENCE_API_TOKEN=your-api-token

# Confluence Space Configuration
CONFLUENCE_SPACE_KEY=SPACE
CONFLUENCE_PARENT_PAGE_ID=12345

# Paths Configuration
AZURE_WIKI_PATH=../Your-Project
PROJECT_NAME=Your-Project
WIKI_ROOT_DIR=../Your-Project.wiki
ATTACHMENTS_PATH=../Your-Project.wiki/.attachments
```

## Usage

### Basic Commands

```bash
# Show help
node src/index.js --help

# Run local test
node src/index.js local

# Migrate all pages
node src/index.js migrate

# Migrate a single page
node src/index.js migrate --single "Page Name"
```

### Global Options

```bash
-d, --debug           Enable debug mode
-o, --output <path>   Output directory for local testing (default: "./local-output")
```

### Local Test Command Options

```bash
-w, --wiki-path <path>  Path to the wiki folder
```

### Migrate Command Options

```bash
-s, --single <page>  Migrate a single page
-p, --parent <id>    Confluence parent page ID
```

### Examples

```bash
# Run with debug mode
node src/index.js migrate --debug

# Test locally with custom wiki path
node src/index.js local --wiki-path ../my-wiki

# Migrate single page to specific parent
node src/index.js migrate --single "Getting Started" --parent 123456
```

## Different Wiki Folder Structures

The tool supports various wiki folder structures:

1. Standard Structure:
```
project/
  ├── .attachments/
  └── wiki/
      └── pages/
```

2. Adjacent Wiki:
```
project/
  └── src/
wiki/
  └── .attachments/
```

3. Custom Structure:
```
custom/
  └── wiki/
      └── .attachments/
```

## Troubleshooting

1. **Authentication Failed**
   - Check your Confluence API token
   - Verify username is correct
   - Ensure token has necessary permissions

2. **Missing Attachments**
   - Verify .attachments folder exists
   - Check file permissions
   - Ensure paths are correctly configured

3. **Page Creation Failed**
   - Check space key exists
   - Verify parent page ID is valid
   - Ensure sufficient permissions

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

ISC