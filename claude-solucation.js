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
  SOAPAction: "http://tempuri.org/PostVRSCommand",
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
    <PostVRSCommand xmlns="http://tempuri.org/">
      <msg>&lt;msg&gt;&lt;Token&gt;${token}&lt;/Token&gt;&lt;Command&gt;${escapedCommand}&lt;/Command&gt;&lt;/msg&gt;</msg>
    </PostVRSCommand>
  </soap:Body>
</soap:Envelope>`;
}

// Função auxiliar para fazer requisições à API VRS
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
    console.log("Response data:", response.data);

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
    });

    const soapResult = await parser.parseStringPromise(response.data);

    // Navegar pela estrutura SOAP response
    let vrsResponse;
    if (soapResult && soapResult["soap:envelope"]) {
      vrsResponse =
        soapResult["soap:envelope"]["soap:body"]["postvrscommandresponse"][
          "postvrscommandresult"
        ];
    } else if (soapResult && soapResult.envelope) {
      vrsResponse =
        soapResult.envelope.body.postvrscommandresponse.postvrscommandresult;
    } else {
      // Se não conseguir fazer parse SOAP, retorna a resposta bruta
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

// Middleware para validação de token
function validateToken(req, res, next) {
  const token =
    req.headers.authorization?.replace("Bearer ", "b") || req.body.token;
  if (!token) {
    return res.status(401).json({ error: "Token is required" });
  }
  req.token = token;
  next();
}

// 1. Endpoint para criar uma nova reserva (PNR)
app.post("/api/bookings", validateToken, async (req, res) => {
  try {
    const { passengerName, email, title = "MR" } = req.body;

    if (!passengerName || !email) {
      return res
        .status(400)
        .json({ error: "Passenger name and email are required" });
    }

    // Comando VRS para criar PNR com nome e email
    const command = `-1${passengerName}^9-1E*${email}^e*r~x`;

    const response = await sendVRSCommand(req.token, command);

    // Parse da resposta XML para extrair RLOC
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response);

    res.json({
      success: true,
      message: "Booking created successfully",
      data: result,
      rloc: result.PNR?.$?.RLOC || null,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create booking",
      details: error.message,
    });
  }
});

// 2. Endpoint para recuperar uma reserva existente
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

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response);

    res.json({
      success: true,
      data: result,
      rloc: rloc,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to retrieve booking",
      details: error.message,
    });
  }
});

// 3. Endpoint para adicionar comentário/observação à reserva
app.put("/api/bookings/:rloc/remarks", validateToken, async (req, res) => {
  try {
    const { rloc } = req.params;
    const { remark } = req.body;

    if (!rloc || !remark) {
      return res.status(400).json({ error: "RLOC and remark are required" });
    }

    // Comando VRS para adicionar observação e salvar
    const command = `*${rloc}^5*${remark}^E*R~x`;

    const response = await sendVRSCommand(req.token, command);

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response);

    res.json({
      success: true,
      message: "Remark added successfully",
      data: result,
      rloc: rloc,
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
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: "VRS command is required" });
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
    const { flightNumber, date, origin, destination } = req.body;

    if (!rloc || !flightNumber || !date || !origin || !destination) {
      return res.status(400).json({
        error: "RLOC, flight number, date, origin and destination are required",
      });
    }

    // Comando VRS para adicionar voo (exemplo genérico)
    const command = `*${rloc}^0${flightNumber}${date}${origin}${destination}^E*R~x`;

    const response = await sendVRSCommand(req.token, command);

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response);

    res.json({
      success: true,
      message: "Flight added successfully",
      data: result,
      rloc: rloc,
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

    const response = await sendVRSCommand(
      "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=",
      validationCommand
    );

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
