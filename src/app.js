import express from 'express';
import authRoutes from './routes/auth.js';
import ussdRoutes from './routes/ussd.js';
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();

// Squad webhook needs raw body for signature verification
// Must be before express.json()
app.use('/webhooks/squad', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Re-parse so controllers get a JS object but rawBody is preserved
  req.rawBody = req.body;
  req.body = JSON.parse(req.body.toString());
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // needed for Africa's Talking USSD + Twilio

app.use('/auth', authRoutes);
app.use('/ussd', ussdRoutes);
app.use('/whatsapp', whatsappRoutes);
app.use('/webhooks', webhookRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Kolliq-node' }));

export default app;