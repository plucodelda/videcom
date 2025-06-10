const axios = require("axios");

const url =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx";

const soapEnvelope = `
<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <Command xmlns="http://videcom.com/">
      &lt;VRSCommand&gt;&lt;Header CID="TESTCID" User="User" Password="USW5UUBA" /&gt;&lt;Availability /&gt;&lt;/VRSCommand&gt;
    </Command>
    <Token xmlns="http://videcom.com/">E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=</Token>
  </soap12:Body>
</soap12:Envelope>
`;

axios
  .post(url, soapEnvelope, {
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(soapEnvelope),
    },
  })
  .then((response) => {
    console.log("Resposta:", response.data);
  })
  .catch((error) => {
    console.error("Erro:", error.response?.data || error.message);
  });
