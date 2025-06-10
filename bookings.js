const express = require("express");
const xml2js = require("xml2js");
const axios = require("axios");
const cors = require("cors");

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Configurações VRS
const VRS_CONFIG = {
  BASE_URL:
    "https://customertest.videcom.com/fastjet/VRSXMLService/VRSXMLWebservice3.asmx",
  ENDPOINT: "PostVRSCommand",
  HEADERS: {
    "Content-Type": "text/xml; charset=utf-8",
    Accept: "application/xml",
    SOAPAction: "http://videcom.com/PostVRSCommand",
  },
  TIMEOUT: 30000,
};

// Códigos de erro VRS
const VRS_ERROR_CODES = {
  "Error 101": "Not HTTPS - API must be called over HTTPS",
  "Error 102": "No Token - Token is missing or empty",
  "Error 103": "Invalid Token - Token is not valid or expired",
  "Error 104": "Invalid Agent sine - Agent signature is invalid",
  "Error 105": "No IP configured for Agent - IP address not configured",
  "Error 106": "Invalid IP - IP address not authorized",
  "Error 107": "ApiIpAddress missing from Agent table - Configuration issue",
  "Error 108": "Token expired - Please get a new token",
  "Error 109": "Invalid credentials - Check username/password",
};

// Função para obter mensagem de erro VRS
function getVRSErrorMessage(errorCode) {
  return VRS_ERROR_CODES[errorCode] || `Unknown VRS error: ${errorCode}`;
}

// Logger melhorado
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Validação de token melhorada
function validateToken(req, res, next) {
  log("info", "=== TOKEN VALIDATION START ===");

  // Extrair token de diferentes fontes
  let token = null;

  // 1. Authorization header (Bearer token)
  if (req.headers.authorization) {
    if (req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.replace("Bearer ", "");
    } else if (req.headers.authorization.startsWith("bearer ")) {
      token = req.headers.authorization.replace("bearer ", "");
    } else {
      token = req.headers.authorization;
    }
  }

  // 2. Body token
  if (!token && req.body.token) {
    token = req.body.token;
  }

  // 3. Query parameter
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // 4. Header x-api-token (alternativo)
  if (!token && req.headers["x-api-token"]) {
    token = req.headers["x-api-token"];
  }

  log("info", "Token extraction result", {
    hasAuthHeader: !!req.headers.authorization,
    hasBodyToken: !!req.body.token,
    hasQueryToken: !!req.query.token,
    hasXApiToken: !!req.headers["x-api-token"],
    tokenFound: !!token,
    tokenLength: token?.length || 0,
  });

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Token is required",
      code: "MISSING_TOKEN",
      hint: "Send token via Authorization header (Bearer TOKEN), x-api-token header, request body, or query parameter",
      examples: {
        header: "Authorization: Bearer YOUR_TOKEN",
        xApiToken: "x-api-token: YOUR_TOKEN",
        body: '{"token": "YOUR_TOKEN", ...}',
        query: "?token=YOUR_TOKEN",
      },
    });
  }

  // Limpar token
  token = token.trim();

  if (token === "") {
    return res.status(401).json({
      success: false,
      error: "Token cannot be empty",
      code: "EMPTY_TOKEN",
    });
  }

  // Validações básicas do token
  if (token.length < 10) {
    return res.status(401).json({
      success: false,
      error: "Token appears to be too short",
      code: "INVALID_TOKEN_LENGTH",
      tokenLength: token.length,
      hint: "VRS tokens are usually longer than 10 characters",
    });
  }

  // Mascarar token para logs
  const maskedToken =
    token.length > 10
      ? `${token.substring(0, 5)}...${token.substring(token.length - 5)}`
      : `${token.substring(0, 3)}...`;

  log("info", `Token validated successfully: ${maskedToken}`);
  log("info", "=== TOKEN VALIDATION END ===");

  req.token = token;
  req.maskedToken = maskedToken;
  next();
}

