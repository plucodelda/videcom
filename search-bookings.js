const express = require("express");
const axios = require("axios");
const app = express();
const port = 3000;

app.use(express.json());

app.post("/process-pnr", async (req, res) => {
  try {
    const { bookingReference } = req.body;
    // Faz a requisição para o serviço VRS
    const response = await axios.post(
      "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand",
      `Token=E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=&Command=*${bookingReference}~x`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // Extrai o conteúdo XML e processa a string JSON interna
    const xmlContent = response.data;
    const jsonString = xmlContent.match(/<string[^>]*>([\s\S]*?)<\/string>/)[1];
    const pnrData = JSON.parse(jsonString);

    // Retorna o JSON organizado
    res.json({
      success: true,
      data: pnrData.PNR, // Acessa diretamente o objeto PNR
      metadata: {
        timestamp: new Date().toISOString(),
        source: "VRS XML Service",
      },
    });
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
