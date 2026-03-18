const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const upload = multer({ dest: 'uploads/' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const EXTRACTION_PROMPT = `You are an insurance risk analyst specializing in transportation/trucking accounts. 

Analyze this loss run document and extract the following information. If a field is not present or unclear, mark it as "N/A".

Return a JSON object with these exact fields:

1. policyNumber - The policy number
2. policyPeriod - Policy effective dates (From - To)
3. namedInsured - The company/person named on the policy
4. totalClaims - Total number of claims
5. totalIncurred - Total amount incurred (sum of paid + reserved)
6. totalPaid - Total amount paid out
7. lossRatio - Calculated loss ratio if available
8. claims[] - Array of claims with:
   - claimNumber
   - dateOfLoss
   - description
   - incurredAmount
   - paidAmount
   - status (open/closed)
   - category (bodily injury, property damage, cargo, collision, comprehensive, other)
9. driverHistory - Any driver information mentioned
10. renewalStatus - Renewal status (renewed, non-renewed, pending)
11. missingInfo - List of commonly needed items that appear to be missing
12. riskSummary - A 2-3 sentence summary of the account's risk profile

Return ONLY valid JSON, no additional text.`;

app.post('/api/analyze', upload.array('documents', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      const filePath = file.path;
      const mimeType = file.mimetype;
      
      // Read the file
      const fileData = fs.readFileSync(filePath);
      const base64Image = fileData.toString('base64');
      
      // Use vision API for images
      const response = await openai.responses.create({
        model: "gpt-4o",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: EXTRACTION_PROMPT },
              { type: "input_image", image_url: `data:${mimeType};base64,${base64Image}` }
            ]
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      });

      let parsed;
      try {
        parsed = JSON.parse(response.output_text);
      } catch (e) {
        parsed = { raw: response.output_text, error: "Failed to parse JSON" };
      }

      results.push({
        filename: file.originalname,
        ...parsed
      });

      // Cleanup uploaded file
      fs.unlinkSync(filePath);
    }

    // Generate overall summary if multiple files
    const overall = {
      totalClaims: results.reduce((sum, r) => sum + (parseInt(r.totalClaims) || 0), 0),
      totalIncurred: results.reduce((sum, r) => sum + (parseFloat(r.totalIncurred) || 0), 0),
      totalPaid: results.reduce((sum, r) => sum + (parseFloat(r.totalPaid) || 0), 0),
      documentsAnalyzed: results.length
    };

    res.json({ results, overall });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Loss Run Analyzer running on http://localhost:${PORT}`));
