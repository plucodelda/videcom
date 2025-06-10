const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const bodyParser = require("body-parser");
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuration
const config = {
  vrsEndpoint:
    "https://customertest.videcom.com/fastjet/vrsxmlservice/vrsxmlwebservice3.asmx",
  token: "E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=", // Provided by Videcom
  sineCode: "1957MP/RC", // Provided by airline
  // officeId: "YOUR_OFFICE_ID", // Provided by airline
};

// SOAP Client Helper
async function callVrsApi(command) {
  const soapRequest = `
    <?xml version="1.0" encoding="utf-8"?>
    <soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
      xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
      xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
      <soap12:Body>
        <msg xmlns="http://videcom.com/">
          <Token>${config.token}</Token>
          <Command>${command}</Command>
        </msg>
      </soap12:Body>
    </soap12:Envelope>
  `;

  try {
    const response = await axios.post(config.vrsEndpoint, soapRequest, {
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        "Content-Length": soapRequest.length,
      },
    });

    // Parse XML response
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);

    return result["soap:Envelope"]["soap:Body"].RunVRSCommandResult;
  } catch (error) {
    console.error("VRS API Error:", error);
    throw error;
  }
}

// API Endpoints

// 1. Flight Availability
app.get("/api/flights/availability", async (req, res) => {
  try {
    const { origin, destination, date, isReturn, returnDate } = req.query;

    // One-way flight availability
    let command = `A${date}${origin}${destination}[SalesCity=${origin},VARS=True,ClassBands=True,StartCity=${origin},SingleSeg=${
      isReturn ? "r" : "s"
    },FGNoAv=True,qtyseats=1,journey=${origin}-${destination}]`;

    if (isReturn && returnDate) {
      // For return flights, we need to make two separate requests
      const outboundResponse = await callVrsApi(command);

      command = `A${returnDate}${destination}${origin}[SalesCity=${origin},VARS=True,ClassBands=True,StartCity=${origin},SingleSeg=r,FGNoAv=True,qtyseats=1,journey=${origin}-${destination}-${origin},DEPART=${date}]`;
      const returnResponse = await callVrsApi(command);

      return res.json({
        outbound: outboundResponse,
        return: returnResponse,
      });
    }

    const response = await callVrsApi(command);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Price a Booking (without holding space)
app.post("/api/flights/price", async (req, res) => {
  try {
    const { passengers, flights } = req.body;

    // Build passenger string
    let paxString = `${passengers.length}Pax/`;
    passengers.forEach((pax, index) => {
      paxString += `${String.fromCharCode(65 + index)}#`;
      if (pax.type === "CH") paxString += `.CH${pax.age}`;
      if (pax.type === "IN") paxString += `.IN${pax.age}`;
      paxString += "/";
    });
    paxString = paxString.slice(0, -1); // Remove trailing slash

    // Build flight segments
    let flightSegments = "";
    flights.forEach((flight) => {
      flightSegments += `^0${flight.airline}${flight.number}${flight.class}${
        flight.date
      }${flight.origin}${flight.destination}QQ${
        passengers.filter((p) => p.type !== "IN").length
      }`;
      if (flight.departureTime && flight.arrivalTime) {
        flightSegments += `/${flight.departureTime}${flight.arrivalTime}`;
      }
    });

    const command = `!^${paxString}${flightSegments}^FG^FS1^*r-x`;
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Hold Space (Temporary Booking)
app.post("/api/bookings/hold", async (req, res) => {
  try {
    const { passengers, flights, contactPhone } = req.body;

    // Build passenger string
    let paxString = `${passengers.length}Pax/`;
    passengers.forEach((pax, index) => {
      paxString += `${String.fromCharCode(65 + index)}#`;
      if (pax.type === "CH") paxString += `.CH${pax.age}`;
      if (pax.type === "IN") paxString += `.IN${pax.age}`;
      paxString += "/";
    });
    paxString = paxString.slice(0, -1);

    // Build flight segments with NN status to hold space
    let flightSegments = "";
    flights.forEach((flight) => {
      flightSegments += `^0${flight.airline}${flight.number}${flight.class}${
        flight.date
      }${flight.origin}${flight.destination}NN${
        passengers.filter((p) => p.type !== "IN").length
      }`;
    });

    // Add contact and 20-minute time limit
    const command = `!^${paxString}${flightSegments}^FG^FS1^9c*${contactPhone}^8M/20^e*r-x`;
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Complete Booking
app.post("/api/bookings", async (req, res) => {
  try {
    const { pnr, passengers, payment, contactEmail, sendEmail } = req.body;

    // Build passenger details
    let paxDetails = "";
    passengers.forEach((pax, index) => {
      paxDetails += `^-${index + 1}${pax.lastName}/${pax.firstName}${
        pax.title || "Mr"
      }`;
      if (pax.type === "CH") paxDetails += `.CH${pax.age}`;
      if (pax.type === "IN") paxDetails += `.IN${pax.age}`;
      paxDetails += "^";

      // Add passport details if available
      if (pax.passport) {
        paxDetails += `4-${index + 1}FDOCS/P/${pax.passport.country}/${
          pax.passport.number
        }/${pax.passport.country}/${pax.passport.dob}/${pax.gender || "M"}^`;
      }
    });

    // Add contact email
    paxDetails += `9e*${contactEmail}^`;

    // Add fare quote and store
    paxDetails += "FG^FS1^";

    // Add payment
    let paymentCommand = "";
    if (payment.method === "CASH") {
      paymentCommand = "MM^";
    } else if (payment.method === "CREDIT_CARD") {
      paymentCommand = `MC${payment.amount}-${payment.cardNumber}/${payment.cardHolderName}**${payment.expiry}^`;
    }
    paxDetails += paymentCommand;

    // Add ticket issuance and optional email
    if (sendEmail) {
      paxDetails += "EZT*R^EZRE^";
    } else {
      paxDetails += "EZT*R^";
    }

    // Final command to display PNR
    paxDetails += "*r-x";

    // Full command to update existing PNR
    const command = `*${pnr}^${paxDetails}`;
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Seat Selection
app.post("/api/bookings/:pnr/seats", async (req, res) => {
  try {
    const { pnr } = req.params;
    const { passengerNumber, segmentNumber, seatNumber, isFree } = req.body;

    const command = `*${pnr}^4-${passengerNumber}s${segmentNumber}frqst${seatNumber}${
      isFree ? "[MmbFreeSeat=True]" : ""
    }^e*r~x`;
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Retrieve Booking
app.get("/api/bookings/:pnr", async (req, res) => {
  try {
    const { pnr } = req.params;
    const command = `*${pnr}^x`;
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Get Available Products (Ancillaries)
app.get("/api/products", async (req, res) => {
  try {
    const command = "ssrpfP[z/fp.xml]";
    const response = await callVrsApi(command);

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Add Product to Booking
app.post("/api/bookings/:pnr/products", async (req, res) => {
  try {
    const { pnr } = req.params;
    const { passengerNumber, segmentNumber, productCode } = req.body;

    // First quote the price
    const quoteCommand = `*${pnr}^7-${passengerNumber}=${segmentNumber}F${productCode}^FSM^*R^x`;
    const quoteResponse = await callVrsApi(quoteCommand);

    // Then add the product
    const addCommand = `*${pnr}^7-${passengerNumber}=${segmentNumber}F${productCode}^FSM^MM^EMT*R`;
    const addResponse = await callVrsApi(addCommand);

    res.json({
      quote: quoteResponse,
      confirmation: addResponse,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VRS API Service running on port ${PORT}`);
});
