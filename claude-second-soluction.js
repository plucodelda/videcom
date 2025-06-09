const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const app = express();

app.use(express.json());

// Configuração base da API VRS
const VRS_BASE_URL =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx";
const VRS_ENDPOINT = "PostVRSCommand";
const DEFAULT_HEADERS = {
  "Content-Type": "text/xml; charset=utf-8",
  Accept: "application/xml",
  SOAPAction: '"http://videcom.com/PostApisData"',
};

// Função para mapear erros VRS
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

// Função auxiliar para construir mensagem SOAP XML
function buildSOAPMessage(token, command) {
  // Validar token
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

  // Construir a mensagem interna sem double encoding
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

// Função auxiliar melhorada para fazer requisições à API VRS
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

// Função para extrair RLOC da resposta VRS
function extractRLOC(response) {
  if (typeof response === "string") {
    // Tentar extrair RLOC usando regex se a resposta for string
    const rlocMatch = response.match(/RLOC[=\s]*["']?([A-Z0-9]{6})["']?/i);
    if (rlocMatch) {
      return rlocMatch[1];
    }

    // Tentar outros padrões
    const pnrMatch = response.match(/PNR[=\s]*["']?([A-Z0-9]{6})["']?/i);
    if (pnrMatch) {
      return pnrMatch[1];
    }
  } else if (typeof response === "object") {
    // Tentar extrair de objeto
    if (response.PNR && response.PNR.$ && response.PNR.$.RLOC) {
      return response.PNR.$.RLOC;
    }

    // Buscar recursivamente por RLOC
    function findRLOC(obj) {
      if (typeof obj === "object" && obj !== null) {
        if (obj.RLOC) return obj.RLOC;
        if (obj.rloc) return obj.rloc;

        for (const value of Object.values(obj)) {
          const found = findRLOC(value);
          if (found) return found;
        }
      }
      return null;
    }

    return findRLOC(response);
  }

  return null;
}

// Middleware para validação de token
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

// 1. Endpoint para criar uma nova reserva (PNR) - CORRIGIDO
app.post("/api/bookings", validateToken, async (req, res) => {
  try {
    const {
      passengerName, // Obrigatório: Nome do passageiro (ex: "test/testMr")
      email, // Obrigatório: Email do passageiro (ex: "test@videcom.com")
      title = "MR", // Opcional: Título (MR, MRS, MS, etc.)
    } = req.body;

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

    // Comando VRS para criar PNR com nome e email
    const command = `-1${passengerName}^9-1E*${email}^e*r~x`;

    // Verificar se há erro na resposta antes de processar
    if (
      typeof response === "object" &&
      response._ &&
      response._.includes("Error")
    ) {
      return res.status(400).json({
        error: "VRS API Error",
        vrsError: response._,
        details: getVRSErrorMessage(response._),
        hint:
          response._ === "Error 102"
            ? "Check if your token is valid and properly formatted"
            : null,
      });
    }

    // Tentar fazer parse da resposta se for XML
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
      rawResponse: response, // Para debug
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create booking",
      details: error.message,
    });
  }
});

// 2. Endpoint para recuperar uma reserva existente - CORRIGIDO
app.get("/api/bookings/:rloc", validateToken, async (req, res) => {
  try {
    const { rloc } = req.params;

    if (!rloc) {
      return res
        .status(400)
        .json({ error: "RLOC (Record Locator) is required" });
    }

    // Comando VRS para recuperar booking
    const command = `*${rloc}~x`;

    const response = await sendVRSCommand(req.token, command);

    // Tentar fazer parse da resposta se for XML
    let parsedResponse = response;
    try {
      if (typeof response === "string" && response.includes("<")) {
        const parser = new xml2js.Parser({ explicitArray: false });
        parsedResponse = await parser.parseStringPromise(response);
      }
    } catch (parseError) {
      console.log(
        "Could not parse response as XML, using raw response:",
        parseError.message
      );
    }

    res.json({
      success: true,
      data: parsedResponse,
      rloc: rloc,
      rawResponse: response, // Para debug
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to retrieve booking",
      details: error.message,
    });
  }
});

// 3. Endpoint para adicionar comentário/observação à reserva - CORRIGIDO
app.put("/api/bookings/:rloc/remarks", validateToken, async (req, res) => {
  try {
    const { rloc } = req.params;
    const {
      remark, // Obrigatório: Texto da observação (ex: "Passenger Booked from Website")
    } = req.body;

    if (!rloc || !remark) {
      return res.status(400).json({
        error: "RLOC and remark are required",
        example: {
          remark: "Passenger Booked from Website",
        },
      });
    }

    // Comando VRS para adicionar observação e salvar
    const command = `*${rloc}^5*${remark}^E*R~x`;

    const response = await sendVRSCommand(req.token, command);

    // Tentar fazer parse da resposta se for XML
    let parsedResponse = response;
    try {
      if (typeof response === "string" && response.includes("<")) {
        const parser = new xml2js.Parser({ explicitArray: false });
        parsedResponse = await parser.parseStringPromise(response);
      }
    } catch (parseError) {
      console.log(
        "Could not parse response as XML, using raw response:",
        parseError.message
      );
    }

    res.json({
      success: true,
      message: "Remark added successfully",
      data: parsedResponse,
      rloc: rloc,
      rawResponse: response, // Para debug
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to add remark",
      details: error.message,
    });
  }
});

// 4. Endpoint para executar comando VRS customizado
app.post("/api/vrs/command", validateToken, async (req, res) => {
  try {
    const {
      command, // Obrigatório: Comando VRS (ex: "*ABC123~x", "-1Silva/JoaoMr^e*r~x")
    } = req.body;

    if (!command) {
      return res.status(400).json({
        error: "VRS command is required",
        examples: [
          "*ABC123~x - Retrieve booking ABC123",
          "-1Silva/JoaoMr^9-1E*joao@email.com^e*r~x - Create new booking",
          "*ABC123^5*Booked online^E*R~x - Add remark to booking",
        ],
      });
    }

    const response = await sendVRSCommand(req.token, command);

    res.json({
      success: true,
      command: command,
      response: response,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to execute VRS command",
      details: error.message,
    });
  }
});

// 5. Endpoint para buscar informações de voo
app.get("/api/flights/search", validateToken, async (req, res) => {
  try {
    const { origin, destination, date } = req.query;

    if (!origin || !destination || !date) {
      return res.status(400).json({
        error: "Origin, destination and date are required",
      });
    }

    // Comando VRS para buscar voos (exemplo genérico)
    const command = `AN${date}${origin}${destination}~x`;

    const response = await sendVRSCommand(req.token, command);

    res.json({
      success: true,
      searchCriteria: { origin, destination, date },
      flights: response,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to search flights",
      details: error.message,
    });
  }
});

// 6. Endpoint para adicionar voo à reserva
app.post("/api/bookings/:rloc/flights", validateToken, async (req, res) => {
  try {
    const { rloc } = req.params;
    const {
      flightNumber, // Obrigatório: Número do voo (ex: "VL101")
      date, // Obrigatório: Data do voo formato DDMMM (ex: "15JAN")
      origin, // Obrigatório: Código aeroporto origem (ex: "LOS")
      destination, // Obrigatório: Código aeroporto destino (ex: "ABV")
      classOfService = "Y", // Opcional: Classe de serviço (Y, C, F, etc.)
    } = req.body;

    if (!rloc || !flightNumber || !date || !origin || !destination) {
      return res.status(400).json({
        error: "RLOC, flight number, date, origin and destination are required",
        example: {
          flightNumber: "VL101",
          date: "15JAN",
          origin: "LOS",
          destination: "ABV",
          classOfService: "Y",
        },
      });
    }

    // Comando VRS para adicionar voo (formato baseado na documentação)
    const command = `*${rloc}^0${flightNumber}${classOfService}${date}${origin}${destination}^E*R~x`;

    const response = await sendVRSCommand(req.token, command);

    // Tentar fazer parse da resposta se for XML
    let parsedResponse = response;
    try {
      if (typeof response === "string" && response.includes("<")) {
        const parser = new xml2js.Parser({ explicitArray: false });
        parsedResponse = await parser.parseStringPromise(response);
      }
    } catch (parseError) {
      console.log(
        "Could not parse response as XML, using raw response:",
        parseError.message
      );
    }

    res.json({
      success: true,
      message: "Flight added successfully",
      data: parsedResponse,
      rloc: rloc,
      rawResponse: response, // Para debug
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to add flight",
      details: error.message,
    });
  }
});

// 7. Endpoint de health check / status da API
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "VRS XML Service API",
    vrsEndpoint: VRS_BASE_URL,
  });
});

