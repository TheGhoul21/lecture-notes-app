const { authorize } = require('./auth/google-auth');
const { listVideoFiles, downloadFile, listPDFFiles } = require('./drive/drive-utils');
const { extractAudio } = require('./transcription/audio-extraction');
const { transcribeAudio } = require('./transcription/transcription-service');
const { generateLatexFromTranscription, generateLatexFromAudio, refineSections, finalRefinement, extractLatex, convertLatexToMarkdown, generateScaffoldFromTranscription,processPdfWithGemini, uploadFileAndGetDetails,...geminiService } = require('./gemini/gemini-service');
const { addProcessedVideo, getProcessedVideos, getProcessedVideo, closeDB, getProcessedVideoByFileId } = require('./db/database');
const { selectVideoFiles, showProcessedVideos, showVideoDetails, groupFilesByDate, ...ui } = require('./ui');
const path = require('path');
const fs = require('fs').promises;
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

  let refinedLatex = extractLatex(video.refined || video.latex_output);
  const sections = splitTranscription(refinedLatex);
  const selectedSections = await selectSections(sections);

  return refineSelectedSections(video, selectedSections);

}


async function exportRefinedDocuments() {
  const { exportDir } = await require('inquirer').default.prompt({
    type: 'input',
    name: 'exportDir',
    message: 'Enter the directory to export refined documents:',
    validate: input => input.trim() !== '' || 'Directory path cannot be empty',
  });
  const os = require('node:os');

  // Handle relative paths and symbols like ~
  const resolvedExportDir = path.resolve(exportDir.replace(/^~(?=$|\/|\\)/, os.homedir()));

  try {
    await fs.mkdir(resolvedExportDir, { recursive: true });
    const processedVideos = await getProcessedVideos();

    for (const video of processedVideos) {
      if (video.refined) {
        const filePath = path.join(resolvedExportDir, `${video.file_name.replace(/\s+/g, '_')}.tex`);
        await fs.writeFile(filePath, video.refined);
        console.log(`Exported: ${filePath}`);
      }
    }

    console.log('All refined documents have been exported successfully.');
  } catch (err) {
    console.error('Error exporting refined documents:', err);
  }
}

async function generateReviewMaterials() {
  await ensureTempDir();
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos, 'Select a video to generate review materials');

  if (!selectedVideoId) return;

  const video = await getProcessedVideo(selectedVideoId);
  if (!video) {
    console.log("video not found");
    return;
  }

  const transcription = video.transcription;
  if (!transcription) {
    console.log("No transcription available for the selected video.");
    return;
  }

  const reviewGuide = await generateReviewGuide(transcription);
  const flashcards = await generateFlashcards(transcription);
  const questions = await generateQuestions(transcription);

  const reviewMaterials = {
    reviewGuide,
    flashcards,
    questions,
  };

  const reviewMaterialsPath = path.join(tempDir, `${video.file_name.replace(/\s+/g, '_')}_review_materials.json`);
  await fs.writeFile(reviewMaterialsPath, JSON.stringify(reviewMaterials, null, 2));
  console.log(`Review materials generated and saved to: ${reviewMaterialsPath}`);
}

async function generateReviewGuide(transcription) {
  // Implement logic to generate a review guide from the transcription
  return await geminiService.generateReviewGuide(transcription)
}

async function generateFlashcards(transcription) {
  // Implement logic to generate flashcards from the transcription
  return;
}

async function generateQuestions(transcription) {
  // Implement logic to generate questions from the transcription
  return [`Question 1 for transcription: ${transcription.substring(0, 50)}...`];
}




async function convertVideToMarkdown() {
  await ensureTempDir();
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos, 'Select a video to refine');

  if (!selectedVideoId) return;

  const video = await getProcessedVideo(selectedVideoId);
  if (!video) {
    console.log("video not found");
    return;
  }

  const markdown = await convertLatexToMarkdown(video.refined || extractLatex(video.latex_output))

  if (markdown) {
    await addProcessedVideo(video.file_id, video.file_name, video.latex_output, video.transcription, video.refined, markdown);
  }

}


