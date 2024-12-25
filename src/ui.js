const inquirer = require('inquirer');
// const chalk = require('chalk');

async function selectVideoFiles(files) {
    const groupedFiles = files.reduce((acc, file) => {
        const date = extractDateFromFileName(file.name);
        if (!acc[date]) {
            acc[date] = [];
        }

        const formattedDate = new Date(date.slice(0, 4), date.slice(4, 6) - 1, date.slice(6, 8)).toLocaleDateString();
        acc[date].push({...file, date:formattedDate});
        return acc;
    }, {});

    const choices = Object.keys(groupedFiles).sort().map((date, index) => ({
        
        name: `L${String(index + 1).padStart(2, '0')} - ${new Date(date.slice(0, 4), date.slice(4, 6) - 1, date.slice(6, 8)).toLocaleDateString()}`,
        value: date,
    }));

    const { selectedDates } = await inquirer.default.prompt([
        {
            type: 'checkbox',
            message: 'Select a date to process videos',
            name: 'selectedDates',
            choices,
            pageSize: 10,
        },
    ]);


    const sortedFiles = selectedDates.map(date => 
        groupedFiles[date].sort((a, b) => a.name.localeCompare(b.name))
    );

    return sortedFiles;
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

function extractDateFromFileName(fileName) {
    const dateMatch = fileName.match(/(\d{8})/); // Matches 8 digits (YYYYMMDD)
    return dateMatch ? dateMatch[1] : null;
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
            value: video.id,
            date: extractDateFromFileName(video.file_name)
        }));

        // Sort choices by date in ascending order
        choices.sort((a, b) => a.date.localeCompare(b.date));

        // Update the name to be Lxx (L01, L02, etc) based on the ascending order
        choices.forEach((choice, index) => {
            choice.name = `L${String(index + 1).padStart(2, '0')} - ${choice.name}`;
        });


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