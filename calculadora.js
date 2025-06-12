const express = require("express");
const soap = require("soap");

const app = express();
const PORT = 3000;

// URL do WSDL de teste (calculadora)
const url = "http://www.dneonline.com/calculator.asmx?WSDL";

// Endpoint de teste
app.get("/soma", async (req, res) => {
  try {
    const { a, b } = req.query;

    // Verificação simples dos parâmetros
    if (!a || !b) {
      return res.status(400).json({ error: "Informe os parâmetros a e b" });
    }

    // Criação do cliente SOAP
    const client = await soap.createClientAsync(url);

    // Chamada do método Add
    const result = await client.AddAsync({
      intA: parseInt(a),
      intB: parseInt(b),
    });

    res.json({
      resultado: result[0].AddResult,
    });
  } catch (error) {
    console.error("Erro ao chamar o serviço SOAP:", error);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
