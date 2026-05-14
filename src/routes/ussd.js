import { Router } from 'express';
import { handleUSSD } from '../controllers/ussdController.js';

const router = Router();

// Africa's Talking POSTs here
router.post('/', handleUSSD);

export default router;