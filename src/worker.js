// Streaming CSV Bot - Enhanced for very large CSV files
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return await handleTelegramWebhook(request, env);
    }
    
    return new Response('Bot is running', { status: 200 });
  }
};

class StreamingGitHubCSVManager {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.owner = env.GITHUB_OWNER;
    this.repo = env.GITHUB_REPO;
    this.filePath = 'archiveTG_data.csv';
    this.apiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
    // GitHub API limit for direct content access is 1MB
    this.GITHUB_SIZE_LIMIT = 1048576; // 1MB in bytes
  }

  // Get file info with proper size handling
  async getFileInfo() {
    try {
      const response = await fetch(this.apiUrl, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Archive-Bot'
        }
      });

      if (response.status === 404) {
        return { exists: false, sha: null, size: 0, isLarge: false };
      }

      if (response.ok) {
        const data = await response.json();
        return { 
          exists: true, 
          sha: data.sha, 
          size: data.size,
          isLarge: data.size > this.GITHUB_SIZE_LIMIT
        };
      }

      return { exists: false, sha: null, size: 0, isLarge: false };
    } catch (error) {
      console.error('Error getting file info:', error);
      return { exists: false, sha: null, size: 0, isLarge: false };
    }
  }

  // Download large file using Git Data API
  async downloadLargeFile() {
    try {
      // First get the file SHA
      const fileInfo = await this.getFileInfo();
      if (!fileInfo.exists) {
        return null;
      }

      // Use Git Data API to get blob content for large files
      const blobUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs/${fileInfo.sha}`;
      
      const response = await fetch(blobUrl, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Archive-Bot'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch blob: ${response.status}`);
      }

      const blobData = await response.json();
      
      if (blobData.encoding === 'base64') {
        return atob(blobData.content);
      } else {
        return blobData.content;
      }
    } catch (error) {
      console.error('Error downloading large file:', error);
      return null;
    }
  }

  // Get file content with automatic large file handling
  async getFileContent() {
    try {
      const fileInfo = await this.getFileInfo();
      
      if (!fileInfo.exists) {
        return null;
      }

      if (fileInfo.isLarge) {
        console.log('Using Git Data API for large file');
        return await this.downloadLargeFile();
      } else {
        // Use regular Contents API for smaller files
        const response = await fetch(this.apiUrl, {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Archive-Bot'
          }
        });

        if (!response.ok) {
          return null;
        }

        const fileData = await response.json();
        return atob(fileData.content);
      }
    } catch (error) {
      console.error('Error getting file content:', error);
      return null;
    }
  }

  // Enhanced streaming search that handles large files properly
  async findFileByIdStreaming(numericalFileId) {
    try {
      const content = await this.getFileContent();
      
      if (!content) {
        console.error('Failed to get file content');
        return null;
      }

      // Stream search through content line by line
      const lines = content.split('\n');
      let headerSkipped = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Skip header
        if (!headerSkipped && line.toLowerCase().includes('numerical')) {
          headerSkipped = true;
          continue;
        }
        
        // Parse CSV line properly
        const parsedLine = this.parseCSVLine(line);
        
        if (parsedLine && parsedLine.length >= 4 && parsedLine[0] === numericalFileId) {
          return {
            file_id: parsedLine[1],
            file_name: parsedLine[2] || 'Unknown',
            file_type: parsedLine[3] || 'Unknown'
          };
        }
        
        // Progress logging for large files
        if (i % 5000 === 0 && i > 0) {
          console.log(`Searched ${i} lines...`);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error in streaming search:', error);
      return null;
    }
  }

  // Proper CSV line parser that handles quoted fields
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    
    // Add the last field
    result.push(current.trim());
    
    return result;
  }

  // Enhanced file count method
  async getFileCount() {
    try {
      const content = await this.getFileContent();
      
      if (!content) {
        return 0;
      }
      
      // Count lines efficiently
      let lineCount = 0;
      let hasHeader = false;
      let pos = 0;
      
      // Check first line for header
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        const firstLine = content.substring(0, firstNewline).toLowerCase();
        hasHeader = firstLine.includes('numerical') || firstLine.includes('file_id');
      }
      
      // Count all lines
      while (pos < content.length) {
        const nextNewline = content.indexOf('\n', pos);
        if (nextNewline === -1) break;
        
        const line = content.substring(pos, nextNewline).trim();
        if (line) lineCount++;
        
        pos = nextNewline + 1;
      }
      
      // Check last line if no trailing newline
      const lastLine = content.substring(pos).trim();
      if (lastLine) lineCount++;
      
      return Math.max(0, lineCount - (hasHeader ? 1 : 0));
    } catch (error) {
      console.error('Error getting file count:', error);
      return 0;
    }
  }

  // Enhanced duplicate check
  async checkForDuplicate(fileName, fileId) {
    try {
      const content = await this.getFileContent();
      
      if (!content) {
        return null;
      }
      
      const lines = content.split('\n');
      let linesChecked = 0;
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // Parse the CSV line properly
        const parsedLine = this.parseCSVLine(line);
        
        if (parsedLine && parsedLine.length >= 4) {
          const existingFileName = parsedLine[2];
          const existingFileId = parsedLine[1];
          
          if (existingFileName === fileName || existingFileId === fileId) {
            return {
              numericalId: parsedLine[0],
              fileData: {
                file_name: existingFileName,
                file_id: existingFileId,
                file_type: parsedLine[3]
              }
            };
          }
        }
        
        linesChecked++;
        // Progress logging for large files
        if (linesChecked % 5000 === 0) {
          console.log(`Checked ${linesChecked} lines for duplicates...`);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error checking for duplicate:', error);
      return null;
    }
  }

  // Append to CSV with large file support
  async appendToCSV(numericalFileId, fileId, fileName, fileType) {
    try {
      const fileInfo = await this.getFileInfo();
      
      if (!fileInfo.exists) {
        // Create new file
        const csvContent = 'numerical_file_id,file_id,file_name,file_type\n' +
          `${numericalFileId},${fileId},${this.escapeCSV(fileName)},${fileType}\n`;
        
        return await this.createFile(csvContent);
      } else {
        // For large files, we need to get the content first
        const currentContent = await this.getFileContent();
        if (!currentContent) {
          throw new Error('Failed to read current file content');
        }
        
        const newLine = `${numericalFileId},${fileId},${this.escapeCSV(fileName)},${fileType}\n`;
        const updatedContent = currentContent.trimEnd() + '\n' + newLine;
        
        return await this.updateFile(updatedContent, fileInfo.sha);
      }
    } catch (error) {
      console.error('Error appending to CSV:', error);
      throw error;
    }
  }

  async createFile(content) {
    const response = await fetch(this.apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Archive-Bot',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Create archive file',
        content: btoa(content)
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  }

  async updateFile(content, sha) {
    const response = await fetch(this.apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Archive-Bot',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add new file to archive',
        content: btoa(content),
        sha: sha
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  }

  escapeCSV(field) {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}

class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId, text, parseMode = 'Markdown') {
    try {
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: parseMode
        })
      });
      
      return await response.json();
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async sendPhoto(chatId, photoId, caption, parseMode = 'Markdown') {
    const response = await fetch(`${this.apiUrl}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoId,
        caption: caption,
        parse_mode: parseMode
      })
    });
    
    return await response.json();
  }

  async sendDocument(chatId, documentId, caption, parseMode = 'Markdown') {
    const response = await fetch(`${this.apiUrl}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        document: documentId,
        caption: caption,
        parse_mode: parseMode
      })
    });
    
    return await response.json();
  }

  async deleteMessage(chatId, messageId) {
    try {
      await fetch(`${this.apiUrl}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId
        })
      });
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  }
}

function generateNumericalFileId(length = 16) {
  let result = '';
  const digits = '0123456789';
  for (let i = 0; i < length; i++) {
    result += digits.charAt(Math.floor(Math.random() * digits.length));
  }
  return result;
}

async function handleFileUpload(update, bot, csvManager) {
  const message = update.message;
  const chatId = message.chat.id;
  let fileId = null;
  let fileName = "Unknown file name";
  let fileType = "Unknown file type";

  if (message.document) {
    fileId = message.document.file_id;
    fileName = message.document.file_name || "Document";
    fileType = "Document";
  } else if (message.photo) {
    fileId = message.photo[message.photo.length - 1].file_id;
    fileName = "Photo";
    fileType = "Photo";
  } else if (message.video) {
    fileId = message.video.file_id;
    fileName = message.video.file_name || "Video";
    fileType = "Video";
  }

  if (!fileId) {
    await bot.sendMessage(chatId, "No valid file found.");
    return;
  }

  // Delete user's message
  setTimeout(async () => {
    await bot.deleteMessage(chatId, message.message_id);
  }, 60000);

  try {
    await bot.sendMessage(chatId, "🔍 Checking for duplicates...");
    
    // Quick duplicate check
    const existingFile = await csvManager.checkForDuplicate(fileName, fileId);

    if (existingFile) {
      await bot.sendMessage(
        chatId,
        `*⚠️ File already exists*\n\n*File Name:* \`${existingFile.fileData.file_name}\`\n\n*Numerical File ID:* \`${existingFile.numericalId}\``
      );
    } else {
      await bot.sendMessage(chatId, "📝 Adding file to archive...");
      
      const numericalFileId = generateNumericalFileId();
      
      // Append to CSV
      await csvManager.appendToCSV(numericalFileId, fileId, fileName, fileType);
      
      // Get updated count
      const totalFiles = await csvManager.getFileCount();

      await bot.sendMessage(
        chatId,
        `*✅ File archived successfully!*\n\n*File Name:* \`${fileName}\`\n\n*Numerical File ID:* \`${numericalFileId}\`\n\n*Total files:* ${totalFiles}`
      );
    }
  } catch (error) {
    console.error('Error handling file upload:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function handleFileRequest(update, bot, csvManager, command) {
  const message = update.message;
  const chatId = message.chat.id;
  
  const text = message.text;
  const parts = text.split(' ');
  const numericalFileId = parts.length > 1 ? parts[1] : text.split('/').pop();

  if (!numericalFileId || numericalFileId === 'start' || numericalFileId === 'get') {
    if (command === 'start') {
      await bot.sendMessage(chatId, "Welcome to ArchiveAnyFileBot. Send me files to archive or use /get {ID} to get the archived files.");
    } else {
      await bot.sendMessage(chatId, "Invalid command format. Use /get {numerical_file_id} to get a file.");
    }
    return;
  }

  try {
    await bot.sendMessage(chatId, "🔍 Searching archive...");
    
    // Stream search for the file
    const fileData = await csvManager.findFileByIdStreaming(numericalFileId);

    if (!fileData) {
      await bot.sendMessage(chatId, "❌ File not found. Check your ID and try again.");
      return;
    }

    const caption = `*Found file!*\n\n*ID:* \`${numericalFileId}\`\n*Name:* \`${fileData.file_name}\`\n*Type:* ${fileData.file_type}\n\n*File will be deleted after 1.5 hours.*`;

    let sentMessage;
    if (fileData.file_type === "Photo") {
      sentMessage = await bot.sendPhoto(chatId, fileData.file_id, caption);
    } else {
      sentMessage = await bot.sendDocument(chatId, fileData.file_id, caption);
    }

    // Schedule deletion
    setTimeout(async () => {
      if (sentMessage.ok) {
        await bot.deleteMessage(chatId, sentMessage.result.message_id);
      }
    }, 5400000);

  } catch (error) {
    console.error('Error handling file request:', error);
    await bot.sendMessage(chatId, `❌ Search error: ${error.message}`);
  }
}

async function handleDebug(update, bot, csvManager) {
  const chatId = update.message.chat.id;
  
  try {
    const fileInfo = await csvManager.getFileInfo();
    const fileCount = fileInfo.exists ? await csvManager.getFileCount() : 0;
    
    let debugInfo = `*📊 Archive Status:*\n`;
    debugInfo += `📁 Total files: ${fileCount}\n`;
    debugInfo += `📄 CSV size: ${(fileInfo.size / 1024).toFixed(1)}KB\n`;
    debugInfo += `🔍 Large file mode: ${fileInfo.isLarge ? 'Yes (Git Data API)' : 'No (Contents API)'}\n`;
    debugInfo += `📏 Size limit: ${(csvManager.GITHUB_SIZE_LIMIT / 1024).toFixed(0)}KB\n`;
    debugInfo += `✅ Status: ${fileInfo.exists ? 'Ready' : 'No archive yet'}\n`;
    
    await bot.sendMessage(chatId, debugInfo);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Debug error: ${error.message}`);
  }
}

async function handleTelegramWebhook(request, env) {
  try {
    const update = await request.json();
    
    if (!update.message) {
      return new Response('OK', { status: 200 });
    }

    const csvManager = new StreamingGitHubCSVManager(env);
    const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);

    const message = update.message;
    
    if (message.document || message.photo || message.video) {
      await handleFileUpload(update, bot, csvManager);
    } else if (message.text) {
      if (message.text.startsWith('/start')) {
        await handleFileRequest(update, bot, csvManager, 'start');
      } else if (message.text.startsWith('/get')) {
        await handleFileRequest(update, bot, csvManager, 'get');
      } else if (message.text.startsWith('/debug')) {
        await handleDebug(update, bot, csvManager);
      }
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', { status: 500 });
  }
}