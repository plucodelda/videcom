const express = require("express");
const axios = require("axios");
const qs = require("qs");
const { XMLParser } = require("fast-xml-parser");

const app = express();
app.use(express.json());

// Configurações
const VRS_URL =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand";
const TOKEN = "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";

// Middleware para validação de entrada
const validateFlightSearch = (req, res, next) => {
  const { date, salesCity, startCity, journey } = req.body;

  if (!date || !salesCity || !startCity || !journey) {
    return res.status(400).json({
      error:
        "Parâmetros obrigatórios faltando: date, salesCity, startCity, journey",
    });
  }

  // Validação simples do formato da data (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: "Formato de data inválido. Use YYYY-MM-DD",
    });
  }

  next();
};

// Endpoint para buscar voos disponíveis
app.post("/search-flights", validateFlightSearch, async (req, res) => {
  try {
    const { date, salesCity, startCity, journey, qtyseats = 1 } = req.body;

    // Formata a data para o padrão do comando (ex: "16JUL")
    const formattedDate = formatCommandDate(date);

    // Monta o comando VRS
    const command = buildVRSCommand({
      date: formattedDate,
      salesCity,
      startCity,
      journey,
      qtyseats,
    });

    // Envia a requisição para o VRS
    const vrsResponse = await sendVRSRequest(command);

    // Converte XML para JSON
    const parser = new XMLParser();
    const jsonResponse = parser.parse(vrsResponse.data);

    // Formata a resposta para o cliente
    const formattedResponse = formatFlightResponse(jsonResponse);

    res.json(formattedResponse);
  } catch (error) {
    console.error("Erro na requisição:", error.message);

    if (error.response) {
      // Erro da API VRS
      console.error("Detalhes do erro:", error.response.data);
      res.status(502).json({
        error: "Erro na comunicação com o provedor de voos",
        details: error.response.data,
      });
    } else {
      res.status(500).json({
        error: "Erro interno no servidor",
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
    timeout: 10000, // 10 segundos de timeout
  });
}

function formatFlightResponse(vrsData) {
  // Implemente a formatação da resposta conforme necessário
  // Exemplo simplificado:
  if (!vrsData || !vrsData.string) {
    throw new Error("Resposta do VRS em formato inesperado");
  }

  try {
    return JSON.parse(vrsData.string);
  } catch (e) {
    // Se não for JSON válido, retorna o XML como fallback
    return { xml: vrsData.string };
  }
}

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Erro não tratado:", err);
});
