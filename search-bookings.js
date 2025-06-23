const express = require("express");
const axios = require("axios");
const app = express();
const port = 3000;

// Middleware para parsear application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// Rota para fazer a requisição POST
app.post("/send-command", async (req, res) => {
  try {
    const response = await axios.post(
      "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx/PostVRSCommand",
      "Token=E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=&Command=*ZZZB2L~x",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error("Erro na requisição:", error);
    res.status(500).json("Erro ao processar a requisição");
  }
});

// Rota GET para testar (opcional)
app.get("/", (req, res) => {
  res.send(`
        <h1>Enviar comando VRS</h1>
        <form action="/send-command" method="post">
            <button type="submit">Enviar Comando</button>
        </form>
    `);
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
