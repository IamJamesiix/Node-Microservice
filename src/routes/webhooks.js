import { Router } from 'express';
import { handleSquadWebhook, handleWhatsAppWebhook } from '../controllers/webhookController.js';

const router = Router();

// Squad virtual account credit events
router.post('/squad', handleSquadWebhook);

// WhatsApp delivery events (Twilio)
router.post('/whatsapp', handleWhatsAppWebhook);

export default router;