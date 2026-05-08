export async function handleWhatsApp(req, res) {
  // Twilio sends form-encoded body
  const { Body, From, To } = req.body;

  console.log(`📱 WhatsApp from ${From}: ${Body}`);

  // Stub intent router — Claude API integration comes Day 2
  const intent = detectIntent(Body);

  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>👋 Welcome to Trybe! We got your message: "${intent}". Full service launching soon.</Message>
</Response>`);
}

function detectIntent(text) {
  const lower = text?.toLowerCase() || '';
  if (lower.includes('balance')) return 'check_balance';
  if (lower.includes('send') || lower.includes('transfer')) return 'send_money';
  if (lower.includes('job') || lower.includes('work')) return 'find_jobs';
  if (lower.includes('loan')) return 'loan_request';
  return 'unknown';
}