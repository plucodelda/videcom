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

// Função auxiliar para construir mensagem SOAP XML
function buildSOAPMessage(token, command) {
  // Escapar caracteres especiais no comando
  const escapedCommand = command
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
               xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PostApisData xmlns="http://videcom.com/">
      <msg>&lt;msg&gt;&lt;Token&gt;${token}&lt;/Token&gt;&lt;Command&gt;${escapedCommand}&lt;/Command&gt;&lt;/msg&gt;</msg>
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
  const token =
    req.headers.authorization?.replace("Bearer ", "") || req.body.token;
  if (!token) {
    return res.status(401).json({ error: "Token is required" });
  }
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

    const response = await sendVRSCommand(req.token, command);

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
});

module.exports = app;
