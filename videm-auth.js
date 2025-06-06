const express = require("express");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(express.json());

// Rota para autenticação
app.post("/auth/token", async (req, res) => {
  const { sineCode, password, ipAddress } = req.body;

  if (!sineCode || !password || !ipAddress) {
    return res
      .status(400)
      .json({ error: "Campos obrigatórios: sineCode, password, ipAddress" });
  }

  try {
    // Simulando envio para Videcom (substitua com a URL real)
    const response = await axios.post(
      "https://customertest.videcom.com/AIR/xmlgateway.aspx",
      {
        sineCode,
        password,
        ipAddress,
      }
    );

    const token = response.data.token; // supondo que venha assim
    return res.status(200).json({ token });
  } catch (error) {
    console.error("Erro ao autenticar:", error.message);
    return res.status(500).json({ error: "Falha na autenticação com Videcom" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