// 8. Endpoint para testar conexão VRS
app.post("/api/vrs/test", validateToken, async (req, res) => {
  try {
    // Comando simples para testar conectividade
    const testCommand = "H"; // Help command ou similar

    const response = await sendVRSCommand(req.token, testCommand);

    res.json({
      success: true,
      message: "VRS connection test successful",
      response: response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: "VRS connection test failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// 9. Endpoint para validar token
app.post("/api/auth/validate", validateToken, async (req, res) => {
  try {
    // Comando mínimo para validar token
    const validationCommand = "I"; // Info command

    const response = await sendVRSCommand(req.token, validationCommand);

    // Verificar se há erro na resposta
    if (
      typeof response === "object" &&
      response._ &&
      response._.includes("Error")
    ) {
      return res.status(401).json({
        error: "Invalid token or authentication failed",
        vrsError: response._,
        details: getVRSErrorMessage(response._),
      });
    }

    res.json({
      success: true,
      message: "Token is valid",
      response: response,
    });
  } catch (error) {
    res.status(401).json({
      error: "Invalid token or authentication failed",
      details: error.message,
    });
  }
});

// 10. Endpoint para debug do token e SOAP message
app.post("/api/debug/soap", validateToken, async (req, res) => {
  try {
    const { command = "I" } = req.body; // Comando de info por padrão

    const soapMessage = buildSOAPMessage(req.token, command);

    res.json({
      success: true,
      token:
        req.token.substring(0, 10) +
        "..." +
        req.token.substring(req.token.length - 5),
      command: command,
      soapMessage: soapMessage,
      messageLength: soapMessage.length,
      vrsEndpoint: VRS_BASE_URL,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to build SOAP message",
      details: error.message,
    });
  }
});

// 11. Endpoint para testar comando básico sem parse complexo
app.post("/api/vrs/simple-test", validateToken, async (req, res) => {
  try {
    const testCommand = "I"; // Comando de informação básica

    const soapMessage = buildSOAPMessage(req.token, testCommand);

    console.log("Testing with token:", req.token.substring(0, 10) + "...");
    console.log("SOAP Message:", soapMessage);

    const response = await axios.post(VRS_BASE_URL, soapMessage, {
      headers: DEFAULT_HEADERS,
      timeout: 30000,
      validateStatus: function (status) {
        return status < 600;
      },
    });

    console.log("Raw response:", response.data);

    res.json({
      success: response.status < 400,
      status: response.status,
      statusText: response.statusText,
      response: response.data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Simple test error:", error.message);
    res.status(500).json({
      error: "Simple test failed",
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
app.post("/api/auth/validate", validateToken, async (req, res) => {
  try {
    // Comando mínimo para validar token
    const validationCommand = "I"; // Info command

    const response = await sendVRSCommand(req.token, validationCommand);

    res.json({
      success: true,
      message: "Token is valid",
      response: response,
    });
  } catch (error) {
    res.status(401).json({
      error: "Invalid token or authentication failed",
      details: error.message,
    });
  }
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  console.error("API Error:", error);

  // Mapear códigos de erro VRS
  const vrsErrorCodes = {
    101: "Not HTTPS",
    102: "No Token",
    103: "Invalid Token",
    104: "Invalid Agent sine",
    105: "No IP configured for Agent",
    106: "Invalid IP",
    107: "ApiIpAddress missing from Agent table",
  };

  res.status(500).json({
    error: "Internal server error",
    message: vrsErrorCodes[error.code] || error.message,
  });
});

// Inicializar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VRS XML Service API running on port ${PORT}`);
  console.log(`Connected to: ${VRS_BASE_URL}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`\nAPI Documentation:`);
  console.log(`POST /api/bookings - Create new booking`);
  console.log(`GET /api/bookings/:rloc - Retrieve booking`);
  console.log(`PUT /api/bookings/:rloc/remarks - Add remark to booking`);
  console.log(`POST /api/vrs/command - Execute custom VRS command`);
  console.log(`GET /api/flights/search - Search flights`);
  console.log(`POST /api/bookings/:rloc/flights - Add flight to booking`);
  console.log(`POST /api/debug/soap - Debug SOAP message generation`);
  console.log(`POST /api/vrs/simple-test - Simple VRS connection test`);
  console.log(`POST /api/auth/validate - Validate token`);
});

module.exports = app;
