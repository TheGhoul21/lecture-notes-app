const inquirer = require('inquirer');
// const chalk = require('chalk');

async function selectVideoFiles(files) {
    const choices = files.map((file, index) => ({
        name: `${file.name}`,
        value: index,
    }));

    const { selectedFiles } = await inquirer.default.prompt([
        {
            type: 'checkbox',
            message: 'Select videos to process (order is important)',
            name: 'selectedFiles',
            choices,
            pageSize: 10,
        },
    ]);

    const selected = selectedFiles.map((index) => files[index]);
    return selected;
}

function groupFilesByDate(choices) {
    const groupedFiles = {};

    for (const choice of choices) {
        // Extract date using regular expression
        const dateMatch = choice.name.match(/(\d{8})/); // Matches 8 digits (YYYYMMDD)

        if (dateMatch) {
            const date = dateMatch[1];

            // Group files by date
            if (!groupedFiles[date]) {
                groupedFiles[date] = [];
            }
            groupedFiles[date].push({...choice, date});
        }
    }

    // Convert the groupedFiles object to an array of arrays
    return groupedFiles;
}


async function showProcessedVideos(videos) {
    return import('chalk').then(async ({default:chalk}) => {

        if (videos.length === 0) {
            console.log(chalk.yellow('No videos processed yet.'));
            return;
        }

        console.log(chalk.green('\nProcessed Videos:'));
        const choices = videos.map(video => ({
            name: `${video.file_name} (ID: ${video.id})`,
            value: video.id
        }));


        const { selectedVideoId } = await inquirer.default.prompt({
            type: 'list',
            name: 'selectedVideoId',
            message: 'Select a video to explore',
            choices: choices
        });

        return selectedVideoId;
    });
}

async function chatWithLesson(video) {
    return import('chalk').then(async ({default:chalk}) => {
        const { startChatSessionWithLesson, chatWithTranscription } = require('./gemini/gemini-service');

        const chatSession = await startChatSessionWithLesson(video.transcription);
        const response = await chatWithTranscription(chatSession, "/help");
            console.log(chalk.blue('AI Response:'), response);

        while (true) {
            const { message } = await inquirer.default.prompt({
                type: 'input',
                name: 'message',
                message: 'You:'
            });

            if (message.toUpperCase() === 'QUIT') {
                console.log(chalk.red('Exiting chat session.'));
                break;
            }

            const response = await chatWithTranscription(chatSession, message);
            console.log(chalk.blue('AI Response:'), response);
        }
    });
}


async function showVideoDetails(video) {
    return import('chalk').then(async ({default:chalk}) => {
        console.log(chalk.blue('\n--- Video Details ---'));
        console.log(chalk.green(`File Name: ${video.file_name}`));
        console.log(chalk.green(`Transcription:\n${video.transcription}`));
        console.log(chalk.blue('\n--- LaTeX Output ---'));
        console.log(chalk.yellow(video.latex_output));

        await inquirer.default.prompt({
            type: 'input',
            message: 'Press Enter to continue',
            name: 'continue',
        });
    });
}


module.exports = { selectVideoFiles, showProcessedVideos, showVideoDetails, groupFilesByDate, chatWithLesson };