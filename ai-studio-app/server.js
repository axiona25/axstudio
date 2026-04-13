const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.RUNPOD_API_KEY || "";

app.get("/api/balance", async (req, res) => {
  try {
    const r = await fetch(`https://api.runpod.io/graphql?api_key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { myself { clientBalance currentSpendPerHr } }" }),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) { res.json({ error: e.message }); }
});

app.listen(3001, () => console.log("Proxy running on http://localhost:3001"));
