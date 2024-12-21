const { authorize } = require('./auth/google-auth');
const { listVideoFiles, downloadFile } = require('./drive/drive-utils');
const { extractAudio } = require('./transcription/audio-extraction');
const { transcribeAudio } = require('./transcription/transcription-service');
const { generateLatexFromTranscription, generateLatexFromAudio, refineSection,refineSections, finalRefinement, extractLatex } = require('./gemini/gemini-service');
const { addProcessedVideo, getProcessedVideos, getProcessedVideo, closeDB, getProcessedVideoByFileId } = require('./db/database');
const { selectVideoFiles, showProcessedVideos, showVideoDetails } = require('./ui');
const path = require('path');
const fs = require('fs').promises;

const fs2 = require('fs');
const latex = require('node-latex');
const { LatexCompiler } = require('./gemini/latex');


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

async function selectSections(sections) {
  const choices = sections.map((section, index) => ({
    name: `Section ${index + 1}: ${section.trim().substring(0, 50)}...`,
    value: index,
  }));

  const { selectedSections } = await require('inquirer').default.prompt({
    type: 'checkbox',
    message: 'Select sections to refine (press space to select, enter to confirm)',
    name: 'selectedSections',
    choices,
    pageSize: 10,
  });

  return selectedSections.map((index) => ({ index, section: sections[index] }));
}

// src/app.js

function splitTranscription(transcription) {
  const preambleRegex = /\\documentclass.*?\\begin{document}/s;
  const preambleMatch = transcription.match(preambleRegex);
  let content = transcription;
  if (preambleMatch) {
    content = transcription.substring(preambleMatch[0].length);
  }


  const endDocumentIndex = content.indexOf("\\end{document}");
  if (endDocumentIndex !== -1) {
    content = content.substring(0, endDocumentIndex);
  }


  const sectionRegex = /(\\section\{[^{}]*\}[\s\S]*?)(?=\\section\{|\s*\\end{document}|$)/g;

  const sections = [];
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push(match[1].trim());
  }

  return sections.filter(section => section.trim() !== '');
}

async function refineProcessedVideo() {
  await ensureTempDir();
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos, 'Select a video to refine');

  if (!selectedVideoId) return;

  const video = await getProcessedVideo(selectedVideoId);
  if (!video) {
    console.log("video not found");
    return;
  }

  let refinedLatex = extractLatex(video.latex_output);
  const sections = splitTranscription(refinedLatex);
  const selectedSections = await selectSections(sections);

  return refineSelectedSections(video, selectedSections);
 
}


async function refineSelectedSections(video, selectedSections) {
  let finalLatex = extractLatex(await refineSections(video.transcription,extractLatex(video.latex_output), selectedSections.map(({section}) => section)));

  await addProcessedVideo(video.file_id, video.file_name, video.latex_output, video.transcription, finalLatex);

  finalLatex = extractLatex(await finalRefinement(finalLatex));

  await addProcessedVideo(video.file_id, video.file_name, video.latex_output, video.transcription, finalLatex);

  console.log("Refinement process complete")
}


async function compileRefinedProcessedVideo() {
  await ensureTempDir();
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos, 'Select a video to refine');

  if (!selectedVideoId) return;

  const video = await getProcessedVideo(selectedVideoId);
  if (!video) {
    console.log("video not found");
    return;
  }


  await compileLatex(video.refined);


  console.log("")
}


async function compileLatex(latexDocument) {
  const tempDir = path.join(__dirname, '..', 'temp');
  const texFilePath = path.join(tempDir, 'temp.tex');

  try {
    await fs.writeFile(texFilePath, latexDocument)
  } catch (err) {

  }
  const compiler = new LatexCompiler({
    // latexCommand: 'xelatex', // If you want to use xelatex
    maxRuns: 4
  });

  try {
    const result = await compiler.compile(texFilePath); // Replace with your LaTeX file path

    if (result.success) {
      console.log('PDF compiled successfully!');
      console.log('PDF path:', result.pdfPath);
      return result.pdfPath
    } else {
      console.error('PDF compilation failed!');
      console.error('Errors:', result.errors);
      return result.errors.map(el => JSON.stringify(el)).join('\n')
    }

    console.log('Full Log:\n', result.log);
  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await compiler.cleanup();
  }
}


function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function processVideos(format = 'audio') {
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

  let videoId;

  switch (format) {
    case 'audio1':
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

      videoId = await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(audioPaths), transcriptions.join('\n'), '');
      break;

      case 'video':
      const videoPaths = []
      for (const video of selectedVideos) {
        console.log(`Processing video: ${video.name}`);
        lastVideo = video;
        const videoPath = path.join(tempDir, `${video.id}_video.mp4`);
        try {
          await downloadFile(authClient, video.id, videoPath);
          videoPaths.push(videoPath);
          console.log(`Processed video: ${video.name}`);

        } catch (err) {
          console.error(`Error processing video ${video.name}`, err);
        }
      }
      console.log(`Number of videos that wil be used ${videoPaths.length}`)

      videoId = await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(videoPaths), transcriptions.join('\n'), '');
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
      videoId = await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromTranscription(transcriptions.join('\n')), transcriptions.join('\n'), '');
      break;
    default: throw new Error("format \"" + format + "\" not supported");
  }

  const video = await getProcessedVideoByFileId(lastVideo.id);
  
  let refinedLatex = extractLatex(video.latex_output);
  const sections = splitTranscription(refinedLatex);

  console.log(sections.length);
  

  return await refineSelectedSections(video, sections.map(section => ({section})))
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

async function showSectionPreview(originalSection, refinedSection, index) {
  import('chalk').then(async ({ default: chalk }) => {
    index && console.log(chalk.blue(`\n--- Section ${index + 1} Preview ---`));
    console.log(chalk.green(`\nOriginal Section:\n`));
    console.log(originalSection);

    if (refinedSection) {
      console.log(chalk.blue('\nRefined Section:'));
      console.log(chalk.yellow(refinedSection));
    } else {
      console.log(chalk.yellow('\nNo refinement available for this section yet.'));
    }
  });
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
          { name: 'Refine a processed video', value: 'refine' },
          { name: 'Compile refined', value: 'compile' },
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
        case 'refine':
          await refineProcessedVideo();
          break;

        case 'compile':
          await compileRefinedProcessedVideo();
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