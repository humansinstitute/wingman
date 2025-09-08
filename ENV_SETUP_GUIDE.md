# Environment Setup Guide

## Setting up the .env file

To configure Wingman with your preferred default browsing directory:

1. **Copy the example file**:
   ```bash
   cp .env.example .env
   ```

2. **Edit the .env file** and update the `ROOT_WORKING_DIR` variable:
   ```bash
   # For your code directory:
   ROOT_WORKING_DIR=~/code
   
   # Or use an absolute path (customize for your system):
   ROOT_WORKING_DIR=/path/to/your/code
   
   # Or any other preferred starting directory:
   ROOT_WORKING_DIR=~/Projects
   ```

3. **Other available configuration options**:
   ```bash
   NODE_ENV=development
   PORT=3000  # Default port, will auto-increment if in use
   DATABASE_PATH=./db/database.sqlite

   # Root directory for file browser
   # This is the default starting directory when browsing for working directories
   # Use ~ for home directory, or absolute paths like /Users/username/code
   ROOT_WORKING_DIR=~/code

   # Maximum character limit for the message input field
   # Default: 5000 characters
   INPUT_LENGTH=5000
   ```

## New Features Added

### 1. 📁 New Folder Button
- **Location**: Directory browser modal
- **Function**: Creates new folders when selecting working directories
- **Usage**: 
  1. Open directory browser
  2. Navigate to desired parent directory
  3. Click "📁 New Folder" button
  4. Enter folder name
  5. New folder is created and automatically selected

### 2. 🏠 Default Browse Directory
- **Configuration**: `ROOT_WORKING_DIR` in .env file
- **Default**: `~/code` (your code directory)
- **Usage**: When you open the directory browser, it starts in your configured code directory instead of the system root

## How the New Folder Feature Works

### Frontend Functionality
1. **Button**: Added "📁 New Folder" button to directory browser
2. **Validation**: Sanitizes folder names and prevents invalid characters
3. **Auto-selection**: Newly created folders are automatically selected
4. **Refresh**: Directory list refreshes to show the new folder

### Backend API
- **Endpoint**: `POST /api/directories/create`
- **Security**: Validates paths and folder names
- **Error Handling**: Checks for existing folders and permission issues
- **Response**: Returns success status and new folder path

### Usage Example
```javascript
// API call when user creates new folder
POST /api/directories/create
{
  "parentPath": "~/code",
  "folderName": "my-new-project"
}

// Response
{
  "success": true,
  "folderPath": "~/code/my-new-project",
  "folderName": "my-new-project"
}
```

## Complete Workflow

1. **Start session creation wizard**
2. **Choose working directory step**
3. **Click "📁 Browse" button**
4. **Directory browser opens at ~/code** (configured default)
5. **Navigate to desired location**
6. **Click "📁 New Folder"** (if needed)
7. **Enter folder name and create**
8. **Select the directory** (new or existing)
9. **Continue with session creation**

This makes it much easier to create new project directories and organize your development work directly from the Wingman interface!

## Testing the Features

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Open Wingman**: http://localhost:3000 (or check console for actual port)

3. **Test directory browsing**:
   - Click session dropdown → "+ New Session"
   - Go through wizard to working directory step
   - Click "📁 Browse" - should start at ~/code
   - Click "📁 New Folder" to test folder creation

4. **Verify configuration**:
   - Check that browser starts at your configured ROOT_WORKING_DIR
   - Test creating folders with various names
   - Confirm new folders appear in the list and are selectable
