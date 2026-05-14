import { Router } from 'express';
import { handleWhatsApp } from '../controllers/whatsappController.js';

const router = Router();

// Twilio sends a GET to verify your webhook URL — must return 200
router.get('/', (req, res) => {
  res.status(200).send('Kolliq WhatsApp webhook active');
});

// Twilio POSTs inbound messages here
router.post('/', handleWhatsApp);

export default router;