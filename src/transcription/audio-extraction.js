const ffmpeg = require('fluent-ffmpeg');
const path = require('path');


async function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .noVideo()
      .format('wav')
      .on('end', () => {
        console.log('Audio extraction complete.');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error during audio extraction:', err);
        reject(err);
      })
      .run();
  });
}


module.exports = { extractAudio };