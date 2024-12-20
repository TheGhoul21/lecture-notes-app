const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");


const fs = require('fs').promises;
const fs2 = require('fs');
const path = require('path');
const latex = require('node-latex')


const config = require('../utils/config');
const { SYSTEM_PROMPT_WITH_TRANSCRIPTIONS, SYSTEM_PROMPT_WITH_AUDIO, SECTION_REFINEMENT_PROMPT, FINAL_REFINEMENT_PROMPT } = require("./prompts");
const { LatexCompiler } = require("./latex");

const apiKey = config.geminiApiKey;
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * Uploads the given file to Gemini.
 *
 * See https://ai.google.dev/gemini-api/docs/prompting_with_media
 */
async function uploadToGemini(path, mimeType) {
  const uploadResult = await fileManager.uploadFile(path, {
    mimeType,
    displayName: path,
  });
  const file = uploadResult.file;
  console.log(`Uploaded file ${file.displayName} as: ${file.name}`);
  return file;
}


const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

async function generateTranscriptionFromAudio(audioPath) {

  const files = [await uploadToGemini(audioPath, 'audio/wav')];

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert lecture transcriber",
  });

  const textPart = {
    text: `
    Can you transcribe this lecture?
    Format the transcription as a series of complete, grammatically correct sentences.
    `,
  };
  const content = {
    role: "user",
    parts: [...files.map(file => ({
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.uri,
      },
    })), textPart]
  };

  const response = await model.generateContent({
    contents: [content],
    generationConfig
  })

  return await response.response.text();
}

async function generateLatexFromTranscription(transcription) {

  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206",
    systemInstruction: SYSTEM_PROMPT_WITH_TRANSCRIPTIONS,
  });
  const chatSession = model.startChat({
    generationConfig,
    history: [],
  });

  const result = await chatSession.sendMessage(transcription);
  return result.response.text();
}

async function generateLatexFromAudio(audioPaths) {

  const files = [];
  for (let path of audioPaths) {
    const file = await uploadToGemini(path, 'audio/wav');
    files.push(file);
  }
  const history = [{
    role: "user",
    parts: files.map(file => ({
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.uri,
      },
    }))
  }];


  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206",
    systemInstruction: SYSTEM_PROMPT_WITH_AUDIO,
  });
  const chatSession = model.startChat({
    generationConfig,
    history,
  });

  const responses = []
  const numberOfIterations = 3;

  let message = "Generate output"

  for (let i = 0; i < numberOfIterations; i++) {
    const result = await chatSession.sendMessage(message)
    message = "continue or just say ##STOP## if it's already completed";
    const text = result.response.text().trim()

    console.log(text.slice(text.length - 20))
    if (text.endsWith('STOP')) break;

    if (text.endsWith("\\end\{document\}\n```")) break;

    responses.push(text.replace("##STOP##", ""));
    if (text.includes("##STOP##")) break;
  }

  return responses.join('\n');
}


async function refineSection(originalTranscript, section) {
  const prompt = SECTION_REFINEMENT_PROMPT.replace(
    "{original_transcript}",
    originalTranscript
  );

  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206",
    systemInstruction: prompt,
  });
  const chatSession = model.startChat({
    generationConfig,
    history: [],
  });
  const result = await chatSession.sendMessage(`Original section:\n${section}\n\nProvide the refined LaTeX:\n`);
  return result.response.text();
}



async function compileLatex(latexDocument) {
  const tempDir = path.join(__dirname, '..', '..', 'temp');
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
      // console.log('PDF compiled successfully!');
      // console.log('PDF path:', result.pdfPath);
      return result.pdfPath
    } else {
      // console.error('PDF compilation failed!');
      // console.error('Errors:', result.errors);
      return result.errors.map(el => JSON.stringify(el)).join('\n')
    }

    console.log('Full Log:\n', result.log);
  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    await compiler.cleanup();
  }
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

async function finalRefinement(document) {
  const prompt = FINAL_REFINEMENT_PROMPT;
  console.log("Final refinement");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: prompt
  });

  const chatSession = model.startChat({
    generationConfig,
    history: [],
  });

  let currentDocument = document;
  const maxIterations = 100;
  let previousErrors = new Set();
  let messageToSend = currentDocument;

  let fixedDocument = extractLatex(currentDocument);
  let errorLog = await compileLatex(fixedDocument);

  for (let i = 0; i < maxIterations; i++) {
    if (i > 0) {
      console.log("Sending message", messageToSend, "to Gemini");
    }
    const result = await chatSession.sendMessage("Document: \n" + fixedDocument + "\nError Log:" + errorLog);
   fixedDocument = extractLatex(result.response.text());
    const compilationResult = await compileLatex(fixedDocument);
    errorLog = compilationResult;
    console.log(compilationResult)

    if (isPdf(compilationResult)) {
      console.log(`LaTeX document fixed after ${i + 1} iterations`);
      return fixedDocument;
    }
    if (isErrorString(compilationResult)) {
      const errorString = compilationResult;
      messageToSend = errorString;
      previousErrors.add(errorString);
      currentDocument = fixedDocument;
    } else {
      console.log("Unknown error during compilation");
      return currentDocument;
    }
  }
  console.log("Max iterations reached. Aborting");
  return currentDocument;
}

function isPdf(compilationResult) {
  return typeof compilationResult === 'string' && compilationResult.endsWith('.pdf');
}

function isErrorString(compilationResult) {
  return typeof compilationResult === 'string';
}





module.exports = { generateTranscriptionFromAudio, generateLatexFromTranscription, generateLatexFromAudio, refineSection, finalRefinement, extractLatex };