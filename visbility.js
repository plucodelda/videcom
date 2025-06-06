const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
var morgan = require("morgan");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(morgan("combined"));

// ✅ Endpoint correto com o código da companhia
const API_URL =
  "https://customer3.videcom.com/fastjet/vrsxmlservice/VrsXmlWebService3.asmx";
const TOKEN = process.env.TOKEN;
const parser = new xml2js.Parser({ explicitArray: false });

function buildVRSCommand({
  origin,
  destination,
  date,
  paxCount,
  isReturn,
  returnDate,
}) {
  const journey = `${origin}-${destination}${isReturn ? `-${origin}` : ""}`;
  const singleSeg = isReturn ? "r" : "s";

  const commands = [];

  const ida = `A${date}${origin}${destination}[SalesCity=${origin},VARS=True,ClassBands=True,StartCity=${origin},SingleSeg=${singleSeg},FGNoAv=True,qtyseats=${paxCount},journey=${journey}]`;
  commands.push(ida);

  if (isReturn && returnDate) {
    const volta = `A${returnDate}${destination}${origin}[SalesCity=${destination},VARS=True,ClassBands=True,StartCity=${origin},SingleSeg=${singleSeg},FGNoAv=True,qtyseats=${paxCount},journey=${journey},DEPART=${date}]`;
    commands.push(volta);
  }

  return commands.join("^");
}

// 2. Disponibilidade de Voos e Tarifas
// GET /flights/availability
// Consulta voos disponíveis com preços (one-way ou ida e volta)
// Parâmetros: origin, destination, date, paxCount, etc.

app.get("/flights/availability", async (req, res) => {
  const {
    origin,
    destination,
    date,
    paxCount = 1,
    isReturn = false,
    returnDate,
  } = req.query;

  if (!origin || !destination || !date) {
    return res
      .status(400)
      .json({ error: "Parâmetros obrigatórios: origin, destination, date" });
  }

  const command = buildVRSCommand({
    origin,
    destination,
    date,
    paxCount,
    isReturn: isReturn === "true",
    returnDate,
  });

  const xml = `
    <msg>
      <Token>${TOKEN}</Token>
      <Command>${command}~x</Command>
    </msg>
  `;

  try {
    const response = await axios.post(API_URL, xml.trim(), {
      headers: { "Content-Type": "text/xml" },
    });

    parser.parseString(response.data, (err, result) => {
      if (err) {
        console.error("Erro ao converter XML:", err);
        return res
          .status(500)
          .json({ error: "Erro ao processar resposta da Videcom" });
      }
      return res.status(200).json(result);
    });
  } catch (error) {
    console.error("Erro ao consultar voos:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Headers:", error.response.headers);
      console.error("Body:", error.response.data);
      return res.status(500).json({
        error: "Erro na resposta da API Videcom",
        status: error.response.status,
        details: error.response.data,
      });
    } else if (error.request) {
      console.error("Sem resposta da Videcom:", error.request);
      return res.status(500).json({ error: "Sem resposta da Videcom" });
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
