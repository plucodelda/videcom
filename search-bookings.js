const express = require("express");
const axios = require("axios");
const app = express();
const port = 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Rota para fazer a requisição POST e converter para JSON
app.post("/send-command", async (req, res) => {
  try {
    // Faz a requisição para o serviço VRS
    const response = await axios.post(
      "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand",
      "Token=E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=&Command=*ZZZB2L~x",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // Processa a resposta aninhada
    if (response.data && response.data.string && response.data.string._) {
      try {
        // Parseia o JSON interno
        const innerJson = JSON.parse(response.data.string._);

        // Retorna o JSON parseado
        res.json({
          success: true,
          data: innerJson,
          metadata: {
            xmlns: response.data.string.$.xmlns,
          },
        });
      } catch (parseError) {
        console.error("Erro ao parsear JSON interno:", parseError);
        res.status(500).json({
          error: "Erro ao processar a resposta",
          originalResponse: response.data,
        });
      }
    } else {
      res.json(response.data);
    }
  } catch (error) {
    console.error("Erro na requisição:", error);
    res.status(500).json({
      error: "Erro ao processar a requisição",
      details: error.message,
    });
  }
});

// Rota GET para teste
app.get("/", (req, res) => {
  res.json({
    message: "API para enviar comandos VRS",
    endpoints: {
      POST: "/send-command",
    },
  });
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
