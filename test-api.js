const express = require("express");
const axios = require("axios");
const app = express();
const PORT = 3000;

app.get("/send-soap", async (req, res) => {
  const url =
    "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx";

  const xmlData = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
       <msg xmlns="http://videcom.com/">
         <Token>E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=</Token>
         <Command>zuser</Command>
       </msg>
    </soap:Body>
  </soap:Envelope>`;

  try {
    const response = await axios.post(url, xmlData, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        // Intencionalmente sem SOAPAction
      },
    });

    res.status(200).send(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).send({
        status: error.response.status,
        message: error.response.statusText,
        data: error.response.data,
      });
    } else {
      res.status(500).send({ message: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
