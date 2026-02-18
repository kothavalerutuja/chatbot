// Import required modules
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const pdf = require('pdf-parse'); // Import pdf-parse
require('dotenv').config(); // Load environment variables from .env file

// Initialize Express app
const app = express();
const port = 3000;

// Middleware for parsing JSON bodies
app.use(express.json());
app.use(cors()); // Allow CORS for all routes

// Variables to store scraped data and uploaded file content
let scrapedText = '';
let uploadedText = '';

// Predefined website URL for scraping
const predefinedUrl = 'https://springuplabs.com/'; // Replace with your desired URL
const MAX_PROMPT_LENGTH = 3000; // Maximum length for the prompt

// Function to scrape website content
async function scrapeWebsite(url, visitedUrls = new Set()) {
    try {
        if (visitedUrls.has(url)) return; // Prevent re-visiting URLs
        visitedUrls.add(url); // Mark this URL as visited

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        // Extract text from various sections including header, body, footer, etc.
        scrapedText += $('html').text() + '\n'; // Get text from the entire HTML document

        // Additional targeted scraping
        // Extract footer content specifically
        $('footer').each((index, element) => {
            scrapedText += $(element).text() + '\n'; // Extract footer content
        });

        // You can also extract header content
        $('header').each((index, element) => {
            scrapedText += $(element).text() + '\n'; // Extract header content
        });

        // Target specific classes or IDs if needed
        // For example: if the footer has a specific class
        $('.footer').each((index, element) => {
            scrapedText += $(element).text() + '\n'; // Extract content from a class named 'footer-class'
        });

        // Scrape specific links and information
        $('a').each((index, element) => {
            const linkText = $(element).text().trim();
            const href = $(element).attr('href');
            if (href) {
                scrapedText += `Link: ${linkText}, URL: ${href}\n`; // Collect all links
            }
        });

        // Find internal links and scrape those pages
        const internalLinks = [];
        $('a[href]').each((index, element) => {
            const href = $(element).attr('href');
            if (href.startsWith('/') || href.startsWith(url)) { // Only internal links
                const fullUrl = href.startsWith('/') ? `${url}${href}` : href;
                if (!internalLinks.includes(fullUrl) && !visitedUrls.has(fullUrl)) {
                    internalLinks.push(fullUrl);
                }
            }
        });

        // Scrape all discovered internal links
        for (const link of internalLinks) {
            console.log(`Scraping: ${link}`);
            await scrapeWebsite(link, visitedUrls); // Recursively scrape each internal link
        }

        console.log('Website scraped successfully.');
    } catch (error) {
        console.error('Error scraping website:', error);
    }
}



// Function to read and extract text from PDF files
async function readUploadedFiles() {
    try {
        const files = fs.readdirSync(path.join(__dirname, 'uploads'));
        for (const file of files) {
            const filePath = path.join(__dirname, 'uploads', file);
            if (path.extname(filePath) === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const data = await pdf(dataBuffer);
                uploadedText += data.text + '\n'; // Append the text content of the PDF file
            }
        }
        console.log('Uploaded files read successfully.');
    } catch (error) {
        console.error('Error reading uploaded files:', error);
    }
}

// Function to truncate text to a maximum length
function truncateText(text, maxLength) {
    return text.length > maxLength ? text.substring(0, maxLength) : text;
}

// Root route
app.get('/', (req, res) => {
    // Send the index.html file located in the public folder
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Chat endpoint
app.post('/chat', async (req, res) => {
    const { message } = req.body;

    // Log the incoming message to help with debugging
    console.log('Received message:', message);

    try {
        // Step 1: Truncate content to ensure it doesn't exceed the maximum prompt length
        const scrapedContent = truncateText(scrapedText, MAX_PROMPT_LENGTH);
        const uploadedContent = truncateText(uploadedText, MAX_PROMPT_LENGTH);

        // Step 2: Construct the prompt for OpenRouter API
        const prompt = `
You are an AI assistant. Use the content provided below to answer the user's query. 
Only respond with information based on the provided content.
Answer clearly and concisely.

Scraped Website Content:\n${scrapedContent}
Uploaded File Content:\n${uploadedContent}

User Question: "${message}"
        `;

        // Log the prompt to debug what is being sent to the API
        // console.log("Constructed Prompt:", prompt);

        // Step 3: Call the OpenRouter API to get a response
        const apiResponse = await axios.post('https://openrouter.ai/api/v1/completions', {
            prompt: prompt,
            model: 'gpt-3.5-turbo', // Specify the model you want to use
            max_tokens: 150, // Adjust the number of tokens based on the expected response length
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, // Using environment variable for API key
                'Content-Type': 'application/json',
            },
        });
        console.log("rsponse:",apiResponse)
        // Step 4: Handle the API response
        const choices = apiResponse.data.choices; // OpenRouter returns an array of choices
        if (choices && choices.length > 0 && choices[0].text) {
            const botResponse = choices[0].text.trim(); // Extract and clean up the text response
            if (botResponse.toLowerCase().includes("not provide")) {
                res.json({ response: "We do not provide that information." });
            } else {
                res.json({ response: botResponse }); // Send the response back to the frontend
            }
        } else {
            // If no valid response is returned, send an error message
            res.status(500).json({ error: 'No valid response from the OpenRouter.' });
        }

    } catch (error) {
        // Step 5: Error handling - Log errors and provide a user-friendly error message
        console.error('Error processing the request:', error.message);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
});

// Start the server
app.listen(port, async () => {
    console.log(`Server is running on http://localhost:${port}`);

    // Automatically scrape the website and read uploaded files when the server starts
    await scrapeWebsite(predefinedUrl);
    await readUploadedFiles();
    console.log('Website and uploaded files scraped successfully on startup.'); // Log the success message
});
