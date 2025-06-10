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
  // Validar token
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

async function sendVRSCommand(token, command) {
  try {
    const soapMessage = buildSOAPMessage(token, command);

    console.log("Sending SOAP request to:", `${VRS_BASE_URL}`);
    console.log("Command:", command);
    console.log("SOAP Message:", soapMessage);

    const response = await axios.post(VRS_BASE_URL, soapMessage, {
      headers: DEFAULT_HEADERS,
      timeout: 30000, // 30 segundos timeout
      validateStatus: function (status) {
        return status < 600; // Aceita qualquer status < 600 para debug
      },
    });

    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers);
    console.log("Raw response data:", response.data);

    if (response.status >= 400) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}\nResponse: ${response.data}`
      );
    }

    // Parse da resposta SOAP para extrair o conteúdo XML interno
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

    // Navegar pela estrutura SOAP response com mais robustez
    let vrsResponse = null;

    // Tentar diferentes variações da estrutura SOAP
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
      // Adicionar mais variações conforme necessário
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
        console.log("Found VRS response using path:", path.join("."));
        break;
      }
    }

    // Se não encontrou usando os caminhos conhecidos, tentar extrair manualmente
    if (!vrsResponse) {
      console.log(
        "Could not find response using standard paths, analyzing structure..."
      );

      // Log da estrutura completa para debug
      console.log("Full SOAP structure keys:", Object.keys(soapResult));

      // Tentar encontrar qualquer elemento que contenha "result" ou similar
      function findResult(obj, path = []) {
        if (typeof obj === "object" && obj !== null) {
          for (const [key, value] of Object.entries(obj)) {
            const currentPath = [...path, key];

            if (key.toLowerCase().includes("result")) {
              console.log("Found potential result at:", currentPath.join("."));
              return value;
            }

            const nested = findResult(value, currentPath);
            if (nested) return nested;
          }
        }
        return null;
      }

      vrsResponse = findResult(soapResult);
    }

    // Se ainda não encontrou, usar a resposta bruta
    if (!vrsResponse) {
      console.log("Using raw response data");
      vrsResponse = response.data;
    }

    console.log("Final VRS response:", vrsResponse);
    return vrsResponse;
  } catch (error) {
    console.error("VRS API Error Details:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
    });

    // Mapear erros VRS específicos
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

  // Limpar token de espaços extras
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

    // ✅ Aqui estava faltando esta linha!
    const response = await sendVRSCommand(req.token, command);

    if (
      typeof response === "object" &&
      response._ &&
      response._.includes("Error")
    ) {
      return res.status(400).json({
        error: "VRS API Error",
        vrsError: response._,
        token: req.token,
        details: getVRSErrorMessage(response._),
        hint:
          response._ === "Error 102"
            ? "Check if your token is valid and properly formatted"
            : null,
      });
    }

    let parsedResponse = response;
    let rloc = null;

    try {
      if (typeof response === "string" && response.includes("<")) {
        const parser = new xml2js.Parser({ explicitArray: false });
        parsedResponse = await parser.parseStringPromise(response);
      }

      rloc = extractRLOC(response);
    } catch (parseError) {
      console.log(
        "Could not parse response as XML, using raw response:",
        parseError.message
      );
    }

    res.json({
      success: true,
      message: "Booking created successfully",
      data: parsedResponse,
      rloc: rloc,
      rawResponse: response,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create booking",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VRS XML Service API running on port ${PORT}`);
  console.log(`Connected to: ${VRS_BASE_URL}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`\nAPI Documentation:`);
  console.log(`POST /api/bookings - Create new booking`);
});

module.exports = app;
