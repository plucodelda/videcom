const express = require("express");
const soap = require("soap");

const app = express();
const PORT = 3000;

const wsdlUrl =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx?WSDL";

// XML correto para comando Version
const xmlCommand = `
<VRSXML>
  <MessageHeader>
    <Security>
      <UserID>fastjet</UserID>
      <Password>test</Password>
    </Security>
  </MessageHeader>
  <Version/>
</VRSXML>
`;

app.get("/versao", async (req, res) => {
  try {
    // Cria cliente SOAP
    const client = await soap.createClientAsync(wsdlUrl);

    // Faz a chamada SOAP passando o XML como string
    const [result] = await client.PostVRSCommandAsync({ VRSInput: xmlCommand });

    // Retorna a resposta XML da Videcom
    res.type("text/xml").send(result.PostVRSCommandResult);
  } catch (error) {
    console.error("Erro ao chamar Videcom SOAP:", error);
    res.status(500).json({ erro: "Erro na chamada SOAP à Videcom" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
