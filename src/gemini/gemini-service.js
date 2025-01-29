const { GoogleGenerativeAI} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");


const fs = require('fs').promises;
const fs2 = require('fs');
const path = require('path');
const latex = require('node-latex')

const USE_MARKDOWN = false;
const config = require('../utils/config');
const { SYSTEM_PROMPT_WITH_TRANSCRIPTIONS,
  SYSTEM_PROMPT_WITH_TRANSCRIPTIONS_MARKDOWN, SYSTEM_PROMPT_WITH_AUDIO, SECTION_REFINEMENT_PROMPT,
  FINAL_REFINEMENT_PROMPT_MARKDOWN, SECTION_REFINEMENT_PROMPT_MARKDOWN,
  FINAL_REFINEMENT_PROMPT, FINAL_DOCUMENT_MESSAGE,
  CHAT_WITH_TEACHER_PROMPT,
  CHAT_WITH_COURSE_PROMPT,
  DEFINE_SCAFFOLD_WITH_TRANSCRIPT,
  HANDWRITTEN_NOTES_TO_TRANSCRIPT,
  FILL_IN_GAPS_IN_TRANSCRIPT, 
  DEFINE_SCAFFOLD_WITH_TRANSCRIPT_MARKDOWN} = require("./prompts");
const { LatexCompiler } = require("./latex");
const { exec } = require('child_process');
// const { queryVectorStore } = require("../rag/rag-service");

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
  temperature: 0,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

async function splitAudioIntoChunks(audioPath, chunkDuration = 600) {
  const outputDir = path.join(path.dirname(audioPath), 'chunks');
  await fs.mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    exec(`ffmpeg -i ${audioPath} -f segment -segment_time ${chunkDuration} -c copy ${outputDir}/chunk_%03d.wav`, (error, stdout, stderr) => {
      if (error) {
        reject(`Error splitting audio: ${stderr}`);
      } else {
        resolve(outputDir);
      }
    });
  });
}

async function generateTranscriptionFromAudio(audioPath) {
  const chunkDir = await splitAudioIntoChunks(audioPath);
  const chunkFiles = await fs.readdir(chunkDir);
  const transcriptions = [];

  for (const chunkFile of chunkFiles) {
    const chunkPath = path.join(chunkDir, chunkFile);
    const transcription = await generateTranscriptionFromAudioChunk(chunkPath);
    transcriptions.push(transcription);
  }

  return transcriptions.join(' ');
}
async function generateTranscriptionFromAudioChunk(audioPath) {


  const files = [await uploadToGemini(audioPath, 'audio/wav')];

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert lecture transcriber",
    generationConfig: { temperature: 0 }
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

async function uploadFileAndGetDetails(filePath, mimeType) {
  const file = await uploadToGemini(filePath, mimeType);
  return {
    mimeType: file.mimeType,
    uri: file.uri,
  };
}

async function generateLatexFromTranscription(transcription, scaffold, markdown = USE_MARKDOWN, additionalFiles=[]) {

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-thinking-exp-01-21",
    systemInstruction: markdown ? SYSTEM_PROMPT_WITH_TRANSCRIPTIONS_MARKDOWN : SYSTEM_PROMPT_WITH_TRANSCRIPTIONS,
  });
  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  // const result = await chatSession.sendMessage();
  let message = `Scaffold:\n${scaffold}\n\n\nTranscription:\n${transcription}`;
  const responses = [];

  const numberOfIterations = 5;

  for (let i = 0; i < numberOfIterations; i++) {
    const result = await chatSession.sendMessage([
      {text:message},
      ...additionalFiles.map(file => ({
        fileData: {
        mimeType: file.mimeType,
        fileUri: file.uri,
        },
      }))
    ])
    message = "continue or just say ##STOP## if it's already completed";
    const text = result.response.text().trim()
    responses.push(text.replace("##STOP##", ""));

    console.log("\n\n\nTEXT:\n", text)

    console.log(text.slice(text.length - 20))
    if (text.endsWith('STOP')) break;

    if (text.includes("\\end\{document\}\n```")) break;

    // responses.push(text.replace("##STOP##", ""));
    if (text.includes("##STOP##")) break;
  }


  return responses.join('\n');
}

async function generateLatexFromAudio(audioPaths, mimeType = 'audio/wav') {

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
    model: "gemini-2.0-flash-thinking-exp-01-21",
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

async function getChatSessionForRefinement(transcription, document, markdown = USE_MARKDOWN) {
  const prompt = (markdown ? SECTION_REFINEMENT_PROMPT_MARKDOWN : SECTION_REFINEMENT_PROMPT).replace(
    "{original_transcript}",
    transcription
  ).replace(
    "{original_document}",
    document
  );

  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206",//"gemini-2.0-flash-thinking-exp-01-21",
    systemInstruction: prompt,
  });
  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.2 },
    history: [],
  });

  return chatSession

}


