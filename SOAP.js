const express = require("express");
const xml2js = require("xml2js");
const app = express();
const axios = require("axios");

app.use(express.json());

const VRS_BASE_URL =
  "https://customertest.videcom.com/fastjet/VRSXMLService/VRSXMLWebservice3.asmx";
const VRVRS_ENDPOINT = "PostVRSCommand";
const DEFAULT_HEADERS = {
  "Content-Type": "text/xml; charset=utf-8",
  Accept: "application/xml",
  SOAPAction: "http://videcom.com/PostVRSCommand",
};

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

function buildSOAPMessage(token, command) {
  if (!token || token.trim() === "") {
    throw new Error("Token is required and cannot be empty");
  }

  const escapedCommand = command
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const innerMsg = `<msg><Token>${token}</Token><Command>${escapedCommand}</Command></msg>`;

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

function extractRLOC(response) {
  if (!response) return null;

  // Se a resposta for uma string, tentar extrair o RLOC
  if (typeof response === "string") {
    const rlocMatch = response.match(/RLOC:\s*([A-Z0-9]{6})/i);
    if (rlocMatch && rlocMatch[1]) {
      return rlocMatch[1].toUpperCase();
    }
  }

  // Se for um objeto, procurar por RLOC em propriedades
  if (typeof response === "object") {
    const searchForRLOC = (obj) => {
      for (const key in obj) {
        if (key.toUpperCase() === "RLOC") {
          return obj[key];
        }
        if (typeof obj[key] === "object") {
          const found = searchForRLOC(obj[key]);
          if (found) return found;
        }
      }
      return null;
    };

    return searchForRLOC(response);
  }

  return null;
}

async function sendVRSCommand(token, command) {
  try {
    const soapMessage = buildSOAPMessage(token, command);

    console.log("Sending SOAP request to:", `${VRS_BASE_URL}`);
    console.log("Command:", command);
    console.log("SOAP Message:", soapMessage);

    const response = await axios.post(VRS_BASE_URL, soapMessage, {
      headers: DEFAULT_HEADERS,
      timeout: 30000,
      validateStatus: function (status) {
        return status < 600;
      },
    });

    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers);

    if (response.status >= 400) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}\nResponse: ${response.data}`
      );
    }

    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      normalize: true,
      normalizeTags: true,
      trim: true,
      ignoreAttrs: false,
    });

    const soapResult = await parser.parseStringPromise(response.data);
    console.log("Parsed SOAP result:", JSON.stringify(soapResult, null, 2));

    // Extrair o conteúdo CDATA da resposta SOAP
    let vrsResponse = null;
    const possiblePaths = [
      [
        "soap:envelope",
        "soap:body",
        "postapisdataresponse",
        "postapisdataresult",
      ],
      ["envelope", "body", "postapisdataresponse", "postapisdataresult"],
      [
        "soap:envelope",
        "soap:body",
        "PostApisDataResponse",
        "PostApisDataResult",
      ],
      ["Envelope", "Body", "PostApisDataResponse", "PostApisDataResult"],
    ];

    for (const path of possiblePaths) {
      let current = soapResult;
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
        vrsResponse = current;
        break;
      }
    }

    // Se não encontrou, tentar extrair manualmente
    if (!vrsResponse) {
      if (
        typeof response.data === "string" &&
        response.data.includes("<msg>")
      ) {
        const msgStart = response.data.indexOf("<msg>") + 5;
        const msgEnd = response.data.indexOf("</msg>");
        if (msgStart > 0 && msgEnd > msgStart) {
          vrsResponse = response.data.substring(msgStart, msgEnd);
        }
      }
    }

    // Se ainda não encontrou, usar a resposta bruta
    if (!vrsResponse) {
      vrsResponse = response.data;
    }

    return vrsResponse;
  } catch (error) {
    console.error("VRS API Error Details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
    });

    if (error.response?.status === 500) {
      const errorData = error.response.data;
      if (typeof errorData === "string" && errorData.includes("soap:Fault")) {
        throw new Error(`SOAP Fault: ${errorData}`);
      }
    }

    throw new Error(`VRS API Error: ${error.message}`);
  }
}

function validateToken(req, res, next) {
  let token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.headers.authorization?.replace("bearer ", "") ||
    req.body.token ||
    req.query.token;

  if (!token) {
    return res.status(401).json({
      error: "Token is required",
      hint: "Send token via Authorization header (Bearer TOKEN) or in request body/query",
    });
  }

  token = token.trim();

  if (token === "") {
    return res.status(401).json({
      error: "Token cannot be empty",
    });
  }

  console.log(
    "Using token:",
    token.substring(0, 10) + "..." + token.substring(token.length - 5)
  );
  req.token = token;
  next();
}

app.post("/api/bookings", validateToken, async (req, res) => {
  try {
    const { passengerName, email, title = "MR" } = req.body;
    const hardcodedToken = "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";

    if (!passengerName || !email) {
      return res.status(400).json({
        error: "Passenger name and email are required",
        example: {
          passengerName: "Silva/JoaoMr",
          email: "joao.silva@email.com",
          title: "MR",
        },
      });
    }

    const command = `-1${passengerName}^9-1E*${email}^e*r~x`;
    const response = await sendVRSCommand(hardcodedToken, command);

    // Verificar se há erros na resposta
    if (typeof response === "string" && response.includes("Error")) {
      const errorMatch = response.match(/Error\s+\d+/);
      if (errorMatch) {
        return res.status(400).json({
          error: "VRS API Error",
          vrsError: errorMatch[0],
          details: getVRSErrorMessage(errorMatch[0]),
          hint:
            errorMatch[0] === "Error 102"
              ? "Check if your token is valid and properly formatted"
              : null,
        });
      }
    }

    const rloc = extractRLOC(response);

    res.json({
      success: true,
      message: "Booking created successfully",
      rloc: rloc,
      rawResponse: response,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create booking",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Rota de health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "VRS XML Service API",
    version: "1.0.0",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VRS XML Service API running on port ${PORT}`);
  console.log(`Connected to: ${VRS_BASE_URL}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`\nAPI Documentation:`);
  console.log(`POST /api/bookings - Create new booking`);
  console.log(`Headers: Authorization: Bearer <token>`);
  console.log(
    `Body: { passengerName: "Silva/JoaoMr", email: "joao.silva@email.com", title: "MR" }`
  );
});

module.exports = app;
