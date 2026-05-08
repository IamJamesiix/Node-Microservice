import 'dotenv/config';

// Middleware to protect internal webhook routes
export function validateInternalWebhook(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}