// Streaming CSV Bot - Enhanced for very large CSV files
export default {
  /**
   * Handles incoming HTTP requests from Telegram's webhook.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return await handleTelegramWebhook(request, env);
    }

    return new Response('Bot is running', {
      status: 200
    });
  },

  /**
   * Handles scheduled events from Cron Triggers to process message deletions.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledDeletions(env));
  }
};

/**
 * This function is triggered by a cron job. It checks the deletions.json file
 * in the GitHub repo and deletes any messages past their scheduled time.
 * @param {object} env - The worker's environment variables.
 */
async function handleScheduledDeletions(env) {
  console.log('Running scheduled deletion task...');
  const deletionManager = new GitHubDeletionManager(env);
  const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
  const now = Date.now();

  const {
    deletions,
    sha
  } = await deletionManager.getDeletions();

  if (!deletions || deletions.length === 0) {
    console.log('No pending deletions found.');
    return;
  }

  const dueForDeletion = [];
  const stillPending = [];

  for (const item of deletions) {
    if (now >= item.deleteAt) {
      dueForDeletion.push(item);
    } else {
      stillPending.push(item);
    }
  }

  if (dueForDeletion.length === 0) {
    console.log('No deletions are due at this time.');
    return;
  }

  console.log(`Found ${dueForDeletion.length} messages to delete.`);

  // Attempt to delete all messages that are due
  const deletionPromises = dueForDeletion.map(item =>
    bot.deleteMessage(item.chatId, item.messageId)
  );
  await Promise.all(deletionPromises);

  // Update the file in GitHub with the remaining pending deletions
  try {
    await deletionManager.updateDeletions(stillPending, sha);
    console.log('Successfully updated deletions file on GitHub.');
  } catch (error) {
    console.error('Failed to update deletions file on GitHub:', error);
  }
}

/**
 * Manages the deletions.json file in the GitHub repository.
 */
class GitHubDeletionManager {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.owner = env.GITHUB_OWNER;
    this.repo = env.GITHUB_REPO;
    this.filePath = 'deletions.json'; // The file to store deletion schedule
    this.apiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
  }

  async getDeletions() {
    try {
      const response = await fetch(this.apiUrl, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Archive-Bot-Deleter'
        }
      });

      if (response.status === 404) {
        return {
          deletions: [],
          sha: null
        }; // File doesn't exist
      }
      if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

      const data = await response.json();
      const content = atob(data.content);
      return {
        deletions: JSON.parse(content),
        sha: data.sha
      };
    } catch (error) {
      console.error('Error getting deletions file:', error);
      return {
        deletions: [],
        sha: null
      }; // Return a safe default
    }
  }

  async updateDeletions(deletions, sha) {
    const content = btoa(JSON.stringify(deletions, null, 2)); // Use btoa for base64 encoding
    const message = 'Update scheduled deletions';

    const body = {
      message,
      content,
      sha,
    };
    // The GitHub API uses the presence of the 'sha' key to determine
    // if it's a file creation or update.

    const response = await fetch(this.apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Archive-Bot-Deleter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GitHub API error updating deletions: ${response.status} - ${errorBody}`);
    }
    return await response.json();
  }
}


class StreamingGitHubCSVManager {
  constructor(env) {
    this.token = env.GITHUB_TOKEN;
    this.owner = env.GITHUB_OWNER;
    this.repo = env.GITHUB_REPO;
    this.filePath = 'archiveTG_data.csv';
    this.apiUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
    this.GITHUB_SIZE_LIMIT = 1048576; // 1MB in bytes
  }

  async getFileInfo() {
    try {
      const response = await fetch(this.apiUrl, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Archive-Bot'
        }
      });
      if (response.status === 404) return {
        exists: false,
        sha: null,
        size: 0,
        isLarge: false
      };
      if (response.ok) {
        const data = await response.json();
        return {
          exists: true,
          sha: data.sha,
          size: data.size,
          isLarge: data.size > this.GITHUB_SIZE_LIMIT
        };
      }
      return {
        exists: false,
        sha: null,
        size: 0,
        isLarge: false
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      return {
        exists: false,
        sha: null,
        size: 0,
        isLarge: false
      };
    }
  }

  async downloadLargeFile() {
    try {
      const fileInfo = await this.getFileInfo();
      if (!fileInfo.exists) return null;
      const blobUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs/${fileInfo.sha}`;
      const response = await fetch(blobUrl, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Archive-Bot'
        }
      });
      if (!response.ok) throw new Error(`Failed to fetch blob: ${response.status}`);
      const blobData = await response.json();
      return blobData.encoding === 'base64' ? atob(blobData.content) : blobData.content;
    } catch (error) {
      console.error('Error downloading large file:', error);
      return null;
    }
  }

  async getFileContent() {
    try {
      const fileInfo = await this.getFileInfo();
      if (!fileInfo.exists) return null;
      if (fileInfo.isLarge) {
        console.log('Using Git Data API for large file');
        return await this.downloadLargeFile();
      } else {
        const response = await fetch(this.apiUrl, {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Archive-Bot'
          }
        });
        if (!response.ok) return null;
        const fileData = await response.json();
        return atob(fileData.content);
      }
    } catch (error) {
      console.error('Error getting file content:', error);
      return null;
    }
  }

  async findFileByIdStreaming(numericalFileId) {
    try {
      const content = await this.getFileContent();
      if (!content) {
        console.error('Failed to get file content');
        return null;
      }
      const lines = content.split('\n');
      let headerSkipped = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!headerSkipped && line.toLowerCase().includes('numerical')) {
          headerSkipped = true;
          continue;
        }
        const parsedLine = this.parseCSVLine(line);
        if (parsedLine && parsedLine.length >= 4 && parsedLine[0] === numericalFileId) {
          return {
            file_id: parsedLine[1],
            file_name: parsedLine[2] || 'Unknown',
            file_type: parsedLine[3] || 'Unknown'
          };
        }
        if (i % 5000 === 0 && i > 0) console.log(`Searched ${i} lines...`);
      }
      return null;
    } catch (error) {
      console.error('Error in streaming search:', error);
      return null;
    }
  }

  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    while (i < line.length) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    result.push(current.trim());
    return result;
  }

  async getFileCount() {
    try {
      const content = await this.getFileContent();
      if (!content) return 0;
      let lineCount = 0,
        hasHeader = false,
        pos = 0;
      const firstNewline = content.indexOf('\n');
      if (firstNewline !== -1) {
        const firstLine = content.substring(0, firstNewline).toLowerCase();
        hasHeader = firstLine.includes('numerical') || firstLine.includes('file_id');
      }
      while (pos < content.length) {
        const nextNewline = content.indexOf('\n', pos);
        if (nextNewline === -1) break;
        if (content.substring(pos, nextNewline).trim()) lineCount++;
        pos = nextNewline + 1;
      }
      if (content.substring(pos).trim()) lineCount++;
      return Math.max(0, lineCount - (hasHeader ? 1 : 0));
    } catch (error) {
      console.error('Error getting file count:', error);
      return 0;
    }
  }

  async checkForDuplicate(fileName, fileId) {
    try {
      const content = await this.getFileContent();
      if (!content) return null;
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsedLine = this.parseCSVLine(line);
        if (parsedLine && parsedLine.length >= 4) {
          if (parsedLine[2] === fileName || parsedLine[1] === fileId) {
            return {
              numericalId: parsedLine[0],
              fileData: {
                file_name: parsedLine[2],
                file_id: parsedLine[1],
                file_type: parsedLine[3]
              }
            };
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Error checking for duplicate:', error);
      return null;
    }
  }

  async appendToCSV(numericalFileId, fileId, fileName, fileType) {
    try {
      const fileInfo = await this.getFileInfo();
      if (!fileInfo.exists) {
        const csvContent = `numerical_file_id,file_id,file_name,file_type\n${numericalFileId},${fileId},${this.escapeCSV(fileName)},${fileType}\n`;
        return await this.createFile(csvContent);
      } else {
        const currentContent = await this.getFileContent();
        if (!currentContent) throw new Error('Failed to read current file content');
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
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
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
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
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
    const response = await fetch(`${this.apiUrl}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode
      })
    });
    return await response.json();
  }

  async sendPhoto(chatId, photoId, caption, parseMode = 'Markdown') {
    const response = await fetch(`${this.apiUrl}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoId,
        caption,
        parse_mode: parseMode
      })
    });
    return await response.json();
  }

  async sendDocument(chatId, documentId, caption, parseMode = 'Markdown') {
    const response = await fetch(`${this.apiUrl}/sendDocument`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        document: documentId,
        caption,
        parse_mode: parseMode
      })
    });
    return await response.json();
  }

  async deleteMessage(chatId, messageId) {
    try {
      await fetch(`${this.apiUrl}/deleteMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId
        })
      });
    } catch (error) {
      console.error(`Error deleting message ${messageId}:`, error);
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
  let fileId = null,
    fileName = "Unknown file name",
    fileType = "Unknown file type";

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

  if (!fileId) return;

  setTimeout(() => bot.deleteMessage(chatId, message.message_id), 60000);

  try {
    const statusMessage = await bot.sendMessage(chatId, "🔍 Checking for duplicates...");
    const existingFile = await csvManager.checkForDuplicate(fileName, fileId);
    if (statusMessage.ok) await bot.deleteMessage(chatId, statusMessage.result.message_id);

    if (existingFile) {
      await bot.sendMessage(chatId, `*⚠️ File already exists*\n\n*File Name:* \`${existingFile.fileData.file_name}\`\n*Numerical FileID:* \`${existingFile.numericalId}\``);
    } else {
      const addingMessage = await bot.sendMessage(chatId, "📝 Adding file to archive...");
      const numericalFileId = generateNumericalFileId();
      await csvManager.appendToCSV(numericalFileId, fileId, fileName, fileType);
      const totalFiles = await csvManager.getFileCount();
      if (addingMessage.ok) await bot.deleteMessage(chatId, addingMessage.result.message_id);
      await bot.sendMessage(chatId, `*✅ File archived successfully!*\n\n*File Name:* \`${fileName}\`\n*Numerical File ID:* \`${numericalFileId}\`\n\n*Total files:* ${totalFiles}`);
    }
  } catch (error) {
    console.error('Error handling file upload:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function handleFileRequest(update, bot, csvManager, env) {
  const message = update.message;
  const chatId = message.chat.id;
  const parts = message.text.split(' ');
  const numericalFileId = parts.length > 1 ? parts[1] : '';

  if (!/^\d+$/.test(numericalFileId)) {
    if (message.text.startsWith('/start')) {
      await bot.sendMessage(chatId, "Welcome! Send a file to archive it, or use `/get <ID>` to retrieve one.");
    } else {
      await bot.sendMessage(chatId, "Invalid command. Use `/get <numerical_file_id>`.");
    }
    return;
  }

  try {
    const searchingMessage = await bot.sendMessage(chatId, "🔍 Searching archive...");
    const fileData = await csvManager.findFileByIdStreaming(numericalFileId);
    if (searchingMessage.ok) await bot.deleteMessage(chatId, searchingMessage.result.message_id);

    if (!fileData) {
      await bot.sendMessage(chatId, "❌ File not found. Please check the ID.");
      return;
    }

    const deleteDelayMs = parseInt(env.DELETE_DELAY_MS, 10) || 5400000;
    const deleteDelayMinutes = Math.round(deleteDelayMs / 60000);
    const caption = `*Found file! 😊*\n\n*Numerical File ID:* \`${numericalFileId}\`\n*File Name:* \`${fileData.file_name}\`\n\n*This file will be deleted in ~${deleteDelayMinutes} minutes.*`;

    let sentMessage;
    if (fileData.file_type === "Photo") {
      sentMessage = await bot.sendPhoto(chatId, fileData.file_id, caption);
    } else {
      sentMessage = await bot.sendDocument(chatId, fileData.file_id, caption);
    }

    if (sentMessage.ok) {
      const deletionManager = new GitHubDeletionManager(env);
      const {
        deletions,
        sha
      } = await deletionManager.getDeletions();
      const deleteAt = Date.now() + deleteDelayMs;
      deletions.push({
        chatId: chatId,
        messageId: sentMessage.result.message_id,
        deleteAt: deleteAt
      });
      await deletionManager.updateDeletions(deletions, sha);
      console.log(`Scheduled message ${sentMessage.result.message_id} for deletion.`);
    }

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
    await bot.sendMessage(chatId, debugInfo);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Debug error: ${error.message}`);
  }
}

async function handleTelegramWebhook(request, env) {
  try {
    const update = await request.json();
    if (!update.message) return new Response('OK');

    const csvManager = new StreamingGitHubCSVManager(env);
    const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN);
    const message = update.message;

    if (message.document || message.photo || message.video) {
      await handleFileUpload(update, bot, csvManager);
    } else if (message.text) {
      if (message.text.startsWith('/start') || message.text.startsWith('/get')) {
        await handleFileRequest(update, bot, csvManager, env);
      } else if (message.text.startsWith('/debug')) {
        await handleDebug(update, bot, csvManager);
      }
    }
    return new Response('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', {
      status: 500
    });
  }
}