async function generateScaffoldFromTranscription(transcription, markdown=USE_MARKDOWN) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: markdown?DEFINE_SCAFFOLD_WITH_TRANSCRIPT_MARKDOWN:DEFINE_SCAFFOLD_WITH_TRANSCRIPT,
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.2 },
    history: [],
  });


  await chatSession.sendMessage(transcription);
  await chatSession.sendMessage('Now double check your work and output a refined and corrected version');
  const result = await chatSession.sendMessage('Now do a final check of your work and output the final and corrected version');

  return result.response.text();
}

async function changeChatSessionModel(chatSession, newModel = 'gemini-2.0-flash-thinking-exp-01-21') {
  const params = chatSession.params;
  const model = genAI.getGenerativeModel({
    model: newModel,
    systemInstruction: params.systemInstruction,
  });
  return model.startChat(params);
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
}

async function retryWithExponentialBackoff(fn, maxRetries = 5) {
  let retries = 0;
  let delay = 1000; // Initial delay in milliseconds

  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      console.error(error);
      if (error.response && error.response.status === 429) {
        retries++;
        console.log(`Retrying after ${delay}ms... (${retries}/${maxRetries})`);
        await sleep(delay);
        delay *= 2 ** retries; // Exponential backoff
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} retries`);
}
async function refineSection(chatSession, section,additionalFiles=[]) {
  console.log("Refining", section.split("\n")[0], "with", chatSession.model);
  const result = await retryWithExponentialBackoff(async () => chatSession.sendMessage([{text:`${section}`},...additionalFiles.map(file => ({
    fileData: {
    mimeType: file.mimeType,
    fileUri: file.uri,
    },
  }))]))
  return result.response.text();
}

async function refineSections(originalTranscript, originalDocument, sections, markdown = USE_MARKDOWN, additionalFiles=[]) {
  const chatSession = await getChatSessionForRefinement(originalTranscript, originalDocument);

  for (let section of sections) {
    await refineSection(chatSession, section, additionalFiles);
    await sleep(3000);
  }

  const finalResponse = await refineSection(await /*changeChatSessionModel(chatSession, 'gemini-2.0-flash-thinking-exp-01-21')*/chatSession, FINAL_DOCUMENT_MESSAGE);

  let refinedDocument = (markdown ? extractMarkdown: extractLatex)(finalResponse);

  const MAX_TRIES = 5;
  let current = 1;
  if (!markdown) {

    while (!refinedDocument.includes("\\end{document}")) {
      const continuationResponse = await refineSection(chatSession, "continue exactly from where you stopped and complete the response");
      console.log(continuationResponse);
      refinedDocument += (markdown ? extractMarkdown: extractLatex)(continuationResponse);

      current++;
      if (current == MAX_TRIES) {
        break;
      }
    }
  } 

  return refinedDocument
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
  const endIndex = Math.max(text.lastIndexOf(endDelimiter, startIndex + startDelimiter.length), text.length);
  // if (endIndex === -1) {
  //   return null;
  // }
  return text.substring(startIndex + startDelimiter.length, endIndex).trim();
}

function extractMarkdown(text) {
  const startDelimiter = "```markdown";
  const endDelimiter = "```";
  const startIndex = text.indexOf(startDelimiter);
  if (startIndex === -1) {
    return text;
  }
  const endIndex = Math.max(text.lastIndexOf(endDelimiter, startIndex + startDelimiter.length), text.length);
  // if (endIndex === -1) {
  //   return null;
  // }
  return text.substring(startIndex + startDelimiter.length, endIndex).trim();
}

async function finalRefinement(document, markdown = USE_MARKDOWN) {
  const prompt = markdown ? FINAL_REFINEMENT_PROMPT_MARKDOWN : FINAL_REFINEMENT_PROMPT;
  console.log("Final refinement");

  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206", // model: "gemini-2.0-flash-thinking-exp-01-21",
    systemInstruction: prompt
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.2 },
    history: [],
  });

  const result = await chatSession.sendMessage(document)
  const finalResponse = result.response.text();

  let refinedDocument = (markdown ? extractMarkdown: extractLatex)(finalResponse);

  const MAX_TRIES = 5;
  let current = 1;

  if (!markdown) {
    while (!refinedDocument.includes("\\end{document}")) {
      const continuationResponse = await refineSection(chatSession, "continue exactly from where you stopped and complete the response");
      console.log(continuationResponse);
      refinedDocument += (markdown ? extractMarkdown: extractLatex)(continuationResponse);

      current++;
      if (current == MAX_TRIES) {
        break;
      }
    }
  } else {
    while (!refinedDocument.includes("END_OF_DOCUMENT")) {
      const continuationResponse = await refineSection(chatSession, "continue exactly from where you stopped and complete the response. When finished, add END_OF_DOCUMENT on a new line");
      refinedDocument += (markdown ? extractMarkdown: extractLatex)(continuationResponse);
      current++;
      if (current == MAX_TRIES) break;
    }
  }
  return refinedDocument;
}

