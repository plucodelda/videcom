const express = require("express");
const xml2js = require("xml2js");
const axios = require("axios");

const app = express();
app.use(express.json());

const VRS_BASE_URL =
  "https://customertest.videcom.com/fastjet/VRSXMLService/VRSXMLWebservice3.asmx";

const DEFAULT_HEADERS = {
  "Content-Type": "text/xml; charset=utf-8",
  Accept: "application/xml",
  SOAPAction: "http://videcom.com/PostVRSCommand",
};

// Escapar XML
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Mapear mensagens de erro
function getVRSErrorMessage(errorCode) {
  const vrsErrorCodes = {
    "Error 101": "Not HTTPS - API must be called over HTTPS",
    "Error 102": "No Token - Token is missing or empty",
    "Error 103": "Invalid Token - Token is not valid or expired",
    "Error 104": "Invalid Agent sine - Agent signature is invalid",
    "Error 105": "No IP configured for Agent - IP address not configured",
    "Error 106": "Invalid IP - IP address not authorized",
    "Error 107": "ApiIpAddress missing from Agent table - Configuration issue",
  };
  return vrsErrorCodes[errorCode] || `Unknown VRS error: ${errorCode}`;
}

// Construir SOAP com token e comando
function buildSOAPMessage(token, command) {
  if (!token || token.trim() === "") {
    throw new Error("Token is required and cannot be empty");
  }

  const escapedCommand = escapeXml(command);
  const escapedToken = escapeXml(token);

  const innerMsg = `<msg><Token><![CDATA[${escapedToken}]]></Token><Command>${escapedCommand}</Command></msg>`;

  return `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <PostApisData xmlns="http://videcom.com/">
        <msg><![CDATA[${innerMsg}]]></msg>
      </PostApisData>
    </soap:Body>
  </soap:Envelope>`;
}

// Enviar comando SOAP para o VRS
async function sendVRSCommand(token, command) {
  const soapMessage = buildSOAPMessage(token, command);
  console.log("SOAP Message:", soapMessage);

  const response = await axios.post(VRS_BASE_URL, soapMessage, {
    headers: DEFAULT_HEADERS,
    timeout: 30000,
    validateStatus: (status) => status < 600,
  });

  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    normalize: true,
    normalizeTags: true,
    trim: true,
  });

  const parsed = await parser.parseStringPromise(response.data);

  let result = null;
  const paths = [
    [
      "soap:envelope",
      "soap:body",
      "postapisdataresponse",
      "postapisdataresult",
    ],
    ["Envelope", "Body", "PostApisDataResponse", "PostApisDataResult"],
  ];

  for (const path of paths) {
    let current = parsed;
    let found = true;
    for (const key of path) {
      if (current && current[key]) {
        current = current[key];
      } else {
        found = false;
        break;
      }
    }
    if (found && current) {
      result = current;
      break;
    }
  }

  return result || response.data;
}

// Middleware para extrair o token do header/body/query
function validateToken(req, res, next) {
  let token =
    req.headers.authorization?.replace(/Bearer /i, "") ||
    req.body.token ||
    req.query.token;

  if (!token || token.trim() === "") {
    return res.status(401).json({
      error: "Token is required",
      hint: "Send token via Authorization header (Bearer TOKEN) or in body/query",
    });
  }

  req.token = token.trim();
  next();
}

// Extrair RLOC da resposta (ajuste conforme estrutura do seu retorno)
function extractRLOC(data) {
  if (typeof data === "string") {
    const match = data.match(/RLOC=([A-Z0-9]{6})/);
    return match ? match[1] : null;
  }
  return null;
}

// Rota para criar reserva
app.post("/api/bookings", validateToken, async (req, res) => {
  const { passengerName, email, title = "MR" } = req.body;

  if (!passengerName || !email) {
    return res.status(400).json({
      error: "passengerName and email are required",
      example: {
        passengerName: "Silva/JoaoMr",
        email: "joao@email.com",
        title: "MR",
      },
    });
  }

  const command = `-1${passengerName}^9-1E*${email}^e*r~x`;

  try {
    const response = await sendVRSCommand(req.token, command);

    if (
      typeof response === "object" &&
      response._ &&
      response._.includes("Error")
    ) {
      return res.status(400).json({
        error: "VRS API Error",
        vrsError: response._,
        details: getVRSErrorMessage(response._),
      });
    }

    let parsedResponse = response;
    let rloc = null;

    if (typeof response === "string" && response.includes("<")) {
      const parser = new xml2js.Parser({ explicitArray: false });
      parsedResponse = await parser.parseStringPromise(response);
    }

    rloc = extractRLOC(response);

    res.json({
      success: true,
      message: "Booking created successfully",
      data: parsedResponse,
      rloc,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create booking",
      details: error.message,
    });
  }
});

// Porta e inicialização
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
  console.log(`POST /api/bookings`);
});

module.exports = app;
