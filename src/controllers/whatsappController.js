import Groq from 'groq-sdk';
import config from '../config/dotenv.js';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

export async function handleWhatsApp(req, res) {
  const { Body, From, To } = req.body;

  console.log(`📱 WhatsApp from ${From}: ${Body}`);

  try {
    const intent = await detectIntent(Body);

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>👋 Welcome to Trybe! We got your message: "${intent}". Full service launching soon.</Message>
</Response>`);
  } catch (err) {
    console.error('WhatsApp handler error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, something went wrong. Please try again.</Message>
</Response>`);
  }
}

async function detectIntent(text) {
  if (!text) return 'unknown';

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `You are an intent classifier for a Nigerian fintech app called Trybe. 
Classify the user message into exactly one of these intents:
check_balance, send_money, find_jobs, loan_request, register, help, unknown.
Reply with ONLY the intent word, nothing else.`
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 10,
  });

  const intent = completion.choices[0]?.message?.content?.trim().toLowerCase();
  return intent || 'unknown';
}