async function refineSelectedSections(video, selectedSections, additionalFiles=[]) {
  let finalLatex = extractLatex(await refineSections(video.transcription, extractLatex(video.latex_output), selectedSections.map(({ section }) => section),false,additionalFiles));

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


async function processPdfs() {
  await ensureTempDir();
  const authClient = await authorize();
  const pdfFiles = await listPDFFiles(authClient);

  if (!pdfFiles || pdfFiles.length === 0) {
    console.log("No PDF files found in the specified folder");
    return;
  }

  const selectedPdfs = await selectVideoFiles(pdfFiles);

  for (const selectedGroup of selectedPdfs) {
    const date = selectedGroup[0].date;
    console.log(`Processing PDFs for date: ${date}`);
    console.log(`Number of PDFs to elaborate: ${selectedGroup.length}`);
    let lastPdf = null;
    const transcriptions = [];
    const additionalFiles = [];
    try {
      for (const pdf of selectedGroup) {
        console.log(`Processing PDF: ${pdf.name}`);
        lastPdf = pdf;
        const pdfPath = path.join(tempDir, `${pdf.id}.pdf`);
        try {
          await downloadFile(authClient, pdf.id, pdfPath);
          additionalFiles.push(await uploadFileAndGetDetails(pdfPath, 'application/pdf'))
          const transcription = await processPdfWithGemini(pdfPath);

          transcriptions.push(transcription);
          console.log(`Processed PDF: ${pdf.name}`);
        } catch (err) {
          console.error(`Error processing PDF ${pdf.name}`, err);
        }
      }


      console.log(`Number of transcriptions that will be used: ${transcriptions.length}`);
      const wholeTranscription = transcriptions.join('\n');
      const scaffold = await generateScaffoldFromTranscription(wholeTranscription);
      console.log(wholeTranscription, scaffold)
      const latexOutput = await generateLatexFromTranscription(wholeTranscription, scaffold, false, additionalFiles);
      console.log({latexOutput});
      await addProcessedVideo(lastPdf.id, lastPdf.name, latexOutput, wholeTranscription, '');

      const refinedLatex = extractLatex(latexOutput);
      const sections = splitTranscription(refinedLatex);
      const video = await getProcessedVideoByFileId(lastPdf.id);
      await refineSelectedSections(video, sections.map(section => ({ section })),additionalFiles);
    } catch (err) {
      console.error('Error processing PDFs:', err);
      continue;
    } finally {
      await cleanupTemp();
      await ensureTempDir();
    }
  }
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


  for (const selectedGroup of selectedVideos) {
    const date = selectedGroup[0].date
    console.log(`Processing videos for date: ${date}`);
    console.log(`Number of videos to elaborate: ${selectedGroup.length}`);
    let lastVideo = null;
    let videoId;
    const transcriptions = [];
    try {
      switch (format) {
        case 'audio':
          videoId = await processAudioVideos(authClient, selectedGroup, transcriptions);
          break;
        case 'video':
          videoId = await processVideoVideos(authClient, selectedGroup, transcriptions);
          break;
        case 'transcript':
          videoId = await processTranscriptVideos(authClient, selectedGroup, transcriptions);
          break;
        default:
          throw new Error(`format "${format}" not supported`);
      }

      const video = await getProcessedVideo(videoId);
      const refinedLatex = extractLatex(video.latex_output);
      const sections = splitTranscription(refinedLatex);
      await refineSelectedSections(video, sections.map(section => ({ section })));
    } catch (err) {
      console.error('Error processing videos:', err);
      continue;
    } finally {
      await cleanupTemp();
      await ensureTempDir();
    }
  }
  // const selectedVideos = await selectVideoFiles(videos);
  // const selectedVideosGroupedByKeys = groupFilesByDate(selectedVideos);
  // const keysSorted = Object.keys(selectedVideosGroupedByKeys).sort();

  // for (const key of keysSorted) {
  //   const selectedVideos = selectedVideosGroupedByKeys[key];
  //   selectedVideos.sort((a, b) => a.name.localeCompare(b.name));
  //   console.log(`Number of videos to elaborate: ${selectedVideos.length}`);

  //   let lastVideo = null;
  //   let videoId;
  //   const transcriptions = [];
  //   try {
  //     switch (format) {
  //       case 'audio':
  //         videoId = await processAudioVideos(authClient, selectedVideos, transcriptions);
  //         break;
  //       case 'video':
  //         videoId = await processVideoVideos(authClient, selectedVideos, transcriptions);
  //         break;
  //       case 'transcript':
  //         videoId = await processTranscriptVideos(authClient, selectedVideos, transcriptions);
  //         break;
  //       default:
  //         throw new Error(`format "${format}" not supported`);
  //     }

  //     const video = await getProcessedVideo(videoId);
  //     const refinedLatex = extractLatex(video.latex_output);
  //     const sections = splitTranscription(refinedLatex);
  //     await refineSelectedSections(video, sections.map(section => ({ section })));
  //   } catch (err) {
  //     console.error('Error processing videos:', err);
  //     continue;
  //   } finally {
  //     await cleanupTemp();
  //     await ensureTempDir();
  //   }
  // }
}

async function processAudioVideos(authClient, selectedVideos, transcriptions) {
  const audioPaths = [];
  let lastVideo = null;

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

  console.log(`Number of audios that will be used: ${audioPaths.length}`);
  return await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(audioPaths), transcriptions.join('\n'), '');
}

