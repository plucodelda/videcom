const express = require("express");
const xml2js = require("xml2js");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.text({ type: "application/xml" }));
app.use(express.text({ type: "text/xml" }));

// Configuração do multer para upload de arquivos
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Classe SOAPConverter (integrada)
class SOAPConverter {
  constructor() {
    this.parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true,
    });
    this.builder = new xml2js.Builder({
      xmldec: { version: "1.0", encoding: "utf-8" },
      headless: false,
    });
  }

  async xmlToJson(xmlString) {
    try {
      return await this.parser.parseStringPromise(xmlString);
    } catch (error) {
      throw new Error(`Erro ao converter XML: ${error.message}`);
    }
  }

  jsonToXml(jsonObject) {
    try {
      return this.builder.buildObject(jsonObject);
    } catch (error) {
      throw new Error(`Erro ao converter JSON: ${error.message}`);
    }
  }

  extractSOAPData(jsonObject) {
    try {
      const soapBody = jsonObject["soap:Envelope"]["soap:Body"];
      const msg = soapBody.msg || soapBody.smsg;

      return {
        token: msg.Token,
        command: msg.Command,
        namespace: msg.xmlns || null,
        fullMessage: msg,
      };
    } catch (error) {
      throw new Error(`Erro ao extrair dados SOAP: ${error.message}`);
    }
  }

  createSOAPStructure(token, command, namespace = "http://videcom.com/") {
    return {
      "soap:Envelope": {
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
        "xmlns:soap": "http://schemas.xmlsoap.org/soap/envelope/",
        "soap:Body": {
          msg: {
            xmlns: namespace,
            Token: token,
            Command: command,
          },
        },
      },
    };
  }
}

const converter = new SOAPConverter();

// Middleware para logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Middleware para tratamento de erros
const errorHandler = (err, req, res, next) => {
  console.error("Erro:", err.message);
  res.status(500).json({
    success: false,
    error: err.message,
    timestamp: new Date().toISOString(),
  });
};

// ===============================
// ROTAS DA API
// ===============================

// Rota principal - informações da API
app.get("/", (req, res) => {
  res.json({
    name: "SOAP XML Converter API",
    version: "1.0.0",
    description: "API para conversão e manipulação de XML SOAP",
    endpoints: {
      "GET /": "Informações da API",
      "POST /convert/xml-to-json": "Converte XML para JSON",
      "POST /convert/json-to-xml": "Converte JSON para XML",
      "POST /soap/extract": "Extrai dados específicos do SOAP",
      "POST /soap/create": "Cria nova estrutura SOAP",
      "POST /file/upload": "Upload e conversão de arquivo XML",
      "GET /health": "Status da API",
    },
  });
});

// Converter XML para JSON
app.post("/convert/xml-to-json", async (req, res) => {
  try {
    const xmlData = req.body;

    if (!xmlData) {
      return res.status(400).json({
        success: false,
        error: "XML data is required",
      });
    }

    const jsonResult = await converter.xmlToJson(xmlData);

    res.json({
      success: true,
      data: jsonResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Converter JSON para XML
app.post("/convert/json-to-xml", (req, res) => {
  try {
    const jsonData = req.body;

    if (!jsonData) {
      return res.status(400).json({
        success: false,
        error: "JSON data is required",
      });
    }

    const xmlResult = converter.jsonToXml(jsonData);

    res.set("Content-Type", "application/xml");
    res.send(xmlResult);
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Extrair dados específicos do SOAP
app.post("/soap/extract", async (req, res) => {
  try {
    let jsonData;

    if (typeof req.body === "string") {
      // Se recebeu XML, converter primeiro
      jsonData = await converter.xmlToJson(req.body);
    } else {
      // Se já é JSON
      jsonData = req.body;
    }

    const extractedData = converter.extractSOAPData(jsonData);

    res.json({
      success: true,
      data: extractedData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Criar nova estrutura SOAP
app.post("/soap/create", (req, res) => {
  try {
    const { token, command, namespace } = req.body;

    if (!token || !command) {
      return res.status(400).json({
        success: false,
        error: "Token and command are required",
      });
    }

    const soapStructure = converter.createSOAPStructure(
      token,
      command,
      namespace
    );
    const xmlResult = converter.jsonToXml(soapStructure);

    res.json({
      success: true,
      data: {
        json: soapStructure,
        xml: xmlResult,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Upload e conversão de arquivo XML
app.post("/file/upload", upload.single("xmlFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Nenhum arquivo enviado",
      });
    }

    const filePath = req.file.path;
    const xmlData = fs.readFileSync(filePath, "utf8");

    // Limpar arquivo temporário
    fs.unlinkSync(filePath);

    const jsonResult = await converter.xmlToJson(xmlData);
    const extractedData = converter.extractSOAPData(jsonResult);

    res.json({
      success: true,
      fileName: req.file.originalname,
      data: {
        json: jsonResult,
        extracted: extractedData,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Limpar arquivo em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
  });
});

// Rota para exemplo de XML SOAP
app.get("/example", (req, res) => {
  const exampleXML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <msg xmlns="http://videcom.com/">
            <Token>E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=</Token>
            <Command>zuser</Command>
        </msg>
    </soap:Body>
</soap:Envelope>`;

  res.set("Content-Type", "application/xml");
  res.send(exampleXML);
});

// Middleware de tratamento de erros
app.use(errorHandler);

// Rota 404
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint não encontrado",
    timestamp: new Date().toISOString(),
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
  console.log(`📝 Documentação em http://localhost:${PORT}`);
  console.log(`🔍 Health check em http://localhost:${PORT}/health`);

  // Criar diretório uploads se não existir
  if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
  }
});

module.exports = app;

// ===============================
// EXEMPLOS DE USO:
// ===============================

/*
1. Converter XML para JSON:
POST http://localhost:3000/convert/xml-to-json
Content-Type: application/xml
Body: [seu XML aqui]

2. Extrair dados SOAP:
POST http://localhost:3000/soap/extract
Content-Type: application/xml
Body: [seu XML SOAP aqui]

3. Criar novo SOAP:
POST http://localhost:3000/soap/create
Content-Type: application/json
{
  "token": "seu-token-aqui",
  "command": "seu-comando",
  "namespace": "http://exemplo.com/"
}

4. Upload de arquivo:
POST http://localhost:3000/file/upload
Content-Type: multipart/form-data
FormData: xmlFile=[seu arquivo.xml]
*/
