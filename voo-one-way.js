const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
app.use(express.json());

const VRS_API_URL = "https://customertest.videcom.com/xmlapi"; // Substitua pela URL real
const TOKEN = process.env.TOKEN; // Fornecido pela Videcom

// Função para converter XML para JSON
const parseXml = async (xml) => {
  const parser = new xml2js.Parser({ explicitArray: false });
  return parser.parseStringPromise(xml);
};

// Endpoint para buscar disponibilidade e preço
app.post("/vrs/availability", async (req, res) => {
  const { date, origin, destination, seats = 1 } = req.body;

  if (!date || !origin || !destination) {
    return res.status(400).json({
      error: "Campos obrigatórios: date, origin, destination",
    });
  }

  // Formata a data para o formato da API: DDMMM (ex: 20NOV)
  const day = new Date(date).getDate().toString().padStart(2, "0");
  const month = new Date(date)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase();
  const dateFormatted = `${day}${month}`;

  const command = `A${dateFormatted}${origin}${destination}[SalesCity=${origin},VARS=True,ClassBands=True,StartCity=${origin},SingleSeg=s,FGNoAv=True,qtyseats=${seats},journey=${origin}-${destination}]`;

  const xmlRequest = `
<msg>
  <Token>${TOKEN}</Token>
  <Command>${command}</Command>
</msg>`;

  try {
    const response = await axios.post(VRS_API_URL, xmlRequest, {
      headers: { "Content-Type": "application/xml" },
    });

    const json = await parseXml(response.data);

    res.json({
      success: true,
      command,
      result: json,
    });
  } catch (error) {
    res.status(500).json({
      error: "Erro ao consultar disponibilidade",
      details: error.response?.data || error.message,
    });
  }
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