// Construir mensagem SOAP
function buildSOAPMessage(token, command) {
  log("info", "=== BUILDING SOAP MESSAGE ===");
  log("info", `Command: ${command}`);

  if (!token || token.trim() === "") {
    throw new Error("Token is required and cannot be empty");
  }

  // Escapar caracteres especiais no comando
  const escapedCommand = command
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const innerMsg = `<msg><Token>${token}</Token><Command>${escapedCommand}</Command></msg>`;

  const soapMessage = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PostApisData xmlns="http://videcom.com/">
      <msg><![CDATA[${innerMsg}]]></msg>
    </PostApisData>
  </soap:Body>
</soap:Envelope>`;

  log("info", "SOAP message built successfully");
  log("info", "=== SOAP MESSAGE BUILD END ===");

  return soapMessage;
}

// Enviar comando VRS
async function sendVRSCommand(token, command) {
  log("info", "=== SENDING VRS COMMAND ===");

  try {
    const soapMessage = buildSOAPMessage(token, command);

    log("info", `Sending request to: ${VRS_CONFIG.BASE_URL}`);

    const response = await axios.post(VRS_CONFIG.BASE_URL, soapMessage, {
      headers: VRS_CONFIG.HEADERS,
      timeout: VRS_CONFIG.TIMEOUT,
      validateStatus: function (status) {
        return status < 600; // Aceitar qualquer status < 600 para debug
      },
    });

    log("info", `Response received - Status: ${response.status}`);
    log("info", `Response headers:`, response.headers);

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Log da resposta (truncado se muito grande)
    const responsePreview =
      typeof response.data === "string"
        ? response.data.length > 500
          ? response.data.substring(0, 500) + "..."
          : response.data
        : response.data;
    log("info", "Response data preview:", responsePreview);

    // Parse da resposta SOAP
    const parser = new xml2js.Parser({
      explicitArray: false,
      mergeAttrs: true,
      normalize: true,
      normalizeTags: true,
      trim: true,
      ignoreAttrs: false,
    });

    let parsedResponse;
    try {
      parsedResponse = await parser.parseStringPromise(response.data);
      log("info", "SOAP response parsed successfully");
    } catch (parseError) {
      log("warn", "Could not parse SOAP response as XML:", parseError.message);
      parsedResponse = response.data;
    }

    // Extrair resposta VRS
    let vrsResponse = extractVRSResponse(parsedResponse) || response.data;

    // Verificar erros VRS
    const vrsError = checkVRSErrors(vrsResponse);
    if (vrsError) {
      throw new Error(
        `VRS Error: ${vrsError} - ${getVRSErrorMessage(vrsError)}`
      );
    }

    log("info", "=== VRS COMMAND SUCCESS ===");
    return vrsResponse;
  } catch (error) {
    log("error", "VRS Command failed:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });

    throw error;
  }
}

// Extrair resposta VRS do SOAP
function extractVRSResponse(soapResult) {
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
      log("info", `VRS response extracted using path: ${path.join(".")}`);
      return current;
    }
  }

  return null;
}

// Verificar erros VRS na resposta
function checkVRSErrors(response) {
  const responseStr =
    typeof response === "string" ? response : JSON.stringify(response);

  for (const errorCode of Object.keys(VRS_ERROR_CODES)) {
    if (responseStr.includes(errorCode)) {
      return errorCode;
    }
  }

  return null;
}

// Extrair RLOC da resposta
function extractRLOC(response) {
  const responseStr =
    typeof response === "string" ? response : JSON.stringify(response);
  const rlocMatch = responseStr.match(/RLOC[:\s]*([A-Z0-9]{6})/i);
  return rlocMatch ? rlocMatch[1] : null;
}

// ROTAS DA API

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "VRS XML Service API",
    version: "1.0.0",
    status: "OK",
    timestamp: new Date().toISOString(),
    vrsEndpoint: VRS_CONFIG.BASE_URL,
    endpoints: {
      "GET /api/health": "Health check",
      "GET /api/test-token": "Test token validity",
      "POST /api/bookings": "Create booking",
      "POST /api/vrs-command": "Send custom VRS command",
    },
  });
});

// Teste de token
app.get("/api/test-token", validateToken, async (req, res) => {
  try {
    log("info", "Testing token with simple VRS command");

    // Comando simples para testar conexão
    const testCommand = "DIS";
    const response = await sendVRSCommand(req.token, testCommand);

    res.json({
      success: true,
      message: "Token is valid - VRS connection successful",
      tokenInfo: {
        length: req.token.length,
        masked: req.maskedToken,
      },
      testResponse: response,
    });
  } catch (error) {
    log("error", "Token test failed:", error.message);

    res.status(400).json({
      success: false,
      error: "Token validation failed",
      details: error.message,
      tokenInfo: {
        length: req.token.length,
        masked: req.maskedToken,
      },
    });
  }
});

// Criar booking
app.post("/api/bookings", validateToken, async (req, res) => {
  try {
    const { passengerName, email, title = "MR" } = req.body;

    log("info", "=== BOOKING REQUEST ===", {
      passengerName,
      email,
      title,
      tokenMasked: req.maskedToken,
    });

    // Validação dos dados
    if (!passengerName || !email) {
      return res.status(400).json({
        success: false,
        error: "Passenger name and email are required",
        code: "MISSING_REQUIRED_FIELDS",
        example: {
          passengerName: "Silva/JoaoMr",
          email: "joao.silva@email.com",
          title: "MR",
        },
      });
    }

    // Validação do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
        code: "INVALID_EMAIL",
      });
    }

    // Comando VRS para criar booking
    const command = `-1${passengerName}^9-1E*${email}^e*r~x`;
    log("info", `VRS Command: ${command}`);

    const response = await sendVRSCommand(req.token, command);
    const rloc = extractRLOC(response);

    res.json({
      success: true,
      message: "Booking created successfully",
      data: {
        passenger: {
          name: passengerName,
          email: email,
          title: title,
        },
        rloc: rloc,
        response: response,
      },
      tokenUsed: req.maskedToken,
    });
  } catch (error) {
    log("error", "Booking creation failed:", error.message);

    res.status(500).json({
      success: false,
      error: "Failed to create booking",
      details: error.message,
      code: "BOOKING_FAILED",
      tokenUsed: req.maskedToken,
    });
  }
});

// Comando VRS customizado
app.post("/api/vrs-command", validateToken, async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: "VRS command is required",
        code: "MISSING_COMMAND",
        example: {
          command: "DIS",
        },
      });
    }

    log("info", `Custom VRS command: ${command}`);

    const response = await sendVRSCommand(req.token, command);

    res.json({
      success: true,
      message: "VRS command executed successfully",
      command: command,
      response: response,
      tokenUsed: req.maskedToken,
    });
  } catch (error) {
    log("error", "VRS command failed:", error.message);

    res.status(500).json({
      success: false,
      error: "VRS command failed",
      details: error.message,
      code: "COMMAND_FAILED",
      tokenUsed: req.maskedToken,
    });
  }
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  log("error", "Unhandled error:", error.message);

  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: error.message,
    code: "INTERNAL_ERROR",
  });
});

// Middleware para rotas não encontradas
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    code: "NOT_FOUND",
    availableRoutes: [
      "GET /api/health",
      "GET /api/test-token",
      "POST /api/bookings",
      "POST /api/vrs-command",
    ],
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("\n🚀 VRS XML Service API Started Successfully!");
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🔗 VRS Endpoint: ${VRS_CONFIG.BASE_URL}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  console.log("\n📚 Available Endpoints:");
  console.log(`   GET  /api/health        - Health check`);
  console.log(`   GET  /api/test-token    - Test token validity`);
  console.log(`   POST /api/bookings      - Create booking`);
  console.log(`   POST /api/vrs-command   - Send custom VRS command`);
  console.log("\n💡 Token can be sent via:");
  console.log(`   - Authorization header: Bearer YOUR_TOKEN`);
  console.log(`   - x-api-token header: YOUR_TOKEN`);
  console.log(`   - Request body: {"token": "YOUR_TOKEN"}`);
  console.log(`   - Query parameter: ?token=YOUR_TOKEN`);
  console.log("\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  process.exit(0);
});

module.exports = app;
