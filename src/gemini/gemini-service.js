const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  ChatSession,
} = require("@google/generative-ai");
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
  FINAL_REFINEMENT_PROMPT, FINAL_DOCUMENT_MESSAGE } = require("./prompts");
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
  temperature: 0,
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

async function generateLatexFromTranscription(transcription, markdown = USE_MARKDOWN) {

  const model = genAI.getGenerativeModel({
    model: "gemini-exp-1206",
    systemInstruction: markdown ? SYSTEM_PROMPT_WITH_TRANSCRIPTIONS_MARKDOWN : SYSTEM_PROMPT_WITH_TRANSCRIPTIONS,
  });
  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
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

async function getChatSessionForRefinement(transcription, document, markdown = USE_MARKDOWN) {
  const prompt = (markdown ? SECTION_REFINEMENT_PROMPT_MARKDOWN : SECTION_REFINEMENT_PROMPT).replace(
    "{original_transcript}",
    transcription
  ).replace(
    "{original_document}",
    document
  );

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    systemInstruction: prompt,
  });
  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.4 },
    history: [],
  });

  return chatSession

}

async function changeChatSessionModel(chatSession, newModel = 'gemini-exp-1206') {
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


async function refineSection(chatSession, section) {
  await sleep(1000);
  console.log("Refining", section.split("\n")[0], "with", chatSession.model);
  const result = await chatSession.sendMessage(`${section}`)
  return result.response.text();
}

async function refineSections(originalTranscript, originalDocument, sections,markdown=USE_MARKDOWN) {
  const chatSession = await getChatSessionForRefinement(originalTranscript, originalDocument);

  for (let section of sections) {
    await refineSection(chatSession, section);
  }

  const finalResponse = await refineSection(await /*changeChatSessionModel(chatSession, 'gemini-exp-1206')*/chatSession, FINAL_DOCUMENT_MESSAGE);

  let refinedDocument = extractLatex(finalResponse);

  const MAX_TRIES = 5;
  let current = 1;
  if (!markdown) {

    while (!refinedDocument.includes("\\end{document}")) {
      const continuationResponse = await refineSection(chatSession, "continue exactly from where you stopped and complete the response");
      console.log(continuationResponse);
      refinedDocument += extractLatex(continuationResponse);

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
    model: "gemini-2.0-flash-exp",
    systemInstruction: prompt
  });

  const chatSession = model.startChat({
    generationConfig: { ...generationConfig, temperature: 0.5 },
    history: [],
  });

  const result = await chatSession.sendMessage(document)
  const finalResponse = result.response.text();

  let refinedDocument = extractLatex(finalResponse);

  const MAX_TRIES = 5;
  let current = 1;

  if (!markdown) {
    while (!refinedDocument.includes("\\end{document}")) {
      const continuationResponse = await refineSection(chatSession, "continue exactly from where you stopped and complete the response");
      console.log(continuationResponse);
      refinedDocument += extractLatex(continuationResponse);

      current++;
      if (current == MAX_TRIES) {
        break;
      }
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







module.exports = { generateTranscriptionFromAudio, generateLatexFromTranscription, generateLatexFromAudio, refineSection, refineSections, finalRefinement, extractLatex, extractMarkdown, convertLatexToMarkdown };