import config from "../config/dotenv";

// Middleware to protect internal webhook routes
export function validateInternalWebhook(req, res, next) {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== config.WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}