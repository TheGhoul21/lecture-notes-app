const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getOrCreateCollection, addDocuments, searchDocuments } = require('./vector-store');
const config = require('../utils/config');

const apiKey = config.geminiApiKey;

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({ model: "text-embedding-004"});



async function generateEmbeddings(text) {
    try {
        const result = await model.embedContent(text);
        const embedding = result.embedding.values;
        return embedding;
    } catch (error) {
        console.error("Error generating embeddings", error);
        return null;
    }
}

async function createVectorStore(documents, metadatas=[]) {
    const collection = await getOrCreateCollection();
    const ids = documents.map((_, index) => `doc_${index}`);
    const texts = documents;
    const embeddings = await Promise.all(documents.map(doc => generateEmbeddings(doc)));

    if (embeddings) {
        await addDocuments(collection, texts, ids, embeddings, metadatas);
        return true;
    }

    return false;
}

async function queryVectorStore(query, limit = 5) {
    const collection = await getOrCreateCollection();
    const queryEmbedding = await generateEmbeddings(query);

    if (queryEmbedding) {
        const results = await searchDocuments(collection, queryEmbedding, limit);
        console.log(results);
        return results.documents[0];
    }

    return null;
}




function simpleTextSplitter(text, chunkSize = 1000, chunkOverlap = 200) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

async function splitAndCreateEmbeddings(text, metadatas=[]) {
  const output = simpleTextSplitter(text);
  const result = await createVectorStore(output, metadatas);
  return result;
}


module.exports = { generateEmbeddings, createVectorStore, queryVectorStore, splitAndCreateEmbeddings };