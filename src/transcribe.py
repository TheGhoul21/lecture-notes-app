import argparse
from transformers import pipeline

def transcribe_audio(file_path):
    # Load the model and pipeline
    transcriber = pipeline("automatic-speech-recognition", model="openai/whisper-small")
    
    # Transcribe the audio file
    transcription = transcriber(file_path)
    
    # Return the transcription text
    return transcription['text']

def main():
    # Set up argument parser
    parser = argparse.ArgumentParser(description="Transcribe audio files using openai/whisper-small model.")
    parser.add_argument("file_path", type=str, help="Path to the audio file to transcribe.")
    
    # Parse arguments
    args = parser.parse_args()
    
    # Transcribe the audio file
    transcription = transcribe_audio(args.file_path)
    
    # Print the transcription
    print(transcription)

if __name__ == "__main__":
    main()