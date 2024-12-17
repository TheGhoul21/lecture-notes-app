// src/utils/config.js
require('dotenv').config();

module.exports = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
};