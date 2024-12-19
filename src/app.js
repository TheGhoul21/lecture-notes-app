const { authorize } = require('./auth/google-auth');
const { listVideoFiles, downloadFile } = require('./drive/drive-utils');
const { extractAudio } = require('./transcription/audio-extraction');
const { transcribeAudio } = require('./transcription/transcription-service');
const { generateLatexFromTranscription, generateLatexFromAudio, refineSection, finalRefinement } = require('./gemini/gemini-service');
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

function extractLatex(text) {
  const startDelimiter = "```latex";
  const endDelimiter = "```";
  const startIndex = text.indexOf(startDelimiter);
  if (startIndex === -1) {
    return text;
  }
  const endIndex = Math.max(text.indexOf(endDelimiter, startIndex + startDelimiter.length), 0);
  // if (endIndex === -1) {
  //   return null;
  // }
  return text.substring(startIndex + startDelimiter.length, endIndex).trim();
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

  let newHeaders = [];


  for (const { index, section } of selectedSections) {
    const refinedSection = extractLatex(await refineSection(video.transcription, section));
    await showSectionPreview(section, refinedSection, index);

    if (refinedSection) {
      const headerMatch = refinedSection.match(/\\documentclass.*?\\begin{document}/s);
      if (headerMatch) {
         const newHeader = headerMatch[0];
        newHeaders.push(newHeader);
        }


      const trimmedRefined = refinedSection.replace(/\\documentclass.*?\\begin{document}/s, '').replace(/\\end{document}/, '').trim();
      const sectionRegex = new RegExp(`\\\\section\\{[^{}]*\\}${escapeRegex(section)}(?=\\\\section\\{|\\\\end{document}|$)`, 's');
      refinedLatex = refinedLatex.replace(sectionRegex, (match) => {
          return match.replace(section, trimmedRefined);
      });
    }
  }


  let finalHeaders = "";
  if (newHeaders.length > 0) {
    const existingHeaderMatch = refinedLatex.match(/\\documentclass.*?\\begin{document}/s);
    const existingHeader = existingHeaderMatch ? existingHeaderMatch[0] : "";
    const existingHeaderLines = existingHeader.split('\n').map(line => line.trim());


     const uniqueNewHeaderLines = newHeaders.join('\n').split('\n').map(line => line.trim()).filter(line => line !== "").filter(line => !existingHeaderLines.includes(line));

    finalHeaders = uniqueNewHeaderLines.join('\n');
    if (finalHeaders) {
      finalHeaders = finalHeaders + "\n";
    }

  }



  let finalLatex =  refinedLatex;
  if(finalHeaders){
       const existingHeaderMatch = finalLatex.match(/\\documentclass.*?\\begin{document}/s);
        if(existingHeaderMatch) {
          finalLatex = finalLatex.replace(existingHeaderMatch[0], finalHeaders);
        } else {
           finalLatex = finalHeaders + finalLatex;
        }
  }

  finalLatex = extractLatex(await finalRefinement(finalLatex));

  await addProcessedVideo(video.file_id, video.file_name, video.latex_output, video.transcription, finalLatex);

  console.log("Refinement process complete")
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

      await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(audioPaths), transcriptions.join('\n'), '');
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
      await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromTranscription(transcriptions.join('\n')), transcriptions.join('\n'), '');
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