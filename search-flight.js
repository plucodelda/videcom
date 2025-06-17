require("dotenv").config();
const express = require("express");
const axios = require("axios");
const qs = require("qs");
const { XMLParser } = require("fast-xml-parser");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());

// Configurações
const VRS_URL =
  process.env.VRS_URL ||
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand";
const TOKEN =
  process.env.VRS_TOKEN || "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";
const IBE_BASE_URL =
  process.env.IBE_BASE_URL ||
  "https://customertest.videcom.com/fastjet/VARS/Public";
const PORT = process.env.PORT || 3000;

// Rate limiting (100 requests por minuto)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  message: "Muitas requisições. Por favor, tente novamente mais tarde.",
});

// Middlewares
app.use(limiter);
app.use((req, res, next) => {
  res.setHeader("X-Request-ID", uuidv4());
  next();
});

// Validação de entrada
const validateFlightSearch = (req, res, next) => {
  const requiredFields = ["date", "origin", "destination", "passengers"];
  const missingFields = requiredFields.filter((field) => !req.body[field]);

  if (missingFields.length > 0) {
    return res.status(400).json({
      error: `Parâmetros obrigatórios faltando: ${missingFields.join(", ")}`,
      code: "MISSING_PARAMETERS",
    });
  }

  // Validação de data (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.date)) {
    return res.status(400).json({
      error: "Formato de data inválido. Use YYYY-MM-DD",
      code: "INVALID_DATE_FORMAT",
    });
  }

  // Validação de passageiros
  if (req.body.passengers < 1 || req.body.passengers > 9) {
    return res.status(400).json({
      error: "Número de passageiros deve ser entre 1 e 9",
      code: "INVALID_PASSENGER_COUNT",
    });
  }

  next();
};

// Cache simples em memória
const cache = new Map();
const CACHE_TTL = 30000; // 30 segundos

// Endpoint principal de busca de voos
app.post("/api/flights/search", validateFlightSearch, async (req, res) => {
  try {
    const {
      date,
      origin,
      destination,
      passengers,
      currency = "USD",
      language = "en",
      tripType = "OneWay",
    } = req.body;

    // Verifica cache
    const cacheKey = `${date}-${origin}-${destination}-${passengers}-${currency}-${language}`;
    if (
      cache.has(cacheKey) &&
      Date.now() - cache.get(cacheKey).timestamp < CACHE_TTL
    ) {
      return res.json(cache.get(cacheKey).data);
    }

    // Formata comando VRS
    const formattedDate = formatCommandDate(date);
    const command = buildVRSCommand({
      date: formattedDate,
      salesCity: origin,
      startCity: origin,
      journey: `${origin}-${destination}`,
      qtyseats: passengers,
    });

    // Chama API VRS
    const vrsResponse = await sendVRSRequest(command);
    const parser = new XMLParser();
    const jsonResponse = parser.parse(vrsResponse.data);

    // Formata resposta
    const responseData = await formatFlightResponse({
      vrsData: jsonResponse,
      searchParams: {
        date,
        origin,
        destination,
        passengers,
        currency,
        language,
        tripType,
      },
    });

    // Atualiza cache
    cache.set(cacheKey, {
      timestamp: Date.now(),
      data: responseData,
    });

    res.json(responseData);
  } catch (error) {
    console.error(`[${res.getHeader("X-Request-ID")}] Erro:`, error.message);

    if (error.response) {
      res.status(502).json({
        error: "Erro na comunicação com o provedor de voos",
        code: "VRS_ERROR",
        details: error.response.data,
      });
    } else {
      res.status(500).json({
        error: "Erro interno no servidor",
        code: "INTERNAL_ERROR",
        requestId: res.getHeader("X-Request-ID"),
      });
    }
  }
});

// Funções auxiliares
function formatCommandDate(dateString) {
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, "0");
  const month = months[date.getMonth()];
  return `${day}${month}`;
}

function buildVRSCommand({ date, salesCity, startCity, journey, qtyseats }) {
  return `A${date}${salesCity}${startCity}[SalesCity=${salesCity},VARS=True,ClassBands=True,StartCity=${startCity},SingleSeg=s,FGNoAv=True,qtyseats=${qtyseats},journey=${journey}]`;
}

async function sendVRSRequest(command) {
  const data = qs.stringify({
    Token: TOKEN,
    Command: command,
  });

  return await axios.post(VRS_URL, data, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/xml",
    },
    timeout: 10000,
  });
}

async function formatFlightResponse({ vrsData, searchParams }) {
  try {
    // Parse dos dados dos voos
    const flights = JSON.parse(vrsData.string);

    // Geração dos links
    const deepLink = generateDeepLink(searchParams);
    const shallowLink = generateShallowLink(searchParams);

    return {
      status: "success",
      data: {
        flights,
        booking_links: {
          deep_link: deepLink,
          shallow_link: shallowLink,
          mobile_friendly: shallowLink, // Recomendamos usar shallow para mobile
        },
        search_parameters: searchParams,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (e) {
    console.error("Erro ao formatar resposta:", e);
    throw new Error("Não foi possível processar os dados dos voos");
  }
}

function generateDeepLink({
  date,
  origin,
  destination,
  passengers,
  currency,
  language,
  tripType,
}) {
  const params = new URLSearchParams({
    Adult: passengers,
    Child: 0,
    Infant: 0,
    UserLanguage: language,
    UserCurrency: currency,
    DisplayedPriceCurrency: currency,
    TripType: tripType,
    Cabin1: "Economy",
    DepartureDate1: date,
    Origin1: origin,
    Destination1: destination,
  });

  return `${IBE_BASE_URL}/deeplink.aspx?${params.toString()}`;
}

function generateShallowLink({
  date,
  origin,
  destination,
  passengers,
  currency,
  language,
  tripType,
}) {
  const formattedDate = formatShallowLinkDate(date);
  const tripTypeParam =
    tripType === "RoundTrip" ? "chkJourneyTypeReturn" : "chkJourneyTypeOneWay";

  const params = new URLSearchParams({
    ReturnTrip: tripTypeParam,
    orig: origin,
    dest: destination,
    departs: formattedDate,
    ad: passengers,
    ch: 0,
    in: 0,
    currency: currency,
    lang: language,
  });

  return `${IBE_BASE_URL}/shallowlink.aspx?${params.toString()}`;
}

function formatShallowLinkDate(dateString) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const date = new Date(dateString);
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${month}${year}`;
}

// Health Check e métricas
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

// Endpoint de exemplo
app.get("/", (req, res) => {
  res.json({
    service: "Flight Search API",
    version: "1.0.0",
    endpoints: {
      search: "POST /api/flights/search",
      health: "GET /health",
    },
  });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error(`[${req.id}] Erro não tratado:`, err);
  res.status(500).json({
    error: "Erro interno no servidor",
    code: "SERVER_ERROR",
    requestId: req.id,
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Erro não tratado:", err);
});
