import express from "express";
import WaveSpeed from "wavespeed";

const app = express();

// Increase payload limit for large base64 images
app.use(express.json({ limit: '50mb' }));

// API routes FIRST
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok",
    keys: {
      OPENROUTER: !!(process.env.OPENROUTER_API_KEY || process.env.API_KEY),
      OPENAI: !!process.env.OPENAI_API_KEY,
      WAVESPEED: !!process.env.WAVESPEED_API_KEY
    }
  });
});

app.post("/api/openrouter/chat/completions", async (req, res) => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: { message: "OPENROUTER_API_KEY is missing" } });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aistudio.google.com",
        "X-Title": "Clips Video Production Pipeline",
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("OpenRouter Proxy Error:", error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// 2. OpenAI TTS Proxy
app.post("/api/openai/audio/speech", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: { message: "OPENAI_API_KEY is missing" } });
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errorData = await response.text();
      return res.status(response.status).send(errorData);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (error: any) {
    console.error("OpenAI Proxy Error:", error);
    res.status(500).json({ error: { message: error.message } });
  }
});

// 3. Wavespeed Image Proxy
app.post("/api/wavespeed/image", async (req, res) => {
  try {
    const apiKey = process.env.WAVESPEED_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "WAVESPEED_API_KEY is missing" });
    }

    const client = new WaveSpeed(apiKey);

    const { prompt, aspect_ratio } = req.body;

    const result = await client.run("wavespeed-ai/flux-schnell", {
      prompt,
      aspect_ratio,
      num_images: 1
    });

    if (result && result.outputs && result.outputs.length > 0) {
      return res.json({ output: result.outputs[0] });
    }
    
    res.status(500).json({ error: result.error || "No output from Wavespeed" });
  } catch (error: any) {
    console.error("Wavespeed Image Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Wavespeed Video Proxy
app.post("/api/wavespeed/video", async (req, res) => {
  try {
    const apiKey = process.env.WAVESPEED_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: "WAVESPEED_API_KEY is missing" });
    }

    const client = new WaveSpeed(apiKey);

    const { prompt, image_url } = req.body;

    const result = await client.run("wavespeed-ai/wan-2.2/i2v-480p-ultra-fast", {
      prompt,
      image: image_url,
      duration: 5,
      seed: -1
    });

    if (result && result.outputs && result.outputs.length > 0) {
      return res.json({ output: result.outputs[0] });
    }
    
    res.status(500).json({ error: result.error || "No output from Wavespeed" });
  } catch (error: any) {
    console.error("Wavespeed Video Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Image Proxy for Downloading
app.get("/api/proxy/image", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "Missing or invalid url parameter" });
    }
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error("Image Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
