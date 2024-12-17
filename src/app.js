const { authorize } = require('./auth/google-auth');
const { listVideoFiles, downloadFile } = require('./drive/drive-utils');
const { extractAudio } = require('./transcription/audio-extraction');
const { transcribeAudio } = require('./transcription/transcription-service');
const { generateLatexFromTranscription, generateLatexFromAudio } = require('./gemini/gemini-service');
const { addProcessedVideo, getProcessedVideos, getProcessedVideo, closeDB } = require('./db/database');
const { selectVideoFiles, showProcessedVideos, showVideoDetails } = require('./ui');
const path = require('path');
const fs = require('fs').promises;

const GENERATION_FORMAT = 'audio';

const tempDir = path.join(__dirname, '..', 'temp');

async function cleanupTemp() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (e) {
    console.warn("Error during cleanup", e);
  }
}


async function ensureTempDir() {
  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (err) {
    console.error("Error creating temp dir", err);
  }
}

async function processVideos(format='audio') {
  await ensureTempDir();
  const authClient = await authorize();
  const videos = await listVideoFiles(authClient);

  if (!videos || videos.length === 0) {
    console.log("No videos found in the specified folder");
    return;
  }

  const selectedVideos = await selectVideoFiles(videos);
  selectedVideos.sort((a, b) => {
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  });
  console.log(`Number of videos to elaborate: ${selectedVideos.length}`)
  // const selectedVideos = ['/Users/lucasimonetti/Downloads/Nuova riunione del canale-20241001_164246-Registrazione della riunione.mp4']

  const transcriptions = []
  let lastVideo = null

  switch (format) {
    case 'audio':
      const audioPaths = []
      for (const video of selectedVideos) {
        console.log(`Processing video: ${video.name}`);
        lastVideo = video;
        const videoPath = path.join(tempDir, `${video.id}_video.mp4`);
        const audioPath = path.join(tempDir, `${video.id}_audio.wav`);
        try {
          await downloadFile(authClient, video.id, videoPath);
          await extractAudio(videoPath, audioPath);
          audioPaths.push(audioPath);
          console.log(`Processed video: ${video.name}`);

        } catch (err) {
          console.error(`Error processing video ${video.name}`, err);
        }
      }
      console.log(`Number of audios that wil be used ${audioPaths.length}`)

      await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(audioPaths), transcriptions.join('\n'));
      break;
    case 'transcript':
      for (const video of selectedVideos) {
        console.log(`Processing video: ${video.name}`);
        lastVideo = video;
        const videoPath = path.join(tempDir, `${video.id}_video.mp4`);
        const audioPath = path.join(tempDir, `${video.id}_audio.wav`);
        try {
          await downloadFile(authClient, video.id, videoPath);
          await extractAudio(videoPath, audioPath);
          const transcription = await transcribeAudio(audioPath);
          transcriptions.push(transcription)

          console.log(`Processed video: ${video.name}`);

        } catch (err) {
          console.error(`Error processing video ${video.name}`, err);
        }
      }

      console.log(`Number of transcription that wil be used ${transcriptions.length}`)
      await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromTranscription(transcriptions.join('\n')), transcriptions.join('\n'));
      break;
    default: throw new Error("format \"" + format + "\" not supported");
  }
}


async function viewProcessedVideos() {
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos)
  if (selectedVideoId) {
    const video = await getProcessedVideo(selectedVideoId);
    if (video) {
      await showVideoDetails(video);
    }
  }
}


async function main() {
  try {
    let continueProcessing = true;


    while (continueProcessing) {
      const { action } = await require('inquirer').default.prompt({
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Process new videos (transcript)', value: 'process_transcript' },
          { name: 'Process new videos (audio)', value: 'process_audio' },
          { name: 'View processed videos', value: 'view' },
          { name: 'Exit', value: 'exit' },
        ],
      });

      switch (action) {
        case 'process_transcript':
          await processVideos('transcript');
          break;
          case 'process_audio':
            await processVideos('audio');
            break;
  
        case 'view':
          await viewProcessedVideos();
          break;

        case 'exit':
          continueProcessing = false;
          break;
      }
    }

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await cleanupTemp();
    closeDB();
  }
}

main();