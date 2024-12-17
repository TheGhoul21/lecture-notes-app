// src/transcription/transcription-service.js
const { pipeline } = require('@huggingface/transformers');

const wavefile = require('wavefile')
const fs = require('fs')
const {exec} = require('child_process');


// async function transcribeAudio(audioPath) {
//     // Allocate a pipeline for sentiment-analysis
//     // const pipe = await pipeline('automatic-speech-recognition', 'distil-whisper/distil-large-v3');

//     // const result = await pipe(audioPath);
//     console.log(audioPath)

//     const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
//     // const url = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';

//     const audioData = await getAudioData(audioPath)


//     const output = await transcriber(audioData, {
//         chunk_length_s: 25,
//         stride_length_s:5,
//         max_length: 10000,
//         max_new_tokens: 10000,
//     });

//     console.log(output);
//     return output['text']


// }

async function transcribeAudio(audioPath) {
    return new Promise((resolve, reject) => {
        exec(`python3 src/transcribe.py ${audioPath}`, (error, stdout, stderr) => {
          if(error) {
            console.error(`Error in transcription ${error}`);
            reject(error);
            return;
          }
  
          const transcript = stdout.trim();
          resolve(transcript);
      })
    })
  }
  


const getAudioData = async (url) => {

    // Load audio data
    // let buffer = Buffer.from(await fetch(url).then(x => x.arrayBuffer()))

    let buffer = fs.readFileSync(url)

    // Read .wav file and convert it to required format
    let wav = new wavefile.WaveFile(buffer);
    wav.toBitDepth('32f'); // Pipeline expects input as a Float32Array
    wav.toSampleRate(16000); // Whisper expects audio with a sampling rate of 16000
    let audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
        if (audioData.length > 1) {
            const SCALING_FACTOR = Math.sqrt(2);

            // Merge channels (into first channel to save memory)
            for (let i = 0; i < audioData[0].length; ++i) {
                audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
            }
        }

        // Select first channel
        audioData = audioData[0];
    }
    return audioData
}

module.exports = { transcribeAudio };