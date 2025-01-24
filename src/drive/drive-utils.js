const { google } = require('googleapis');
const config = require('../utils/config');


async function listVideoFiles(auth) {
  const drive = google.drive({ version: 'v3', auth });
  try{
    console.log(config.googleDriveFolderId)
  const res = await drive.files.list({
      q: `'${config.googleDriveFolderId}' in parents and mimeType contains 'video'`,
      fields: 'files(id, name)',
    });

    return res.data.files;
  } catch(err) {
    console.error(err);
    return []
  }
}

async function listPDFFiles(auth) {
  const drive = google.drive({ version: 'v3', auth });
  try {
    const res = await drive.files.list({
      q: `'${config.googleDriveFolderId}' in parents and mimeType='application/pdf'`,
      fields: 'files(id, name)',
    });

    return res.data.files;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function downloadFile(auth, fileId, filePath) {
    const drive = google.drive({ version: 'v3', auth });
    const dest = require('fs').createWriteStream(filePath);
  
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      res.data.pipe(dest);
      await new Promise((resolve, reject) => {
        dest.on('finish', resolve);
        dest.on('error', reject);
      });

      console.log(`Downloaded file to: ${filePath}`);
    } catch(err) {
        console.error("Error in downloadFile: ", err)
    }
  }


module.exports = { listVideoFiles, downloadFile, listPDFFiles };