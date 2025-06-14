const express = require("express");
const axios = require("axios");
const qs = require("qs");

const app = express();
app.use(express.json());

// Configurações
const VRS_URL =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand";
const TOKEN = "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";

// Endpoint para buscar voos disponíveis
app.post("/search-flights", async (req, res) => {
  try {
    const { date, salesCity, startCity, journey, qtyseats } = req.body;

    // Monta o comando conforme exemplo
    // Exemplo: A16JULLOSABV[SalesCity=LOS,VARS=True,ClassBands=True,StartCity=LOS,SingleSeg=s,FGNoAv=True,qtyseats=1,journey=LOS-ABV]
    const commandDate =
      date.toUpperCase().replace(/-/g, "").slice(6, 8) +
      date.toUpperCase().slice(4, 7);
    // Exemplo transforma 2025-07-16 em 16JUL
    const command = `A${commandDate}${salesCity}${startCity}[SalesCity=${salesCity},VARS=True,ClassBands=True,StartCity=${startCity},SingleSeg=s,FGNoAv=True,qtyseats=${
      qtyseats || 1
    },journey=${journey}]`;

    // Dados para enviar via application/x-www-form-urlencoded
    const data = qs.stringify({
      Token: TOKEN,
      Command: command,
    });

    const response = await axios.post(VRS_URL, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // Retorna o XML da resposta
    res.set("Content-Type", "text/xml");
    res.send(response.data);
  } catch (error) {
    console.error("Erro na requisição:", error.message);
    res.status(500).json({ error: "Erro ao buscar voos" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
