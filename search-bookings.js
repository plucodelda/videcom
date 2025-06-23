const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
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

    // Converte XML para JSON (se a resposta for XML)
    if (response.headers["content-type"].includes("xml")) {
      const parser = new xml2js.Parser({ explicitArray: false });
      parser.parseString(response.data, (err, result) => {
        if (err) {
          console.error("Erro ao converter XML para JSON:", err);
          return res.status(500).json({ error: "Erro ao converter resposta" });
        }
        res.json(result);
      });
    } else {
      // Se não for XML, retorna a resposta diretamente
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
