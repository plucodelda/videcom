const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const app = express();
const port = 3000;

// Middleware - MUST be added before routes
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// Configuration
const VRS_CONFIG = {
  baseUrl: "https://customer3.videcom.com/vrsxmlservice/VrsXmlWebService3.asmx",
  token: "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=",
  defaultHeaders: {
    "Content-Type": "text/xml; charset=utf-8",
    SOAPAction: "http://videcom.com/RunVRSCommand",
  },
};

// API Endpoint with PROPER request body handling
app.post("/api/flights/availability", async (req, res) => {
  try {
    // 1. Validate request body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: "Request body is missing",
        example: {
          departureDate: "20NOV",
          origin: "LOS",
          destination: "ABV",
          passengers: 1,
        },
      });
    }

    // 2. Destructure with default values
    const {
      departureDate = null,
      origin = null,
      destination = null,
      passengers = 1,
    } = req.body;

    // 3. Validate required fields
    if (!departureDate || !origin || !destination) {
      const missing = [];
      if (!departureDate) missing.push("departureDate");
      if (!origin) missing.push("origin");
      if (!destination) missing.push("destination");

      return res.status(400).json({
        error: "Missing required fields",
        missingFields: missing,
        exampleRequest: {
          departureDate: "20NOV",
          origin: "LOS",
          destination: "ABV",
          passengers: 1,
        },
      });
    }

    // 4. Build command
    const command =
      `A${departureDate}${origin}${destination}[` +
      `SalesCity=${origin},` +
      `VARS=True,` +
      `ClassBands=True,` +
      `StartCity=${origin},` +
      `SingleSeg=s,` +
      `FGNoAv=True,` +
      `qtyseats=${passengers},` +
      `journey=${origin}-${destination}]`;

    // 5. Make request
    const response = await axios.post(
      VRS_CONFIG.baseUrl,
      `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xmlns:xsd="http://www.w3.org/2001/XMLSchema"
        xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <msg xmlns="http://videcom.com/">
            <Token>${VRS_CONFIG.token}</Token>
            <Command>${command}</Command>
          </msg>
        </soap:Body>
      </soap:Envelope>`,
      {
        headers: VRS_CONFIG.defaultHeaders,
      }
    );

    // 6. Parse response
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);

    res.json(result);
  } catch (error) {
    console.error("API Error:", error.message);

    const status = error.response?.status || 500;
    const message = error.response?.data
      ? "VRS API error"
      : error.request
      ? "No response from VRS API"
      : "Request failed";

    res.status(status).json({
      error: message,
      details: error.message,
      ...(error.response && {
        status: error.response.status,
        data: error.response.data,
      }),
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
