import { DataAPIClient } from '@datastax/astra-db-ts'
import { PuppeteerWebBaseLoader } from '@langchain/community/document_loaders/web/puppeteer'
import OpenAI from 'openai'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import "dotenv/config"

const { 
    ASTRA_DB_NAMESPACE, 
    ASTRA_DB_COLLECTION, 
    ASTRA_DB_API_ENDPOINT, 
    ASTRA_DB_APPLICATION_TOKEN,
    OPENAI_API_KEY
} = process.env

type SimilarityMetric = "dot_product" | "cosine" | "euclidean"

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
})

const f1Data = [
    'https://en.wikipedia.org/wiki/Formula_One',
    'https://en.wikipedia.org/wiki/2024_Formula_One_World_Championship',
]

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN)
const db = client.db(ASTRA_DB_API_ENDPOINT, { namespace: ASTRA_DB_NAMESPACE })

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1024,
    chunkOverlap: 100,
})

const createCollection = async (similarityMetric: SimilarityMetric = 'dot_product') => {
    const res = await db.createCollection(ASTRA_DB_COLLECTION, {
        vector: {
            dimension: 768,
            metric: similarityMetric
        }
    })

    console.log(res)
}

const loadSampleData = async () => {
    const collection = await db.collection(ASTRA_DB_COLLECTION)
    for await (const url of f1Data) {
        const content = await scrapePage(url)
        const chunks = await splitter.splitText(content)

        for await (const chunk of chunks) {
            const response = await fetch(`${process.env.EMBEDDING_BASE_URL}/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.EMBEDDING_KEY}`,
                },
                body: JSON.stringify({
                    model: 'netease-youdao/bce-embedding-base_v1',
                    input: chunk,
                    encoding_format: 'float',
                }),
            });
            const embedding = await response.json();


            const vector = embedding.data?.[0]?.embedding

            if (!vector) {
                continue
            }

            const res = await collection.insertOne({
                vector: vector,
                text: chunk
            })

            console.log(res)
        }
    }
}

const scrapePage = async (url: string): Promise<string> => {
    const loader = new PuppeteerWebBaseLoader(url, {
        launchOptions: {
            headless: true,
        },
        gotoOptions: {
            waitUntil: 'domcontentloaded',
        },
        evaluate: async (page, browser)=> {
            const result = await page.evaluate(() => {
                return document.body?.innerHTML
            })
            await browser.close()
            return result
        }
    })
    return (await loader.scrape())?.replace(/<[^>]*>/gm, '')
}

createCollection().then(() => loadSampleData())