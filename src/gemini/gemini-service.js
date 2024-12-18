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
    model: "gemini-2.0-flash-exp",
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
  for (path of audioPaths) {
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


  return new Promise(async (resolve, error) => {

    const tempDir = path.join(__dirname, '..', '..', 'temp');
    const texFilePath = path.join(tempDir, 'temp.tex');
    const pdfFilePath = path.join(tempDir, 'output.pdf');

    try {
      await fs.writeFile(texFilePath, latexDocument);
    } catch (err) {
      console.error("Error writing temp latex file", err);
      return null;
    }


    const input = fs2.createReadStream(texFilePath)
    const output = fs2.createWriteStream(pdfFilePath)
    const pdf = latex(input)

    pdf.on('error', err => {
      if (err.message.includes('LaTeX Syntax Error'))
        resolve(err.message);
    })
    pdf.on('finish', () => {
      console.log('PDF generated!')
      resolve(pdfFilePath);
    })

    pdf.pipe(output)

  })








  // try {
  //   const pdf = await pdflatex(latexDocument, {});
  //   await fs.writeFile(pdfFilePath, pdf);
  //   return pdfFilePath;
  // } catch (error) {
  //   console.error(JSON.stringify(error));
  //   console.error('LaTeX compilation error:', error);
  //   return error;
  // } finally{
  //    try {
  //       await fs.unlink(texFilePath);
  //   } catch (e) {
  //       console.warn("Error unlinking file", e);
  //   }
  // }
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
  const maxIterations = 10;
  let previousErrors = new Set();
  let messageToSend = currentDocument;

  const fixedDocument = extractLatex(currentDocument);
  await compileLatex(fixedDocument);


  for (let i = 0; i < maxIterations; i++) {
    if (i > 0) {
      console.log("Sending message", messageToSend, "to Gemini");
    }
    const result = await chatSession.sendMessage(messageToSend);
    const fixedDocument = extractLatex(result.response.text());
    console.log(fixedDocument);
    const compilationResult = await compileLatex(fixedDocument);

    if (typeof compilationResult === 'string' && compilationResult.endsWith('.pdf')) {
      console.log(`LaTeX document fixed after ${i + 1} iterations`);
      return fixedDocument;
    }
    if (typeof compilationResult == 'string') {
      const errorString = compilationResult;
      messageToSend = errorString;
      if (previousErrors.has(errorString)) {
        console.log(`Same error detected after ${i + 1} iterations. Aborting`);
        return currentDocument;
      }
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





module.exports = { generateTranscriptionFromAudio, generateLatexFromTranscription, generateLatexFromAudio, refineSection, finalRefinement, extractLatex };