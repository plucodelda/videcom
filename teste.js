async function Alo() {
  const response = await fetch("http://localhost:3000/api/bookings", {
    method: "POST",
    headers: {
      Authorization: "Bearer E7ATVw5LGLMCx96JJ9RDM30KwC3xc746/XtetqSBOwI=",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      passengerName: "Silva/JoaoMr",
      email: "joao.silva@email.com",
    }),
  });
}

Alo().then((data) => {
  console.log(data);
});
