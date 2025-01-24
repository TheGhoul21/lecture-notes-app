const { ChromaClient } = require('chromadb');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'chroma_db');
const COLLECTION_NAME = 'lecture_notes';


async function getOrCreateCollection() {
  const client = new ChromaClient({  });
  try {
    const collection = await client.getCollection({ name: COLLECTION_NAME });
    console.log("Existing collection loaded.");
    return collection;
  } catch (error) {
    if (error.message.includes("does not exist")) {
      console.log("Creating a new collection");
      return await client.createCollection({ name: COLLECTION_NAME });
    }
    throw error;
  }
}

async function doesDBExist() {
  const client = new ChromaClient({  });

  try {
    const collections = await client.listCollections();
    return collections.some(collection => collection.name === COLLECTION_NAME);
  } catch (error) {
    console.error('Error checking if DB exists:', error);
    return false;
  }
}
async function addDocuments(collection, documents, ids, embeddings, metadatas=[]) {
  try {
    await collection.add({
      ids: ids,
      documents: documents,
      embeddings: embeddings,
      metadatas

    });
    console.log("Documents added to the collection");

  } catch (error) {
    console.error("Error adding documents to collection", error);
  }
}


async function searchDocuments(collection, queryEmbedding, limit = 5) {
  try {
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
    });
    return results;
  } catch (error) {
    console.error('Error searching documents:', error);
    return [];
  }
}


async function deleteCollection() {
  const client = new ChromaClient({ path: DB_PATH });

  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
    console.log("Collection deleted successfully");
  } catch (err) {
    console.warn("Error deleting collection", err);
  }
}


module.exports = { getOrCreateCollection, addDocuments, searchDocuments, deleteCollection, doesDBExist };