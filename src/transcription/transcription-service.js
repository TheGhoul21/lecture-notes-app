// src/transcription/transcription-service.js
const { pipeline } = require('@huggingface/transformers');

const wavefile = require('wavefile')
const fs = require('fs')
const { exec } = require('child_process');
const { generateTranscriptionFromAudio } = require('../gemini/gemini-service');

const USE_GEMINI_FOR_AUDIO_TRANSCRIPTION = (process.env.USE_GEMINI_FOR_AUDIO_TRANSCRIPTION ?? 0) == '1'

async function transcribeAudio(audioPath) {
  if(USE_GEMINI_FOR_AUDIO_TRANSCRIPTION)
    return generateTranscriptionFromAudio(audioPath);
  else return new Promise((resolve, reject) => {
    exec(`python3 src/transcribe.py ${audioPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error in transcription ${error}`);
        reject(error);
        return;
      }

      const transcript = stdout.trim();
      resolve(transcript);
    })
  })
}

module.exports = { transcribeAudio };