async function processVideoVideos(authClient, selectedVideos, transcriptions) {
  const videoPaths = [];
  let lastVideo = null;

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

  console.log(`Number of videos that will be used: ${videoPaths.length}`);
  return await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromAudio(videoPaths, 'video/mp4'), transcriptions.join('\n'), '');
}

async function processTranscriptVideos(authClient, selectedVideos, transcriptions) {
  let lastVideo = null;

  for (const video of selectedVideos) {
    console.log(`Processing video: ${video.name}`);
    lastVideo = video;
    const videoPath = path.join(tempDir, `${video.id}_video.mp4`);
    const audioPath = path.join(tempDir, `${video.id}_audio.wav`);

    try {
      await downloadFile(authClient, video.id, videoPath);
      await extractAudio(videoPath, audioPath);
      const transcription = await transcribeAudio(audioPath);
      transcriptions.push(transcription);
      console.log(`Processed video: ${video.name}`);
    } catch (err) {
      console.error(`Error processing video ${video.name}`, err);
    }
  }

  console.log(`Number of transcriptions that will be used: ${transcriptions.length}`);
  const wholeTranscription = transcriptions.join('\n')
  console.log(`Generating scaffold`)
  const scaffold = await generateScaffoldFromTranscription(wholeTranscription);
  console.log(`Generating document`)
  return await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromTranscription(wholeTranscription, scaffold), transcriptions.join('\n'), '');
}

async function manualInsert() {
  const { fileName, transcription, additionalFields } = await require('inquirer').default.prompt([
    {
      type: 'input',
      name: 'fileName',
      message: 'Enter the filename:',
      validate: input => input.trim() !== '' || 'Filename cannot be empty',
    },
    {
      type: 'input',
      name: 'transcription',
      message: 'Enter the transcription:',
      validate: input => input.trim() !== '' || 'Transcription cannot be empty',
    },
    {
      type: 'input',
      name: 'additionalFields',
      message: 'Enter any additional fields (optional):',
    },
  ]);

  const latexOutput = await generateLatexFromTranscription(transcription);
  await addProcessedVideo(null, fileName, latexOutput, transcription, '', additionalFields);

  console.log('Manual insert completed and processed.');
}

async function addAllDocumentsToVectorStore() {
  const processedVideos = await getProcessedVideos();

  for (const video of processedVideos) {
    console.log("processing transcription")
    const transcription = video.transcription;
    if (transcription) {
      await splitAndCreateEmbeddings(transcription, { file_name: video.file_name });
    }
  }
}


async function processPdf(pdfPath) {

  const wholeTranscription = await processPdfWithGemini(pdfPath);




  const scaffold = await generateScaffoldFromTranscription(wholeTranscription);
  console.log(`Generating document`)
  await addProcessedVideo(lastVideo.id, lastVideo.name, await generateLatexFromTranscription(wholeTranscription, scaffold), wholeTranscription, '');

  refin


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

async function chatWithLesson() {
  const processedVideos = await getProcessedVideos();
  const selectedVideoId = await showProcessedVideos(processedVideos);

  const selectedVideo = await getProcessedVideo(selectedVideoId);
  await ui.chatWithLesson(selectedVideo);
}

async function chatWithCourse() {

  console.log("doesDBExist", await doesDBExist())
  if (!await doesDBExist()) {
    await addAllDocumentsToVectorStore();
  }


  await ui.chatWithCourse();
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
          { name: 'Process PDF files', value: 'process_pdf' },
          { name: 'Process new videos (audio)', value: 'process_audio' },
          { name: 'Process new videos (video)', value: 'process_video' },
          { name: 'Refine a processed video', value: 'refine' },
          { name: 'Convert to markdown a processed video', value: 'markdown' },
          { name: 'Compile refined', value: 'compile' },
          { name: 'Export all', value: 'export-all' },
          { name: 'Chat with a lesson', value: 'chat' },
          { name: 'Chat with the course', value: 'chat-course' },
          { name: 'View processed videos', value: 'view' },
          { name: 'Manual insert', value: 'manual' },
          { name: 'Exit', value: 'exit' },
        ],
      });

      switch (action) {
        case 'process_transcript':
          await processVideos('transcript');
          break;
        case 'process_pdf':
          await processPdfs();
          break;
        case 'process_audio':
          await processVideos('audio');
          break;
        case 'process_video':
          await processVideos('video');
          break;
        case 'refine':
          await refineProcessedVideo();
          break;
        case 'export-all':
          await exportRefinedDocuments();
          break;
        case 'manual':
          await manualInsert();
          break;
        case 'chat':
          await chatWithLesson();
          break;
        // case 'chat-course':
        //   await chatWithCourse();
        //   break;
        case 'markdown':
          await convertVideToMarkdown();
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