async function convertLatexToMarkdown(latexDocument) {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert in converting latex documents to markdown. When the conversion is complete you write OK. Create a table of contents for each document and place it right under the title",
  });

  const generationConfig = {
    temperature: 0,
    topP: 0.95,
    // topK: 64,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
  };


  const chatSession = model.startChat({
    generationConfig,
    history: [

    ],
  });

  const result = await chatSession.sendMessage(latexDocument);

  let text = result.response.text().trim();
  let markdown = extractMarkdown(text);

  while (!text.endsWith('OK')) {

    const result = await chatSession.sendMessage("if it's complete write OK otherwise continue exactly from where you stopped");
    text = result.response.text().trim();
    markdown += extractMarkdown(text);
  }


  return extractMarkdown(markdown).replace(/```\s+OK\s*$/, '').replace(/\s+OK\s*$/, '');


}

async function startChatSessionWithLesson(transcription) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: CHAT_WITH_TEACHER_PROMPT,
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  await chatSession.sendMessage(transcription);
  return chatSession;
}

async function chatWithTranscription(chatSession, message) {
  const result = await chatSession.sendMessage(message);
  return result.response.text();
}

async function startChatSessionWithCourse(context) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: CHAT_WITH_COURSE_PROMPT.replace('{context}', context),
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });


  return chatSession;
}

async function updateChatSessionWithContext(chatSession, newContext) {
  const updatedPrompt = CHAT_WITH_COURSE_PROMPT.replace('{context}', newContext);
  const model = genAI.getGenerativeModel({
    model: chatSession.model,
    systemInstruction: updatedPrompt,
  });

  const updatedChatSession = model.startChat({
    generationConfig: chatSession.params.generationConfig,
    history: chatSession.history,
  });

  return updatedChatSession;
}

async function chatWithSession(chatSession, message) {
  const newContext = await queryVectorStore(message, 5);

  const result = await (await updateChatSessionWithContext(chatSession, newContext)).sendMessage(message);
  return result.response.text();
}

async function generateReviewGuide(transcription) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert in creating review guides from lecture transcriptions.",
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  const result = await chatSession.sendMessage(transcription);
  return result.response.text();
}

async function generateFlashcards(transcription) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert in creating flashcards from lecture transcriptions.",
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  const result = await chatSession.sendMessage(transcription);
  return result.response.text();
}

async function generateQuestions(transcription) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: "You are an expert in generating questions from lecture transcriptions.",
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  const result = await chatSession.sendMessage(transcription);
  return result.response.text();
}



async function processPdfWithGemini(pdfPath) {
  await sleep(1000);

  const initialTranscription = await callGeminiFlash(pdfPath, HANDWRITTEN_NOTES_TO_TRANSCRIPT, 0);
  console.log({initialTranscription})

  let refinedTranscription = initialTranscription;
  const originalPdfFile = await uploadToGemini(pdfPath, 'application/pdf');
  for (let i = 0; i < 3; i++) { // Limit iterations to avoid infinite loop
    const newTranscription = (await callGeminiFlash(
      [
        {
          fileData: {
            mimeType: originalPdfFile.mimeType,
            fileUri: originalPdfFile.uri,
          },
        },
        {
          text: refinedTranscription,
        },
      ],
      FILL_IN_GAPS_IN_TRANSCRIPT,
      0,
      'gemini-2.0-flash-thinking-exp-01-21'
    )).replaceAll(']', '').replaceAll('[', '').replaceAll("\n\n","\n").replaceAll("\n", " ");
    // const newTranscription = await callGeminiFlash(refinedTranscription, FILL_IN_GAPS_IN_TRANSCRIPT, 0);
    console.log('New length of transcription', newTranscription.length, "was", refinedTranscription.length, newTranscription.includes(']'))
    console.log({newTranscription})
    refinedTranscription = newTranscription;
    await sleep(1000);
  }

  return refinedTranscription.replace(']', '').replace('[', '');
}

async function callGeminiFlash(input, systemPrompt, temperature, modelName = "gemini-2.0-flash-exp") {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature },
    history: [],
  });

  const result = await chatSession.sendMessage(input);
  return result.response.text();
}

module.exports = {
  generateTranscriptionFromAudio,
  generateLatexFromTranscription,
  generateLatexFromAudio,
  refineSection,
  refineSections,
  finalRefinement,
  extractLatex,
  extractMarkdown,
  convertLatexToMarkdown,
  startChatSessionWithLesson,
  startChatSessionWithCourse,
  chatWithSession,
  chatWithTranscription,
  generateFlashcards, generateQuestions, generateReviewGuide,
  generateScaffoldFromTranscription,
  processPdfWithGemini,
  uploadFileAndGetDetails,
  USE_MARKDOWN,
  sleep
};