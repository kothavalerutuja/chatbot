const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const pdfParse = require('pdf-parse'); // More reliable for PDFs
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

let uploadedFiles = {}; // Store extracted text by filename
const MAX_PROMPT_LENGTH = 40000;

// Function to extract text from a PDF
async function extractTextFromPDF(filePath) {
    try {
        const data = await pdfParse(fs.readFileSync(filePath));
        return data.text || '';
    } catch (error) {
        console.error('Error extracting text from PDF:', error);
        return '';
    }
}

// Read and process uploaded files
async function readUploadedFiles() {
    try {
        const files = fs.readdirSync(path.join(__dirname, 'uploads'));
        uploadedFiles = {}; // Reset stored content

        for (const file of files) {
            const filePath = path.join(__dirname, 'uploads', file);
            if (path.extname(filePath) === '.pdf') {
                const extractedText = await extractTextFromPDF(filePath);
                uploadedFiles[file] = extractedText;
            }
        }
        console.log("Uploaded files processed successfully.");
    } catch (error) {
        console.error('Error reading uploaded files:', error);
    }
}

// Truncate text if too long
function truncateText(text, maxLength) {
    return text.length > maxLength ? text.substring(0, maxLength) : text;
}

// File upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    await readUploadedFiles();
    res.json({ message: 'File uploaded and processed successfully.' });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
    console.log('Received request:', req.body);

    const userMessage = req.body.message;
    if (!userMessage) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const uploadedContent = truncateText(Object.values(uploadedFiles).join('\n'), MAX_PROMPT_LENGTH);

        const requestBody = {
            model: 'gpt-3.5-turbo', // Use a supported OpenRouter model
            messages: [
                { role: "system", content: "You are an AI assistant. Use the uploaded documents to answer the user's question. Only respond with information from the documents." },
                { role: "user", content: uploadedContent + "\n\nUser Question: " + userMessage }
            ],
            max_tokens: 150
        };

        console.log("Sending request to OpenRouter:", JSON.stringify(requestBody, null, 2));

        const apiResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', requestBody, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        console.log("OpenRouter response:", apiResponse.data);

        const choices = apiResponse.data.choices;
        if (choices && choices.length > 0 && choices[0].message) {
            res.json({ response: choices[0].message.content.trim() });
        } else {
            res.status(500).json({ error: 'No valid response from OpenRouter.' });
        }
    } catch (error) {
        console.error('Error processing the request:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Internal server error. Please try again later.' });
    }
});

// Start the server
app.listen(port, async () => {
    console.log(`Server is running on http://localhost:${port}`);
    await readUploadedFiles();
    console.log('Uploaded files processed on startup.');
});
