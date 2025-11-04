// index.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// Env vars
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mybot123";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const GIPHY_KEY = process.env.GIPHY_API_KEY || "";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const YT_API_KEY = process.env.YT_API_KEY || ""; // optional
const PAGE_ID = process.env.PAGE_ID || "";

if (!PAGE_TOKEN) console.warn("⚠️ PAGE_ACCESS_TOKEN not set in env");

// helper: send message
async function sendMessage(recipientId, message) {
  await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message }),
  });
}

// webhook verification for FB
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

// Spotify: get token via Client Credentials
async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = await resp.json();
  return json.access_token;
}

// Spotify: search track (returns object with name, artist, spotify_url, preview_url)
async function spotifySearch(track) {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;
    const q = encodeURIComponent(track);
    const r = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    const item = j.tracks?.items?.[0];
    if (!item) return null;
    return {
      name: item.name,
      artist: item.artists.map(a => a.name).join(", "),
      spotify_url: item.external_urls.spotify,
      preview_url: item.preview_url || null,
    };
  } catch (e) {
    console.error("Spotify error", e);
    return null;
  }
}

// Handle messages
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") { res.sendStatus(404); return; }
  for (const entry of body.entry) {
    const event = entry.messaging && entry.messaging[0];
    if (!event) continue;
    const sender = event.sender.id;

    if (event.message && event.message.text) {
      const text = event.message.text.trim();
      const ltext = text.toLowerCase();

      // Help
      if (ltext === "help") {
        await sendMessage(sender, { text:
`Commands:
help
ai: <question>
meme
joke
jokeimg
quote
play: <song name>   (returns YouTube link + Spotify if available)`});
        continue;
      }

      // AI for education
      if (ltext.startsWith("ai:")) {
        const question = text.slice(3).trim();
        if (!OPENAI_KEY) {
          await sendMessage(sender, { text: "OpenAI key not set. Add OPENAI_API_KEY to .env." });
          continue;
        }
        if (!question) {
          await sendMessage(sender, { text: "Please type: ai: <your question>" });
          continue;
        }
        try {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "You are a helpful educational assistant. Answer clearly and simply." },
                { role: "user", content: question }
              ],
              max_tokens: 400
            })
          });
          const j = await resp.json();
          const answer = j?.choices?.[0]?.message?.content || "I couldn't generate an answer.";
          await sendMessage(sender, { text: answer });
        } catch (err) {
          console.error("OpenAI error:", err);
          await sendMessage(sender, { text: "AI service error. Try again later." });
        }
        continue;
      }

      // Meme (Giphy random gif)
      if (ltext === "meme") {
        if (!GIPHY_KEY) {
          await sendMessage(sender, { text: "GIPHY key not set. Add GIPHY_API_KEY to .env." });
          continue;
        }
        try {
          const r = await fetch(`https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_KEY}&tag=funny&rating=g`);
          const j = await r.json();
          const url = j?.data?.images?.original?.url;
          if (url) {
            await sendMessage(sender, { attachment: { type: "image", payload: { url } } });
          } else {
            await sendMessage(sender, { text: "Couldn't fetch meme right now." });
          }
        } catch (err) {
          console.error("Giphy error:", err);
          await sendMessage(sender, { text: "Error fetching meme." });
        }
        continue;
      }

      // Random joke (text)
      if (ltext === "joke") {
        try {
          const r = await fetch("https://v2.jokeapi.dev/joke/Any?type=single");
          const j = await r.json();
          const joke = j?.joke || "No jokes right now.";
          await sendMessage(sender, { text: joke });
        } catch (err) {
          console.error("JokeAPI error", err);
          await sendMessage(sender, { text: "Error fetching joke." });
        }
        continue;
      }

      // Random joke + image (image from picsum/unsplash)
      if (ltext === "jokeimg" || ltext === "joke image") {
        try {
          const r = await fetch("https://v2.jokeapi.dev/joke/Any?type=single");
          const j = await r.json();
          const joke = j?.joke || "No jokes right now.";
          // random image (picsum)
          const imgUrl = `https://picsum.photos/600/400?random=${Math.floor(Math.random()*10000)}`;
          // send image first then text (or send as attachment with caption)
          await sendMessage(sender, { attachment: { type: "image", payload: { url: imgUrl } } });
          await sendMessage(sender, { text: joke });
        } catch (err) {
          console.error("jokeimg error", err);
          await sendMessage(sender, { text: "Error fetching joke/image." });
        }
        continue;
      }

      // Quote
      if (ltext === "quote") {
        try {
          const q = await fetch("https://api.quotable.io/random?tags=motivational");
          const jq = await q.json();
          const out = jq?.content ? `💡 ${jq.content}\n— ${jq.author || "Unknown"}` : "No quote available.";
          await sendMessage(sender, { text: out });
        } catch (err) {
          console.error("quote error", err);
          await sendMessage(sender, { text: "Error fetching quote." });
        }
        continue;
      }

      // Music: play: <song> -> returns YouTube search link, tries Spotify for direct link
      if (ltext.startsWith("play:")) {
        const song = text.slice(5).trim();
        if (!song) { await sendMessage(sender, { text: "Please type: play: <song name>" }); continue; }
        // Try Spotify
        let spotifyResult = null;
        try { spotifyResult = await spotifySearch(song); } catch(e){ console.error("spotify search fail", e) }
        const ytQuery = encodeURIComponent(song);
        const ytUrl = YT_API_KEY ? `https://www.youtube.com/results?search_query=${ytQuery}` : `https://www.youtube.com/results?search_query=${ytQuery}`; // same fallback
        if (spotifyResult) {
          // send nice message with both links (Spotify and YouTube)
          const textMsg = `🎵 ${spotifyResult.name} — ${spotifyResult.artist}\nSpotify: ${spotifyResult.spotify_url}\nYouTube search: ${ytUrl}`;
          await sendMessage(sender, { text: textMsg });
        } else {
          await sendMessage(sender, { text: `🎵 Could not find Spotify track. Try YouTube: ${ytUrl}` });
        }
        continue;
      }

      // default fallback
      await sendMessage(sender, { text: "I didn't understand — type 'help' to see commands." });
    }
  }
  res.sendStatus(200);
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EduTune bot running on port ${PORT}`));
    
