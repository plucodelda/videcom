const axios = require("axios");
const { parseStringPromise } = require("xml2js");

// Token e comando a serem enviados
const token = "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=";
const command = "zuser";

// Corpo da requisição SOAP
const soapBody = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <msg xmlns="http://videcom.com/">
      <Token>${token}</Token>
      <Command>${command}</Command>
    </msg>
  </soap:Body>
</soap:Envelope>
`;

const endpoint =
  "https://customer3.videcom.com/fastjet/vrsxmlservice/VrsXmlWebService3.asmx";

async function callVidecomAPI() {
  try {
    const { data } = await axios.post(endpoint, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://videcom.com/RunVRSCommand",
      },
    });

    // Opcional: converter XML para JSON
    const result = await parseStringPromise(data, { explicitArray: false });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Erro na requisição SOAP:", error.message);
    if (error.response) console.error(error.response.data);
  }
}

callVidecomAPI();
