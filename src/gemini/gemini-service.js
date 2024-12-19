const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

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
  for(path of audioPaths) {
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

  for(let i=0; i< numberOfIterations; i++) {
    const result = await chatSession.sendMessage(message)
    message = "continue or just say ##STOP## if it's already completed";
    const text = result.response.text().trim()

    console.log(text.slice(text.length-20))
    if(text.endsWith('STOP')) break;

    if(text.endsWith("\\end\{document\}\n```")) break;

    responses.push(text.replace("##STOP##", ""));
    if(text.includes("##STOP##")) break;
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


async function finalRefinement(document) {
  const prompt = FINAL_REFINEMENT_PROMPT.replace("{document}",document);
  console.log("Final refinement");

  const model = genAI.getGenerativeModel({
      model: "gemini-exp-1206",
      systemInstruction: "You are an expert LaTeX editor",
    });
    const chatSession = model.startChat({
      generationConfig,
      history: [],
    });
    const result = await chatSession.sendMessage(prompt);
    return result.response.text();
}




module.exports = { generateLatexFromTranscription, generateLatexFromAudio, refineSection, finalRefinement };