const express = require("express");
const axios = require("axios");

const app = express();
const PORT = 3000;

// Middleware para permitir JSON (não necessário para SOAP, mas útil)
app.use(express.json());

app.get("/call-soap-api", async (req, res) => {
  const soapEnvelope = `
  <?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <Command xmlns="http://videcom.com/">user</Command>
      <Token xmlns="http://videcom.com/">E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=</Token>
    </soap:Body>
  </soap:Envelope>`;

  try {
    const { data } = await axios.post(
      "https://customertest3.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx",
      soapEnvelope,
      {
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://videcom.com/PostVRSCommand",
        },
      }
    );

    // Retorna resposta SOAP
    res.set("Content-Type", "text/xml");
    res.send(data);
  } catch (error) {
    console.error("Erro ao chamar o serviço SOAP:", error.message);
    res.status(500).json({ error: "Erro ao chamar serviço SOAP" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
