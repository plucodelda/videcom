// booking.js
const express = require("express");
const soap = require("soap");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const WSDL_URL =
  "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx?WSDL";

app.post("/api/bookings", async (req, res) => {
  try {
    const { token, passengerName, email, title } = req.body;

    const commandString = `-1${passengerName}^9-1E*${email}^e*r~x`;

    const args = {
      msg: {
        Token: token,
        Command: commandString,
      },
    };

    soap.createClient(WSDL_URL, (err, client) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Erro ao criar cliente SOAP", details: err });

      client.PostVRSCommand(args, (err, result) => {
        if (err)
          return res
            .status(500)
            .json({ error: "Erro ao enviar comando SOAP", details: err });

        res.json({ result });
      });
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erro interno do servidor", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
