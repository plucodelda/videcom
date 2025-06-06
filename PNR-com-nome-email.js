const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
var morgan = require("morgan");

const app = express();
app.use(express.json()); // Para receber JSON no corpo da requisição
app.use(morgan("combined"));

// ⚠️ Configure essas variáveis com seus dados reais:
const VRS_API_URL = "https://api.videcom.com/xmlservice/api.asmx"; // Substitua pela URL real da Videcom
const TOKEN = process.env.TOKEN; // Substitua pelo token fornecido

// Utilitário para converter XML em JSON
const parseXml = async (xml) => {
  const parser = new xml2js.Parser({ explicitArray: false });
  return parser.parseStringPromise(xml);
};

// Endpoint para enviar comando VRS
app.post("/vrs/command", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Campo "command" é obrigatório' });
  }

  const xmlRequest = `
<msg>
  <Token>${TOKEN}</Token>
  <Command>${command}</Command>
</msg>`;

  try {
    const response = await axios.post(VRS_API_URL, xmlRequest, {
      headers: { "Content-Type": "application/xml" },
    });

    const xml = response.data;
    const json = await parseXml(xml);

    res.json({
      success: true,
      command,
      response: json,
    });
  } catch (error) {
    res.status(500).json({
      error: "Erro ao enviar comando VRS",
      details: error.response?.data || error.message,
    });
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
