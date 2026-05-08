import { Router } from 'express';
import { handleWhatsApp } from '../controllers/whatsappController.js';

const router = Router();

router.post('/', handleWhatsApp);

export default router;