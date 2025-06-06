const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
const PORT = 3000;

// Exemplo de token, IP e sinecode - substitua pelos reais
const VRS_ENDPOINT = "https://api.videcom.com/vrsxml";
const VRS_TOKEN = "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";

app.get("/availability", async (req, res) => {
  try {
    // Construa a mensagem XML para enviar
    const xmlMessage = `
            <msg>
                <Token>${VRS_TOKEN}</Token>
                <Command>A20NOVLOSABV[SalesCity=LOS,VARS=True,ClassBands=True,StartCity=LOS,SingleSeg=s,FGNoAv=True,qtyseats=1,journey=LOS-ABV]</Command>
            </msg>
        `;

    // Envie a requisição para o endpoint do VRS
    const response = await axios.post(VRS_ENDPOINT, xmlMessage, {
      headers: {
        "Content-Type": "application/xml",
      },
    });

    // Parse da resposta XML
    xml2js.parseString(response.data, (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao processar XML" });
      }
      return res.json(result);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao consultar VRS" });
  }
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
